/**
 * Load CSS asynchronously over the real pass, in both engines: the swapped
 * link decides the row beside the fallback script, the generator meta keeps
 * its authority, the critical-path style is a fact only, the minify CSS row
 * reads swapped links, and `<noscript>` fallbacks never count.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WprDetections } from '../wp-rocket/types';
import { FIXTURE_DIR } from './fixtures/corpus';
import { runReferenceDetection } from './reference/engine';
import { runDetection } from './run-detection';

const CACHE_CSS = 'https://s.example/wp-content/cache/min/1/wp-content/themes/t/style.css?ver=1';
const MOVED_CSS = 'https://s.example/wp-content/wpr-files/min/1/wp-content/themes/t/style.css';
const CRITICAL = '<style id="rocket-critical-css">body{margin:0}</style>';

/** WP Rocket's swapped link (3.24 attribute order) over the given URL. */
function swapped(url: string, extra = '', rel = 'preload'): string {
  return `<link ${extra} rel='${rel}'  href='${url}' data-rocket-async="style" as="style" onload="this.onload=null;this.rel='stylesheet'" onerror="this.removeAttribute('data-rocket-async')"  media='all' />`;
}

/** A generator meta declaring the given tokens. */
function meta(tokens: string): string {
  return `<meta name="generator" content="WP Rocket 3.24" data-wpr-features="${tokens}">`;
}

/** A page around the given head/body markup. */
function page(head: string, body = ''): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

/** Run both engines, assert they agree key-for-key, return the port's detections. */
function detect(html: string): WprDetections {
  const port = runDetection(html).detections;
  const reference = runReferenceDetection(html).wprDetections;
  expect(port).toEqual(reference);
  expect(Object.keys(port.async_css)).toEqual(Object.keys(reference.async_css));
  return port;
}

describe('Load CSS asynchronously: the swapped link arm (both engines)', () => {
  it('decides the row alone and proves WP Rocket by propagation', () => {
    const d = detect(page(swapped('https://s.example/a.css')));
    expect(d.async_css).toEqual({ present: true, criticalStyle: false, source: 'footprint' });
    expect(d.wpr.present).toBe(true);
  });

  it('ignores a stamped link inside <noscript> and a foreign stamp value', () => {
    const fallback = detect(page('', `<noscript>${swapped('https://s.example/a.css')}</noscript>`));
    expect(fallback.async_css.present).toBe(false);
    expect(fallback.wpr.present).toBe(false);
    const foreign = detect(
      page(swapped('https://s.example/a.css').replace('async="style"', 'async="font"'))
    );
    expect(foreign.async_css.present).toBe(false);
  });

  it('keeps the meta authoritative: a refuting meta ignores the link, a declaring one needs none', () => {
    const refuted = detect(page(meta('wpr_minify_css') + CRITICAL + swapped(CACHE_CSS)));
    expect(refuted.async_css).toEqual({ present: false, criticalStyle: true, source: 'meta' });
    const declared = detect(page(meta('wpr_async_css')));
    expect(declared.async_css).toEqual({ present: true, criticalStyle: false, source: 'meta' });
    // An unusable (oversized) declaration decides nothing: the link does.
    const degraded = detect(page(meta('x'.repeat(8_193)) + swapped('https://s.example/a.css')));
    expect(degraded.async_css).toEqual({
      present: true,
      criticalStyle: false,
      source: 'footprint'
    });
  });

  it('records the critical style without changing the verdict', () => {
    const d = detect(page(CRITICAL, '<p>no async footprint</p>'));
    expect(d.async_css).toEqual({ present: false, criticalStyle: true });
  });

  it('matches the critical style id exactly, on standards and doctype-less pages', () => {
    // A doctype-less capture parses in quirks mode, where a browser's `#id`
    // matches case-insensitively (the test DOM has no quirks mode, so this
    // pins the exact compare both engines must make).
    const upper = '<style id="ROCKET-CRITICAL-CSS">body{margin:0}</style>';
    for (const html of [
      page(upper),
      `<html><head>${upper}</head><body></body></html>`,
      `<html><head>${CRITICAL}</head><body></body></html>`
    ]) {
      expect(detect(html).async_css.criticalStyle, html).toBe(html.includes(CRITICAL));
    }
  });
});

describe('Minify CSS over swapped links (both engines)', () => {
  it('reads the cache URL of a swapped link', () => {
    expect(detect(page(swapped(CACHE_CSS))).minify_css).toEqual({
      present: true,
      source: 'footprint'
    });
  });

  it('reads the minify stamp of a swapped link on a proven page (moved cache root)', () => {
    const d = detect(page(swapped(MOVED_CSS, 'data-minify="1"')));
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
  });

  it('never reads a minified <noscript> fallback', () => {
    // Proven by the swapped (unminified) link; the fallback holds the only
    // cache URL and the only stamp.
    const fallback = `<noscript><link data-minify="1" rel='stylesheet' href='${CACHE_CSS}' /></noscript>`;
    const d = detect(page(swapped('https://s.example/a.css'), fallback));
    expect(d.wpr.present).toBe(true);
    expect(d.minify_css).toEqual({ present: false });
  });
});

describe('port ≡ reference: stylesheet link variants', () => {
  const variants = [
    swapped(CACHE_CSS),
    swapped(CACHE_CSS, '', 'stylesheet'),
    swapped(MOVED_CSS, 'data-minify="1"'),
    swapped(MOVED_CSS, 'data-minify="1"', 'STYLESHEET'),
    `<link rel="preload" as="style" href="${CACHE_CSS}">`,
    `<link rel="preload" as="font" data-rocket-async="style" href="${CACHE_CSS}">`,
    `<link rel="preload" as="style" data-rocket-async="style" data-minify="1" href="">`,
    `<link rel="stylesheet" data-rocket-async="Style" href="${CACHE_CSS}">`,
    `<noscript>${swapped(CACHE_CSS)}</noscript>`,
    `<noscript><link rel="stylesheet" href="${CACHE_CSS}"></noscript>`,
    `<noscript><style id="rocket-critical-css"></style></noscript>`,
    CRITICAL
  ];
  for (const markup of variants) {
    it(markup, () => {
      // A cache footer proves WP Rocket, so the minify stamp's guard runs.
      const d = detect(page('', markup) + "<!-- This website is like a Rocket, isn't it? -->");
      expect(d.wpr.present).toBe(true);
    });
  }
});

describe('the async CSS fixture (WP Rocket 3.24 markup)', () => {
  it('decides async CSS by the link alone, the critical style and minify CSS, in both engines', () => {
    const d = detect(readFileSync(join(FIXTURE_DIR, 'async-css-link.html'), 'utf8'));
    expect(d.async_css).toEqual({ present: true, criticalStyle: true, source: 'footprint' });
    expect(d.minify_css).toEqual({ present: true, source: 'footprint' });
    expect(d.wpr.present).toBe(true);
  });
});
