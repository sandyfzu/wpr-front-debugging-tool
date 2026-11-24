import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EXTENSION_ICONS, PADDED_ART_RATIO } from '../lib/branding/icons.ts';
import {
  MASTER_PATH,
  driftProblems,
  layoutSvg,
  paddedViewBox,
  parseArgs,
  parseViewBox,
  pngChunkTypes,
  readMaster,
  renderIcon,
  renderIconSet,
  resvgRender,
  withSrgbChunk
} from './generate-icons.mjs';

/* The icon generator: viewBox math, layouts, real renders of the master, drift check, CLI args. */

/** The committed master mark (tests run at the package root). */
const MASTER = readFileSync(MASTER_PATH, 'utf8');

/** A minimal square master: one opaque square inset 4 units in a 128 box. */
const INSET_SQUARE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect x="4" y="4" width="120" height="120" fill="#282828"/></svg>';

/**
 * The alpha byte of one pixel of an RGBA render.
 *
 * @param {{ pixels: Buffer, width: number }} image The render.
 * @param {number} x Column.
 * @param {number} y Row.
 */
function alphaAt(image, x, y) {
  return image.pixels[(y * image.width + x) * 4 + 3];
}

describe('parseViewBox', () => {
  it('reads the master box', () => {
    expect(parseViewBox(MASTER)).toEqual({ minX: 0, minY: 0, width: 128, height: 128 });
  });

  it('accepts commas, single quotes and ignores a commented-out root', () => {
    const svg = `<!-- <svg viewBox="0 0 9 1"> --><svg viewBox='-2,-2, 10 10'></svg>`;
    expect(parseViewBox(svg)).toEqual({ minX: -2, minY: -2, width: 10, height: 10 });
  });

  it.each([
    ['no root element', '<g/>', /no root <svg>/],
    ['no viewBox', '<svg width="10" height="10"></svg>', /has no viewBox/],
    ['three numbers', '<svg viewBox="0 0 10"></svg>', /malformed viewBox "0 0 10"/],
    ['a non-number', '<svg viewBox="0 0 a 10"></svg>', /malformed viewBox/],
    ['a non-square box', '<svg viewBox="0 0 10 20"></svg>', /must be square/],
    ['an empty box', '<svg viewBox="0 0 0 0"></svg>', /must be square and non-empty/]
  ])('refuses %s, naming the master', (_, svg, message) => {
    expect(() => parseViewBox(svg)).toThrow(message);
    expect(() => parseViewBox(svg)).toThrow(MASTER_PATH);
  });
});

describe('paddedViewBox', () => {
  it('widens 128 to 128 / 0.75, centered: the content spans 75 % with equal margins', () => {
    const box = paddedViewBox({ minX: 0, minY: 0, width: 128, height: 128 }, 0.75);
    expect(box.width).toBeCloseTo(128 / 0.75, 10);
    expect(box.height).toBeCloseTo(128 / 0.75, 10);
    // Margin each side = (box − content) / 2, and the content's center stays at 64.
    expect(-box.minX).toBeCloseTo((box.width - 128) / 2, 10);
    expect(box.minX + box.width / 2).toBeCloseTo(64, 10);
    expect(box.minY + box.height / 2).toBeCloseTo(64, 10);
    // At a 128 px render that margin is 16 px.
    expect((-box.minX / box.width) * 128).toBeCloseTo(16, 10);
  });

  it('keeps an offset origin centered', () => {
    const box = paddedViewBox({ minX: 10, minY: -6, width: 40, height: 40 }, 0.5);
    expect(box).toEqual({ minX: -10, minY: -26, width: 80, height: 80 });
  });

  it('is the identity at ratio 1', () => {
    const original = { minX: 0, minY: 0, width: 128, height: 128 };
    expect(paddedViewBox(original, 1)).toEqual(original);
  });

  it.each([0, -0.5, 1.5, Number.NaN])('refuses ratio %s', (ratio) => {
    expect(() => paddedViewBox({ minX: 0, minY: 0, width: 1, height: 1 }, ratio)).toThrow(
      /not in \(0, 1\]/
    );
  });
});

describe('layoutSvg', () => {
  it('returns the master unchanged for full-bleed', () => {
    expect(layoutSvg(MASTER, 'full-bleed', PADDED_ART_RATIO)).toBe(MASTER);
  });

  it('rewrites only the root viewBox for padded', () => {
    const padded = layoutSvg(MASTER, 'padded', PADDED_ART_RATIO);
    const box = paddedViewBox(parseViewBox(MASTER), PADDED_ART_RATIO);
    expect(parseViewBox(padded)).toEqual(box);
    expect(padded.replace(/viewBox="[^"]*"/, '')).toBe(MASTER.replace(/viewBox="[^"]*"/, ''));
  });

  it('refuses an unknown layout and an unusable master', () => {
    expect(() => layoutSvg(MASTER, 'stretched', PADDED_ART_RATIO)).toThrow(
      'Unknown icon layout "stretched"'
    );
    expect(() => layoutSvg('<svg></svg>', 'full-bleed', PADDED_ART_RATIO)).toThrow(/no viewBox/);
  });
});

describe('PNG color tagging', () => {
  /** A rendered PNG before tagging (what the renderer writes). */
  const untagged = () => withoutChunk(resvgRender(INSET_SQUARE, 8).png, 'sRGB');

  /**
   * Remove one chunk from a PNG (test helper to recover the renderer's own bytes).
   *
   * @param {Buffer} png PNG bytes.
   * @param {string} type Chunk type to drop.
   */
  function withoutChunk(png, type) {
    const parts = [png.subarray(0, 8)];
    for (let offset = 8; offset < png.length;) {
      const end = offset + 12 + png.readUInt32BE(offset);
      if (png.toString('latin1', offset + 4, offset + 8) !== type)
        parts.push(png.subarray(offset, end));
      offset = end;
    }
    return Buffer.concat(parts);
  }

  it('lists chunk types in order', () => {
    expect(pngChunkTypes(untagged())).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it('inserts one valid sRGB chunk (perceptual intent) right after IHDR', () => {
    const tagged = withSrgbChunk(untagged());
    expect(pngChunkTypes(tagged)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND']);
    const chunk = tagged.subarray(33, 46);
    expect(chunk.readUInt32BE(0)).toBe(1);
    expect(chunk.toString('latin1', 4, 8)).toBe('sRGB');
    expect(chunk[8]).toBe(0);
    expect(chunk.readUInt32BE(9)).toBe(crc32(chunk.subarray(4, 9)));
  });

  it('refuses bytes that are not a PNG, and a PNG already tagged', () => {
    expect(() =>
      withSrgbChunk(Buffer.from('not a png at all, long enough to pass length'))
    ).toThrow('Not a PNG starting with an IHDR chunk');
    expect(() => withSrgbChunk(Buffer.alloc(4))).toThrow('Not a PNG');
    expect(() => withSrgbChunk(withSrgbChunk(untagged()))).toThrow('already carries a sRGB chunk');
  });
});

describe('renderIcon (real renders of the master)', () => {
  it.each(EXTENSION_ICONS.map((icon) => [icon.path, icon]))(
    '%s: exact size, RGBA, sRGB-tagged, transparent corner',
    (_, icon) => {
      const png = renderIcon(MASTER, icon);
      // IHDR: width, height, bit depth 8, color type 6 (RGBA).
      expect(png.readUInt32BE(16)).toBe(icon.size);
      expect(png.readUInt32BE(20)).toBe(icon.size);
      expect(png[24]).toBe(8);
      expect(png[25]).toBe(6);
      expect(pngChunkTypes(png)).toContain('sRGB');
      const image = resvgRender(layoutSvg(MASTER, icon.layout, PADDED_ART_RATIO), icon.size);
      expect(image.png.equals(png)).toBe(true);
      for (const [x, y] of [
        [0, 0],
        [icon.size - 1, 0],
        [0, icon.size - 1],
        [icon.size - 1, icon.size - 1]
      ]) {
        expect(alphaAt(image, x, y)).toBe(0);
      }
      // The tile is opaque at its center.
      const middle = Math.floor(icon.size / 2);
      expect(alphaAt(image, middle, middle)).toBe(255);
    }
  );

  it('pads 16 px per side at 128 and draws full-bleed edge to edge', () => {
    const padded = resvgRender(layoutSvg(INSET_SQUARE, 'padded', 0.75), 128);
    const full = resvgRender(layoutSvg(INSET_SQUARE, 'full-bleed', 0.75), 128);
    // The 4-unit inset scales to 3 px inside the 16 px margin: the square spans 19..108.
    expect(alphaAt(padded, 18, 64)).toBe(0);
    expect(alphaAt(padded, 19, 64)).toBe(255);
    expect(alphaAt(padded, 108, 64)).toBe(255);
    expect(alphaAt(padded, 109, 64)).toBe(0);
    expect(alphaAt(padded, 64, 18)).toBe(0);
    expect(alphaAt(padded, 64, 109)).toBe(0);
    expect(alphaAt(full, 3, 64)).toBe(0);
    expect(alphaAt(full, 4, 64)).toBe(255);
    expect(alphaAt(full, 123, 64)).toBe(255);
    expect(alphaAt(full, 124, 64)).toBe(0);
  });

  it('fails naming the file when the render is not the declared size', () => {
    const wrong = () => ({ png: Buffer.alloc(0), width: 16, height: 15, pixels: Buffer.alloc(0) });
    expect(() =>
      renderIcon(MASTER, { size: 16, layout: 'full-bleed', path: 'icon/16.png' }, wrong)
    ).toThrow('icon/16.png: rendered 16×15, expected 16×16');
  });

  it('renders each size from the vector at that size (never a resampled bitmap)', () => {
    const sizes = [];
    renderIconSet(MASTER, EXTENSION_ICONS, (svg, size) => {
      sizes.push(size);
      return resvgRender(svg, size);
    });
    expect(sizes).toEqual(EXTENSION_ICONS.map((icon) => icon.size));
  });

  it('is deterministic: two renders give the same bytes', () => {
    const first = renderIconSet(MASTER);
    const second = renderIconSet(MASTER);
    expect([...first.keys()]).toEqual(EXTENSION_ICONS.map((icon) => icon.path));
    for (const [path, png] of first) expect(second.get(path)?.equals(png)).toBe(true);
  });
});

describe('driftProblems', () => {
  const rendered = new Map([
    ['icon/16.png', Buffer.from([1, 2, 3])],
    ['icon/32.png', Buffer.from([4, 5, 6])]
  ]);

  it('is empty when every committed file matches', () => {
    expect(driftProblems(rendered, (path) => rendered.get(path))).toEqual([]);
  });

  it('names a file that differs by one byte, and a missing one', () => {
    const committed = new Map([['icon/16.png', Buffer.from([1, 2, 4])]]);
    expect(driftProblems(rendered, (path) => committed.get(path))).toEqual([
      'public/icon/16.png: differs from a fresh render',
      'public/icon/32.png: missing'
    ]);
  });

  it('names a file that differs only in length', () => {
    const committed = new Map([
      ['icon/16.png', Buffer.from([1, 2, 3, 0])],
      ['icon/32.png', Buffer.from([4, 5, 6])]
    ]);
    expect(driftProblems(rendered, (path) => committed.get(path))).toEqual([
      'public/icon/16.png: differs from a fresh render'
    ]);
  });

  it('names the given folder in each line', () => {
    expect(driftProblems(rendered, () => undefined, 'store/assets')).toEqual([
      'store/assets/icon/16.png: missing',
      'store/assets/icon/32.png: missing'
    ]);
  });
});

describe('parseArgs', () => {
  it('writes by default and checks with --check', () => {
    expect(parseArgs([])).toEqual({ check: false });
    expect(parseArgs(['--check'])).toEqual({ check: true });
  });

  it('refuses anything else with the usage', () => {
    expect(() => parseArgs(['--write', 'x'])).toThrow(
      'Unknown argument(s): --write x (usage: pnpm icons [--check])'
    );
  });

  it('names the given command in the usage', () => {
    expect(() => parseArgs(['-x'], 'pnpm store:assets')).toThrow(
      'Unknown argument(s): -x (usage: pnpm store:assets [--check])'
    );
  });
});

describe('readMaster', () => {
  it('reads the master under the root', () => {
    const read = [];
    expect(
      readMaster('/repo', (path) => {
        read.push(path);
        return '<svg/>';
      })
    ).toBe('<svg/>');
    expect(read).toEqual(['/repo/branding/icon.svg']);
  });

  it('names the missing master and how to restore it', () => {
    const missing = () => {
      throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    };
    expect(() => readMaster('/repo', missing)).toThrow(
      'Cannot read the master icon branding/icon.svg (/repo/branding/icon.svg): restore it from git'
    );
  });
});
