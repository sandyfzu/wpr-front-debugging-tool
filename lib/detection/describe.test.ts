/**
 * The page-analysis view model: real feature names, evidence-true states
 * (including the composed Priority Elements collecting/not-enabled states),
 * counts instead of page content, and the deterministic UTC cache timestamp.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  absoluteStampFromMs,
  describeDetections,
  formatCacheTimestamp,
  type PageAnalysisReport,
  MAX_REPRESENTABLE_MS
} from './describe';
import { runDetection } from './run-detection';
import { type FIXTURES, FIXTURE_DIR } from './fixtures/corpus';
import type { WprDetections } from '../wp-rocket/types';

/** The engine's zero page: every feature absent, beacon absent, no config. */
function zeroDetections(): WprDetections {
  return {
    wpr: { present: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [] },
    async_css: { present: false },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
    lazyload_css_bg_img: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    rocket_above_the_fold_optimization: { present: false, lcpComment: false },
    automatic_lazy_rendering: {
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 0
    },
    auto_preload_fonts: { present: false, fonts: [] },
    preconnect_external_domains: { present: false, domains: [], preconnectCount: 0 },
    priority_elements_beacon: { present: false, status: null, isMobile: null }
  };
}

describe('describeDetections', () => {
  it('reports a page without WP Rocket as fully not applied, truthfully', () => {
    const report = describeDetections(zeroDetections());
    expect(report['WP Rocket']).toEqual({
      'plugin detected': false,
      'page served from cache': false,
      version: null,
      'cache generated at': null
    });
    expect(report['Remove Unused CSS']).toEqual({ state: 'not applied' });
    expect(report['Delay JavaScript execution']).toEqual({
      state: 'not applied',
      'delayed scripts': 0,
      'delay library version': null
    });
    expect(report['Priority Elements beacon']).toEqual({
      detected: false,
      'configured device': 'unknown',
      'enabled features': []
    });
    expect(report['Optimize critical images']).toEqual({
      state: 'not applied',
      'preloaded images': 0
    });
  });

  it('names and counts a fully applied cached page, with the UTC cache time', () => {
    const page = zeroDetections();
    page.wpr = {
      present: true,
      cached: true,
      version: '3.19.0.3',
      timeStamp: 1730000000
    };
    page.remove_unused_css = { present: true };
    page.delay_js = { present: true, scripts: [{} as never], version: '1.2.3', delayedScripts: 4 };
    page.defer_all_js = { present: true, scripts: ['a', 'b', 'c'] };
    page.lazyload = { present: true, images: [{} as never, {} as never] };
    page.minify_css = { present: true };
    page.rocket_cdn = { present: true };
    const report: PageAnalysisReport = describeDetections(page);
    expect(report['WP Rocket']).toEqual({
      'plugin detected': true,
      'page served from cache': true,
      version: '3.19.0.3',
      'cache generated at': '2024-10-27 03:33:20 UTC'
    });
    expect(report['Delay JavaScript execution']).toEqual({
      state: 'applied',
      'delayed scripts': 4,
      'delay library version': '1.2.3'
    });
    expect(report['Load JavaScript deferred']).toEqual({
      state: 'applied',
      'deferred scripts': 3
    });
    expect(report['Image LazyLoad']).toEqual({ state: 'applied', 'lazy-loaded images': 2 });
    expect(report.RocketCDN).toEqual({ state: 'applied' });
  });

  it('composes collecting / not enabled from the beacon config for the family', () => {
    const page = zeroDetections();
    // The plugin's verified controller asymmetry, exercised: the fonts
    // controller OMITS its key when disallowed, the others set false — both
    // must read "not enabled", while true keys read "collecting".
    page.priority_elements_beacon = {
      present: true,
      status: { atf: true, lrc: false, preconnect_external_domain: true },
      isMobile: false
    };
    const report = describeDetections(page);
    // Applied beats config truth; withheld or false context reads "not
    //  enabled".
    expect(report['Optimize critical images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Automatic lazy rendering']).toEqual({
      state: 'not enabled',
      'converted elements': 0,
      'render hashes on page': 0
    });
    expect(report['Preload fonts']).toEqual({ state: 'not enabled', 'preloaded fonts': 0 });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'desktop',
      'enabled features': ['Optimize critical images', 'Preconnect to external domains']
    });
  });

  it('beacon absent but ALR render hashes stamped: markup collecting truth wins', () => {
    const page = zeroDetections();
    page.automatic_lazy_rendering = {
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: true,
      locationHashes: 6
    };
    const report = describeDetections(page);
    expect(report['Automatic lazy rendering']).toEqual({
      state: 'collecting',
      'converted elements': 0,
      'render hashes on page': 6
    });
  });

  it('applied evidence beats a collecting config: mixed pages read row by row', () => {
    const page = zeroDetections();
    page.priority_elements_beacon = {
      present: true,
      status: { atf: true, lrc: true, preload_fonts: true, preconnect_external_domain: true },
      isMobile: null
    };
    page.auto_preload_fonts = { present: true, fonts: ['a', 'b'] };
    page.preconnect_external_domains = { present: true, domains: ['x'], preconnectCount: 1 };
    const report = describeDetections(page);
    expect(report['Preload fonts']).toEqual({ state: 'applied', 'preloaded fonts': 2 });
    expect(report['Preconnect to external domains']).toEqual({
      state: 'applied',
      'domains hinted': 1
    });
    expect(report['Optimize critical images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Priority Elements beacon']['configured device']).toBe('unknown');
  });
});

describe('formatCacheTimestamp', () => {
  it('formats epoch seconds as a locale-independent UTC stamp', () => {
    expect(formatCacheTimestamp(null)).toBeNull();
    expect(formatCacheTimestamp(0)).toBe('1970-01-01 00:00:00 UTC');
    expect(formatCacheTimestamp(1730000000)).toBe('2024-10-27 03:33:20 UTC');
  });

  it('answers null instead of crashing on a page-derived stamp outside the platform date range', () => {
    // The stamp is page-controlled text (the debug comment's digits); a value
    // this large is not a time — `new Date(...*1000).toISOString()` would
    // throw `RangeError` unguarded, and the caller's whole answer would die.
    const boundarySeconds = 8.64e12; // 8.64e15 ms — the exact platform maximum.
    expect(formatCacheTimestamp(boundarySeconds)).not.toBeNull();
    expect(formatCacheTimestamp(boundarySeconds + 1)).toBeNull();
    expect(formatCacheTimestamp(9_999_999_999_999)).toBeNull();
    expect(formatCacheTimestamp(-9_999_999_999_999)).toBeNull();
    expect(formatCacheTimestamp(Number.NaN)).toBeNull();
  });
});

describe('absoluteStampFromMs', () => {
  it('formats a millisecond stamp in the shared UTC form, rounded to the second', () => {
    expect(absoluteStampFromMs(Date.UTC(2026, 9, 14, 20, 47, 7, 400))).toBe(
      '2026-10-14 20:47:07 UTC'
    );
    expect(absoluteStampFromMs(Date.UTC(2026, 9, 14, 20, 47, 7, 600))).toBe(
      '2026-10-14 20:47:08 UTC'
    );
  });

  it('answers null for a stamp that names no representable instant (never a throw)', () => {
    expect(absoluteStampFromMs(Number.NaN)).toBeNull();
    expect(absoluteStampFromMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(absoluteStampFromMs(Number.NEGATIVE_INFINITY)).toBeNull();
    // Just past the ceiling: rounding to seconds must not resurrect a stamp
    // that names no instant (the ceiling itself is the last real one).
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS + 1)).toBeNull();
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS + 499)).toBeNull();
    expect(absoluteStampFromMs(-MAX_REPRESENTABLE_MS - 1)).toBeNull();
  });

  it('accepts the representable edge exactly', () => {
    // The platform maximum instant is the one overflow-shaped stamp that is
    // real; its text rides the shared formatter (year-overlong slice).
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS)).toMatch(/^\+275760-09-13 .* UTC$/);
  });
});

describe('describeDetections over the real engine (fixture corpus)', () => {
  /** Every report row, pinned once: real pages must carry the complete shape. */
  const ALL_ROWS: string[] = [
    'WP Rocket',
    'Remove Unused CSS',
    'Delay JavaScript execution',
    'Load JavaScript deferred',
    'Load CSS asynchronously',
    'Image LazyLoad',
    'Iframes and videos LazyLoad',
    'CSS background images LazyLoad',
    'Minify CSS',
    'Minify JavaScript',
    'Preload links',
    'RocketCDN',
    'Optimize critical images',
    'Automatic lazy rendering',
    'Preload fonts',
    'Preconnect to external domains',
    'Priority Elements beacon'
  ];

  /** The corpus fixture's HTML, read the same way the pass tests read it. */
  const fixture = (name: (typeof FIXTURES)[number]): string =>
    readFileSync(join(FIXTURE_DIR, name), 'utf8');

  /** The view model of a full real pass over one corpus fixture. */
  const analyze = (name: (typeof FIXTURES)[number]): PageAnalysisReport => {
    const report = describeDetections(runDetection(fixture(name)).detections);
    // Shape-drift catcher, on every page: all rows under real input, no more.
    expect(Object.keys(report).sort()).toEqual([...ALL_ROWS].sort());
    return report;
  };

  it('reads the cached home page: exact WP Rocket row with the UTC cache time', () => {
    const report = analyze('me-home-cached.html');
    expect(report['WP Rocket']).toEqual({
      'plugin detected': true,
      'page served from cache': true,
      version: '3.20.0.2',
      'cache generated at': '2026-10-07 03:04:01 UTC'
    });
  });

  it('reads the pending page: every family feature composing to "collecting"', () => {
    const report = analyze('priority-elements-pending.html');
    expect(report['Optimize critical images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Automatic lazy rendering']).toEqual({
      state: 'collecting',
      'converted elements': 0,
      'render hashes on page': 0
    });
    expect(report['Preload fonts']).toEqual({ state: 'collecting', 'preloaded fonts': 0 });
    expect(report['Preconnect to external domains']).toEqual({
      state: 'collecting',
      'domains hinted': 0
    });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'desktop',
      'enabled features': [
        'Optimize critical images',
        'Automatic lazy rendering',
        'Preload fonts',
        'Preconnect to external domains'
      ]
    });
  });

  it('reads the mixed page: per-feature assembly over one config', () => {
    const report = analyze('mixed-partial-applied.html');
    expect(report['Optimize critical images']).toEqual({
      state: 'applied',
      'preloaded images': 1
    });
    expect(report['Automatic lazy rendering']).toEqual({
      state: 'collecting',
      'converted elements': 0,
      'render hashes on page': 2
    });
    // The corpus's real config: fonts omitted, preconnect false — both the
    // plugin's own ways of saying "not enabled here".
    expect(report['Preload fonts']).toEqual({ state: 'not enabled', 'preloaded fonts': 0 });
    expect(report['Preconnect to external domains']).toEqual({
      state: 'not enabled',
      'domains hinted': 0
    });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'mobile',
      'enabled features': ['Optimize critical images', 'Automatic lazy rendering']
    });
  });
});
