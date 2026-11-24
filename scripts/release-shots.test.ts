/**
 * The release screenshot plan: every What's new id shot in both palettes at
 * its registry size and format, the store set at the stores' size in one
 * palette, unique output files, stage filtering, and the toolbar mock built
 * only from the states it is given (escaped, colors validated).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readImageSize } from '../utils/image-size';
import {
  RELEASE_SCREENSHOTS,
  SCREENSHOT_PALETTES,
  screenshotPath
} from '../lib/release-notes/screenshots';
import {
  STAGE_IDS,
  STORE_PALETTE,
  SHOWCASE_PAGE,
  STORE_SCALE,
  STORE_SHOTS,
  STORE_VIEWPORT,
  WHATS_NEW_STAGES,
  badgeCssColor,
  FROZEN_CACHE_AGE_MS,
  FROZEN_NOW_MS,
  captureTargets,
  escapeHtml,
  freezeCacheStamp,
  selectTargets,
  toolbarMockHtml,
  type ToolbarState
} from './release-shots';

/** The repository root (this file sits in `scripts/`). */
const ROOT = path.resolve(import.meta.dirname, '..');

const GREEN: ToolbarState = {
  text: '●',
  color: [26, 127, 55, 255],
  title: 'Tool · WP Rocket active, page served from cache'
};

describe('captureTargets', () => {
  const targets = captureTargets();

  it('shoots every What’s new id in both palettes, at its registry size and format', () => {
    for (const [id, meta] of Object.entries(RELEASE_SCREENSHOTS)) {
      for (const palette of SCREENSHOT_PALETTES) {
        const file = `public/${screenshotPath(id, palette, meta.format)}`;
        expect(
          targets.filter((target) => target.file === file),
          file
        ).toEqual([
          {
            stage: WHATS_NEW_STAGES[id as keyof typeof WHATS_NEW_STAGES],
            palette,
            viewport: { width: meta.width, height: meta.height },
            scale: 1,
            file,
            format: meta.format
          }
        ]);
      }
    }
  });

  it('shoots the store set as numbered PNGs laid out at 640×400 and shot at 2× (1280×800), one palette', () => {
    const store = targets.filter((target) => target.file.startsWith('store/'));
    expect(store.map((target) => target.file)).toEqual(
      STORE_SHOTS.map((shot) => `store/screenshots/${shot.name}.png`)
    );
    for (const target of store) {
      expect(target.viewport).toEqual({ width: 640, height: 400 });
      expect(target.scale).toBe(2);
      expect(target.palette).toBe(STORE_PALETTE);
      expect(target.format).toBe('png');
    }
    expect(STORE_VIEWPORT.width * STORE_SCALE).toBe(1280);
    expect(STORE_VIEWPORT.height * STORE_SCALE).toBe(800);
    // Store names sort in listing order.
    const names = STORE_SHOTS.map((shot) => shot.name);
    expect([...names].sort()).toEqual(names);
  });

  it('writes no file twice and uses only known stages', () => {
    const files = targets.map((target) => target.file);
    expect(new Set(files).size).toBe(files.length);
    for (const target of targets) expect(STAGE_IDS).toContain(target.stage);
  });

  it('refuses a registry id without a stage', () => {
    const meta = { width: 10, height: 10, format: 'webp' as const };
    expect(() => captureTargets({ orphan: meta }, {})).toThrow(/"orphan" has no stage/);
    expect(captureTargets({ a: meta }, { a: 'options' })[0]?.file).toBe(
      'public/whats-new/a-light.webp'
    );
  });

  it('is what the What’s new budget rows pin: one required row per build, one glob per file', () => {
    const rows = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'budgets.json'), 'utf8')) as {
      surface: string;
      globs?: string[];
      build?: string;
      required?: boolean;
    }[];
    const expected = targets
      .filter((target) => target.file.startsWith('public/'))
      .map((target) => target.file.slice('public/'.length))
      .sort();
    const imageRows = rows.filter((row) =>
      row.globs?.some((glob) => glob.startsWith('whats-new/'))
    );
    expect(imageRows.map((row) => row.build ?? 'chrome-mv3').sort()).toEqual([
      'chrome-mv3',
      'firefox-mv2'
    ]);
    for (const row of imageRows) {
      expect(row.required).toBe(true);
      expect([...(row.globs ?? [])].sort()).toEqual(expected);
    }
  });
});

describe('the committed images', () => {
  it('are each at its target size in device pixels (viewport × scale)', () => {
    for (const target of captureTargets()) {
      const size = readImageSize(readFileSync(path.join(ROOT, target.file)));
      expect(size, target.file).toEqual({
        width: target.viewport.width * target.scale,
        height: target.viewport.height * target.scale
      });
    }
  });
});

describe('freezeCacheStamp', () => {
  const footer = (stamp: string): string =>
    `<p>x</p>\n<!-- This website is like a Rocket - Debug: cached@${stamp} -->`;

  it('replaces every stamp’s digits and nothing else', () => {
    expect(freezeCacheStamp(footer('1763961844'), 1_700_000_000)).toBe(footer('1700000000'));
    expect(freezeCacheStamp(`${footer('1')}${footer('22')}`, 5)).toBe(
      `${footer('5')}${footer('5')}`
    );
  });

  it('leaves a page without a stamp, or with a non-digit token, unchanged', () => {
    expect(freezeCacheStamp('<p>no footer</p>', 1)).toBe('<p>no footer</p>');
    expect(freezeCacheStamp(footer('0x10'), 1)).toBe(footer('0x10'));
  });

  it('refuses a stamp that is not whole epoch seconds', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_VALUE]) {
      expect(() => freezeCacheStamp('', bad)).toThrow(/whole epoch seconds/);
    }
  });
});

describe('the frozen clock', () => {
  it('reads a whole-minute age in the past, at a whole second', () => {
    expect(FROZEN_CACHE_AGE_MS % 60_000).toBe(0);
    expect(FROZEN_CACHE_AGE_MS).toBeGreaterThan(0);
    expect((FROZEN_NOW_MS - FROZEN_CACHE_AGE_MS) % 1000).toBe(0);
  });
});

describe('SHOWCASE_PAGE', () => {
  it('is a plain slug and title, with no fixture-only copy or duplicated heading', () => {
    expect(SHOWCASE_PAGE.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(SHOWCASE_PAGE.title).toMatch(/^[\w -]+$/);
    expect(SHOWCASE_PAGE.html).not.toMatch(/<h1|\?fdt-|fixture/i);
  });
});

describe('selectTargets', () => {
  const targets = captureTargets();

  it('keeps everything without a filter', () => {
    expect(selectTargets(targets, undefined)).toEqual(targets);
    expect(selectTargets(targets, '  ')).toEqual(targets);
  });

  it('keeps only the named stages', () => {
    const picked = selectTargets(targets, 'options, toolbar-dot');
    expect(picked.length).toBeGreaterThan(0);
    expect(new Set(picked.map((target) => target.stage))).toEqual(
      new Set(['options', 'toolbar-dot'])
    );
  });

  it('names an unknown stage', () => {
    expect(() => selectTargets(targets, 'options,nope')).toThrow(/Unknown stage\(s\): nope/);
  });
});

describe('escapeHtml', () => {
  it('escapes markup and both quotes', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;'
    );
  });
});

describe('badgeCssColor', () => {
  it('turns the badge API answer into a CSS color', () => {
    expect(badgeCssColor([26, 127, 55, 255])).toBe('rgb(26 127 55 / 1)');
    expect(badgeCssColor([0, 0, 0, 0])).toBe('rgb(0 0 0 / 0)');
  });

  it('refuses anything but four 0–255 integer channels', () => {
    expect(() => badgeCssColor([1, 2, 3])).toThrow(/four 0–255 channels/);
    expect(() => badgeCssColor([1, 2, 3, 256])).toThrow(/four 0–255 channels/);
    expect(() => badgeCssColor([1, 2, 3.5, 255])).toThrow(/four 0–255 channels/);
  });
});

describe('toolbarMockHtml', () => {
  it('draws one toolbar per state with its dot color and tooltip', () => {
    const blue: ToolbarState = { ...GREEN, color: [9, 105, 218, 255], title: 'Tool · blue' };
    const html = toolbarMockHtml([GREEN, blue], 'light', 'data:image/png;base64,AAAA', 'site.test');
    expect(html.match(/class="row"/g)).toHaveLength(2);
    expect(html).toContain('color:rgb(26 127 55 / 1)">●<');
    expect(html).toContain('color:rgb(9 105 218 / 1)">●<');
    expect(html).toContain(
      '<div class="tip">Tool · WP Rocket active, page served from cache</div>'
    );
    expect(html).toContain('<div class="address">site.test</div>');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('draws each palette’s browser colors', () => {
    expect(toolbarMockHtml([GREEN], 'light', 'x', 'a')).toContain('background:#ffffff');
    expect(toolbarMockHtml([GREEN], 'dark', 'x', 'a')).toContain('background:#35363a');
  });

  it('escapes the texts it is given', () => {
    const html = toolbarMockHtml([{ ...GREEN, title: '<b>x</b>' }], 'dark', 'x"y', '<host>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('&lt;host&gt;');
    expect(html).toContain('src="x&quot;y"');
  });

  it('refuses an empty state list', () => {
    expect(() => toolbarMockHtml([], 'light', 'x', 'a')).toThrow(/at least one state/);
  });
});
