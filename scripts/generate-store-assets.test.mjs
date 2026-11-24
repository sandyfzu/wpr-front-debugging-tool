import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconOfSize } from '../lib/branding/icons.ts';
import { MASTER_PATH, renderIcon, resvgRender } from './generate-icons.mjs';
import {
  STORE_ASSETS,
  masterTileFill,
  renderStoreAsset,
  renderStoreAssets,
  tileMarkBox,
  tileSvg
} from './generate-store-assets.mjs';

/* The store listing image generator: tile geometry, tile SVG, real renders, table invariants. */

/** The committed master mark (tests run at the package root). */
const MASTER = readFileSync(MASTER_PATH, 'utf8');

/**
 * One pixel of an RGBA render as `[r, g, b, a]`.
 *
 * @param {{ pixels: Buffer, width: number }} image The render.
 * @param {number} x Column.
 * @param {number} y Row.
 */
function pixelAt(image, x, y) {
  const offset = (y * image.width + x) * 4;
  return [...image.pixels.subarray(offset, offset + 4)];
}

describe('masterTileFill', () => {
  it("reads the master's tile color", () => {
    expect(masterTileFill(MASTER)).toBe('#282828');
  });

  it('skips a commented-out rect and accepts single quotes', () => {
    const svg = `<svg><!-- <rect fill="#000000"/> --><rect fill='#abc'/></svg>`;
    expect(masterTileFill(svg)).toBe('#abc');
  });

  it.each([
    ['no rect', '<svg viewBox="0 0 1 1"><circle fill="#fff"/></svg>'],
    ['a non-hex fill', '<svg viewBox="0 0 1 1"><rect fill="url(#g)"/></svg>'],
    ['a rect without fill', '<svg viewBox="0 0 1 1"><rect/></svg>']
  ])('refuses %s, naming the master', (_, svg) => {
    expect(() => masterTileFill(svg)).toThrow(`${MASTER_PATH}: no <rect> with a hex fill`);
  });
});

describe('tileMarkBox', () => {
  it('centers a square of the share of the height', () => {
    expect(tileMarkBox(440, 280, 0.7)).toEqual({ x: 122, y: 42, side: 196 });
    expect(tileMarkBox(1400, 560, 0.7)).toEqual({ x: 504, y: 84, side: 392 });
  });

  it('rounds to whole pixels', () => {
    expect(tileMarkBox(11, 7, 0.5)).toEqual({ x: 4, y: 2, side: 4 });
  });

  it.each([
    [0, 10, 0.5, /is empty/],
    [10, -1, 0.5, /is empty/],
    [10, 10, 0, /not in \(0, 1]/],
    [10, 10, 1.1, /not in \(0, 1]/],
    [10, 10, Number.NaN, /not in \(0, 1]/],
    [5, 10, 1, /does not fit a 5 px wide tile/]
  ])('refuses %i×%i at %d', (width, height, share, message) => {
    expect(() => tileMarkBox(width, height, share)).toThrow(message);
  });
});

describe('tileSvg', () => {
  it('fills the canvas in the tile color and nests the placed master', () => {
    const svg = tileSvg(MASTER, 440, 280, 0.7);
    expect(
      svg.startsWith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="280" viewBox="0 0 440 280">'
      )
    ).toBe(true);
    expect(svg).toContain('<rect width="440" height="280" fill="#282828"/>');
    expect(svg).toContain('<svg x="122" y="42" width="196" height="196" xmlns=');
    expect(svg.endsWith('</svg></svg>')).toBe(true);
  });

  it('refuses a master whose root is already placed', () => {
    const placed = '<svg width="10" viewBox="0 0 10 10"><rect fill="#000"/></svg>';
    expect(() => tileSvg(placed, 20, 10, 1)).toThrow(`${MASTER_PATH}: the root <svg> must not set`);
  });

  it('refuses an unusable master', () => {
    expect(() => tileSvg('<svg viewBox="0 0 10 20"><rect fill="#000"/></svg>', 20, 10, 1)).toThrow(
      /must be square/
    );
  });
});

describe('renderStoreAsset (real renders)', () => {
  it('renders a tile opaque edge to edge in the tile color, the mark centered', () => {
    const image = resvgRender(tileSvg(MASTER, 440, 280, 0.7), 440);
    expect([image.width, image.height]).toEqual([440, 280]);
    for (const [x, y] of [
      [0, 0],
      [439, 0],
      [0, 279],
      [439, 279]
    ]) {
      expect(pixelAt(image, x, y)).toEqual([0x28, 0x28, 0x28, 255]);
    }
    // The mark's center is the rocket, never the background.
    expect(pixelAt(image, 220, 140)).not.toEqual([0x28, 0x28, 0x28, 255]);
  });

  it('renders the Chrome Web Store icon exactly as the shipped 128 px extension icon', () => {
    const row = STORE_ASSETS.find((asset) => asset.file === 'icon-128-padded.png');
    expect(row).toBeDefined();
    const png = renderStoreAsset(MASTER, /** @type {NonNullable<typeof row>} */ (row));
    expect(png.equals(renderIcon(MASTER, iconOfSize(128)))).toBe(true);
  });

  it('fails naming the file when the render size is off', () => {
    const fake = () => ({ png: Buffer.alloc(0), width: 440, height: 279, pixels: Buffer.alloc(0) });
    const tile = { kind: 'tile', file: 't.png', width: 440, height: 280, markShare: 0.7 };
    expect(() => renderStoreAsset(MASTER, /** @type {const} */ (tile), fake)).toThrow(
      't.png: rendered 440×279, expected 440×280'
    );
  });

  it('refuses an unknown kind', () => {
    const odd = /** @type {never} */ ({ kind: 'banner', file: 'b.png' });
    expect(() => renderStoreAsset(MASTER, odd)).toThrow('Unknown store asset kind "banner"');
  });
});

describe('renderStoreAssets', () => {
  it('renders every row at its exact size, in table order', () => {
    const rendered = renderStoreAssets(MASTER);
    expect([...rendered.keys()]).toEqual(STORE_ASSETS.map((asset) => asset.file));
  });

  it('refuses a file listed twice', () => {
    const row = { kind: 'icon', file: 'x.png', size: 16, layout: 'full-bleed' };
    expect(() => renderStoreAssets(MASTER, /** @type {const} */ ([row, row]))).toThrow(
      'Store asset x.png is listed twice'
    );
  });
});
