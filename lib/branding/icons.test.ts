import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EXTENSION_ICONS,
  PADDED_ART_RATIO,
  TOOLBAR_ICON_SIZES,
  iconOfSize,
  toolbarIconMap
} from './icons';

/* The icon set table and its consumers: committed files, toolbar map, extension-page favicons. */

/** Extension pages that can show in a tab (or a DevTools panel) and so carry favicons. */
const PAGES_WITH_FAVICONS = [
  'entrypoints/options/index.html',
  'entrypoints/data-consent/index.html',
  'entrypoints/panel/index.html'
];

describe('EXTENSION_ICONS', () => {
  it('declares exactly the shipped sizes and layouts', () => {
    expect(EXTENSION_ICONS).toEqual([
      { size: 16, layout: 'full-bleed', path: 'icon/16.png' },
      { size: 32, layout: 'full-bleed', path: 'icon/32.png' },
      { size: 48, layout: 'padded', path: 'icon/48.png' },
      { size: 96, layout: 'padded', path: 'icon/96.png' },
      { size: 128, layout: 'padded', path: 'icon/128.png' }
    ]);
  });

  it('names each path after its size where WXT discovers manifest icons (`icon/<size>.png`)', () => {
    for (const icon of EXTENSION_ICONS) expect(icon.path).toBe(`icon/${String(icon.size)}.png`);
  });

  it('pads to 96 of 128 px (16 px transparent per side)', () => {
    expect(PADDED_ART_RATIO * 128).toBe(96);
    expect(((1 - PADDED_ART_RATIO) / 2) * 128).toBe(16);
  });

  it.each(EXTENSION_ICONS.map((icon) => [icon.path]))('%s is committed under public/', (path) => {
    expect(existsSync(`public/${path}`)).toBe(true);
  });
});

describe('iconOfSize', () => {
  it('returns the row of a declared size', () => {
    expect(iconOfSize(32)).toEqual({ size: 32, layout: 'full-bleed', path: 'icon/32.png' });
  });

  it('throws naming an undeclared size', () => {
    expect(() => iconOfSize(24)).toThrow('No 24 px extension icon is declared');
  });
});

describe('toolbar icons', () => {
  it('are the full-bleed sizes, mapped for `default_icon`', () => {
    for (const size of TOOLBAR_ICON_SIZES) expect(iconOfSize(size).layout).toBe('full-bleed');
    expect(toolbarIconMap()).toEqual({ '16': 'icon/16.png', '32': 'icon/32.png' });
  });
});

describe('extension-page favicons', () => {
  it.each(PAGES_WITH_FAVICONS.map((page) => [page]))(
    '%s links the toolbar icons, root-relative, with their sizes',
    (page) => {
      const html = readFileSync(page, 'utf8');
      const links = [...html.matchAll(/<link rel="icon"([^>]*)\/>/g)].map((match) => match[1]);
      expect(links).toEqual(
        TOOLBAR_ICON_SIZES.map(
          (size) =>
            ` type="image/png" sizes="${String(size)}x${String(size)}" href="/${iconOfSize(size).path}" `
        )
      );
    }
  );
});
