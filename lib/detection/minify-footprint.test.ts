import { describe, expect, it } from 'vitest';
import {
  MINIFY_FOOTPRINT_ROWS,
  carriesMinifyAttribute,
  hasMinifyFootprint,
  minifyFootprint
} from './minify-footprint';
import { parsePage } from './parse-page';

const CACHE_CSS = 'https://s.example/wp-content/cache/min/1/wp-content/themes/t/style.css';
const CACHE_JS = 'https://s.example/wp-content/cache/min/1/wp-content/themes/t/app.js';
const MOVED_CSS = 'https://s.example/wp-content/wpr-files/min/1/wp-content/themes/t/style.css';
const MOVED_JS = 'https://s.example/wp-content/wpr-files/min/1/wp-content/themes/t/app.js';

/** A parsed page around the given body markup. */
function page(body: string) {
  return parsePage(`<!doctype html><html><head></head><body>${body}</body></html>`);
}

describe('minifyFootprint', () => {
  it('prefers the URL arm, then the exact attribute, else nothing', () => {
    expect(minifyFootprint(CACHE_CSS, '1', 'css')).toBe('url');
    expect(minifyFootprint(CACHE_CSS, null, 'css')).toBe('url');
    expect(minifyFootprint(MOVED_CSS, '1', 'css')).toBe('attribute');
    expect(minifyFootprint(MOVED_CSS, null, 'css')).toBeNull();
    expect(minifyFootprint(CACHE_JS, null, 'js')).toBe('url');
    // The row's own extension: a cache CSS URL is not a JS footprint.
    expect(minifyFootprint(CACHE_CSS, null, 'js')).toBeNull();
  });

  it('counts only the exact value WP Rocket writes', () => {
    for (const value of ['', '0', 'true', ' 1', '1 ', '01', 'yes']) {
      expect(minifyFootprint(MOVED_JS, value, 'js'), value).toBeNull();
    }
  });
});

describe('carriesMinifyAttribute', () => {
  it('reads data-minify="1" only, never data-no-minify', () => {
    const tags = page(
      '<script data-minify="1"></script><script data-minify="0"></script>' +
        '<script data-minify></script><script data-no-minify="1"></script><script></script>'
    ).scripts;
    expect(tags.map(carriesMinifyAttribute)).toEqual([true, false, false, false, false]);
  });
});

describe('hasMinifyFootprint', () => {
  it('walks the rows in registry order', () => {
    expect(MINIFY_FOOTPRINT_ROWS).toEqual(['minify_css', 'minify_js']);
  });

  it('reads stylesheet links only (exact rel), by resolved href', () => {
    expect(
      hasMinifyFootprint(
        page(`<link rel="stylesheet" data-minify="1" href="${MOVED_CSS}">`),
        'minify_css',
        'attribute'
      )
    ).toBe(true);
    // A non-stylesheet link is never a candidate, whatever it carries.
    for (const rel of ['preload', 'STYLESHEET', 'alternate stylesheet']) {
      const parsed = page(`<link rel="${rel}" data-minify="1" href="${CACHE_CSS}">`);
      expect(hasMinifyFootprint(parsed, 'minify_css', 'attribute'), rel).toBe(false);
      expect(hasMinifyFootprint(parsed, 'minify_css', 'url'), rel).toBe(false);
    }
    // The attribute arm needs a non-empty href (no or empty href ⇒ no candidate attribute).
    for (const tag of [
      '<link rel="stylesheet" data-minify="1">',
      '<link rel="stylesheet" data-minify="1" href="">'
    ]) {
      expect(hasMinifyFootprint(page(tag), 'minify_css', 'attribute'), tag).toBe(false);
    }
    // A relative cache href resolves like the property does.
    expect(
      hasMinifyFootprint(
        page('<link rel="stylesheet" href="/wp-content/cache/min/1/a.css">'),
        'minify_css',
        'url'
      )
    ).toBe(true);
  });

  it('keeps the arms apart: a URL match is never reported as attribute-only', () => {
    const parsed = page(`<script data-minify="1" src="${CACHE_JS}"></script>`);
    expect(hasMinifyFootprint(parsed, 'minify_js', 'url')).toBe(true);
    expect(hasMinifyFootprint(parsed, 'minify_js', 'attribute')).toBe(false);
  });

  it('reads a delayed script by its served URL', () => {
    const delayed = (url: string) =>
      page(
        `<script type="rocketlazyloadscript" data-minify="1" data-rocket-src="${url}"></script>`
      );
    expect(hasMinifyFootprint(delayed(CACHE_JS), 'minify_js', 'url')).toBe(true);
    expect(hasMinifyFootprint(delayed(MOVED_JS), 'minify_js', 'attribute')).toBe(true);
  });

  it('skips scripts naming no served URL (the empty-URL gate), both arms', () => {
    for (const tag of [
      '<script data-minify="1">var a = 1;</script>',
      '<script data-minify="1" src=""></script>',
      '<script type="rocketlazyloadscript" data-minify="1" data-rocket-src=""></script>'
    ]) {
      expect(hasMinifyFootprint(page(tag), 'minify_js', 'attribute'), tag).toBe(false);
      expect(hasMinifyFootprint(page(tag), 'minify_js', 'url'), tag).toBe(false);
    }
  });

  it('counts a Combine bundle as a minify URL (the shipped URL arm)', () => {
    const bundle = 'https://s.example/wp-content/cache/min/1/e90a1f4c0d2b3a4c5d6e7f8091a2b3c4.js';
    expect(
      hasMinifyFootprint(
        page(`<script src="${bundle}" data-minify="1"></script>`),
        'minify_js',
        'url'
      )
    ).toBe(true);
  });
});
