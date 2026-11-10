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
  type FeatureState,
  type PageAnalysisReport,
  MAX_REPRESENTABLE_MS
} from './describe';
import { runDetection } from './run-detection';
import { type FIXTURES, FIXTURE_DIR } from './fixtures/corpus';
import type { WprDetections } from '../wp-rocket/types';

/** The engine's zero page: every feature absent, beacon absent, no config. */
function zeroDetections(): WprDetections {
  return {
    wpr: { present: false, cacheMarkerFound: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    async_css: { present: false, criticalStyle: false },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    minify_concatenate_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    mobile_cache: { present: false, variant: null },
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
      'page cache': 'Not applicable (WP Rocket not detected)',
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
    expect(report['Optimize Critical Images']).toEqual({
      state: 'not applied',
      'preloaded images': 0
    });
  });

  it('reads the explicit cache state instead of inventing one from absence', () => {
    const page = zeroDetections();
    page.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: false,
      version: null,
      timeStamp: null
    };
    expect(
      describeDetections(page, { kind: 'uncertain-signature' })['WP Rocket']['page cache']
    ).toBe('Plugin fingerprint found, cache not proven for this visit');
    expect(
      describeDetections(page, { kind: 'possibly-cached', evidence: 'Cloudflare' })['WP Rocket'][
        'page cache'
      ]
    ).toContain('Cloudflare');
    // Without an explicit state the report derives the signature-only answer
    // and says the headers were unavailable — never a cache verdict.
    expect(describeDetections(page)['WP Rocket']['page cache']).toBe(
      'Plugin fingerprint found, cache not proven for this visit'
    );
    // An absent plugin has no cache question, even if a caller passes a state.
    const absent = zeroDetections();
    expect(
      describeDetections(absent, { kind: 'bypass-requested' })['WP Rocket']['page cache']
    ).toBe('Not applicable (WP Rocket not detected)');
  });

  it('names and counts a fully applied cached page, with the UTC cache time', () => {
    const page = zeroDetections();
    page.wpr = {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.19.0.3',
      timeStamp: 1730000000
    };
    page.remove_unused_css = { present: true };
    page.delay_js = { present: true, scripts: [{} as never], version: '1.2.3', delayedScripts: 4 };
    page.defer_all_js = { present: true, scripts: ['a', 'b', 'c'], deferredScripts: 3 };
    // Two lazy-loaded images and one the plugin left eager: only the first
    // two count (owner decision O-N6).
    const image = (lazyloadDetected: boolean) => ({
      src: 'a.jpg',
      lazyloadDetected,
      excludedReasonsFound: []
    });
    page.lazyload = { present: true, images: [image(true), image(false), image(true)] };
    page.minify_css = { present: true };
    page.rocket_cdn = { present: true };
    const report: PageAnalysisReport = describeDetections(page);
    expect(report['WP Rocket']).toEqual({
      'plugin detected': true,
      'page cache': 'Cached, generated 2024-10-27 03:33:20 UTC',
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
    expect(report['LazyLoad for images']).toEqual({ state: 'applied', 'lazy-loaded images': 2 });
    expect(report['Content Delivery Network']).toEqual({ state: 'applied' });
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
    expect(report['Optimize Critical Images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Automatic Lazy Rendering']).toEqual({
      state: 'not enabled',
      'converted elements': 0,
      'render hashes on page': 0
    });
    expect(report['Preload fonts']).toEqual({ state: 'not enabled', 'preloaded fonts': 0 });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'desktop',
      'enabled features': ['Optimize Critical Images', 'Preconnect to External Domains']
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
    expect(report['Automatic Lazy Rendering']).toEqual({
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
    expect(report['Preconnect to External Domains']).toEqual({
      state: 'applied',
      'domains hinted': 1
    });
    expect(report['Optimize Critical Images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Priority Elements beacon']['configured device']).toBe('unknown');
  });

  it('meta refutation is an applied-marker fact: collecting states stay collecting', () => {
    const status = { atf: true, lrc: true, preload_fonts: true, preconnect_external_domain: true };
    const cases: Array<{
      name: string;
      row: WprDetections['automatic_lazy_rendering'];
      beacon: WprDetections['priority_elements_beacon'];
      expected: FeatureState;
    }> = [
      {
        name: 'refuted + location hash',
        row: {
          present: false,
          source: 'meta',
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 1
        },
        beacon: { present: false, status: null, isMobile: null },
        expected: 'collecting'
      },
      {
        name: 'refuted + beacon config true',
        row: {
          present: false,
          source: 'meta',
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: true, status, isMobile: false },
        expected: 'collecting'
      },
      {
        name: 'refuted + no lower evidence',
        row: {
          present: false,
          source: 'meta',
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: false, status: null, isMobile: null },
        expected: 'not applied'
      },
      {
        name: 'refuted + beacon config false',
        row: {
          present: false,
          source: 'meta',
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: true, status: { ...status, lrc: false }, isMobile: false },
        expected: 'not enabled'
      },
      {
        name: 'declared + no markup',
        row: {
          present: true,
          source: 'meta',
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: false, status: null, isMobile: null },
        expected: 'applied'
      },
      {
        name: 'absent + location hash',
        row: {
          present: false,
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 2
        },
        beacon: { present: false, status: null, isMobile: null },
        expected: 'collecting'
      },
      {
        name: 'absent + beacon config true',
        row: {
          present: false,
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: true, status, isMobile: false },
        expected: 'collecting'
      },
      {
        name: 'absent + beacon config false',
        row: {
          present: false,
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: true, status: { ...status, lrc: false }, isMobile: false },
        expected: 'not enabled'
      },
      {
        name: 'absent + nothing',
        row: {
          present: false,
          lazyRenderElements: 0,
          inlineCssPresent: false,
          locationHashes: 0
        },
        beacon: { present: false, status: null, isMobile: null },
        expected: 'not applied'
      }
    ];
    for (const testCase of cases) {
      const page = zeroDetections();
      page.automatic_lazy_rendering = testCase.row;
      page.priority_elements_beacon = testCase.beacon;
      expect(describeDetections(page)['Automatic Lazy Rendering'].state, testCase.name).toBe(
        testCase.expected
      );
    }
  });

  it('a meta-refuted family keeps the beacon config as a config fact', () => {
    const page = zeroDetections();
    page.priority_elements_beacon = {
      present: true,
      status: { atf: true, lrc: true, preload_fonts: true, preconnect_external_domain: true },
      isMobile: false
    };
    page.rocket_above_the_fold_optimization = { present: false, source: 'meta', lcpComment: false };
    page.automatic_lazy_rendering = {
      present: false,
      source: 'meta',
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 0
    };
    page.auto_preload_fonts = { present: false, source: 'meta', fonts: [] };
    page.preconnect_external_domains = {
      present: false,
      source: 'meta',
      domains: [],
      preconnectCount: 0
    };
    const report = describeDetections(page);
    for (const label of [
      'Optimize Critical Images',
      'Automatic Lazy Rendering',
      'Preload fonts',
      'Preconnect to External Domains'
    ] as const) {
      expect(report[label].state, label).toBe('collecting');
    }
    expect(report['Priority Elements beacon']['enabled features']).toEqual([
      'Optimize Critical Images',
      'Automatic Lazy Rendering',
      'Preload fonts',
      'Preconnect to External Domains'
    ]);
  });
});

describe('formatCacheTimestamp', () => {
  it('formats epoch seconds as a locale-independent UTC stamp', () => {
    expect(formatCacheTimestamp(null)).toBeNull();
    expect(formatCacheTimestamp(0)).toBe('1970-01-01 00:00:00 UTC');
    expect(formatCacheTimestamp(1730000000)).toBe('2024-10-27 03:33:20 UTC');
    expect(formatCacheTimestamp(253_402_300_799)).toBe('9999-12-31 23:59:59 UTC');
  });

  it('answers null outside the non-negative four-digit-year display domain', () => {
    expect(formatCacheTimestamp(253_402_300_800)).toBeNull();
    expect(formatCacheTimestamp(8.64e12)).toBeNull();
    expect(formatCacheTimestamp(9_999_999_999_999)).toBeNull();
    expect(formatCacheTimestamp(1e26)).toBeNull();
    expect(formatCacheTimestamp(-1)).toBeNull();
    expect(formatCacheTimestamp(-9_999_999_999_999)).toBeNull();
    expect(formatCacheTimestamp(1.5)).toBeNull();
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

  it('answers null for a stamp that names no displayable instant (never a throw)', () => {
    expect(absoluteStampFromMs(Number.NaN)).toBeNull();
    expect(absoluteStampFromMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(absoluteStampFromMs(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS + 1)).toBeNull();
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS + 499)).toBeNull();
    expect(absoluteStampFromMs(-MAX_REPRESENTABLE_MS - 1)).toBeNull();
  });

  it('applies the cache display ceiling to machine stamps too', () => {
    expect(absoluteStampFromMs(Date.UTC(9999, 11, 31, 23, 59, 59))).toBe('9999-12-31 23:59:59 UTC');
    // The platform's expanded-year edge is not a displayable cache instant.
    expect(absoluteStampFromMs(MAX_REPRESENTABLE_MS)).toBeNull();
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
    'LazyLoad for images',
    'LazyLoad for iframes/videos',
    'LazyLoad CSS backgrounds',
    'Self-host Google Fonts',
    'Add missing image dimensions',
    'Minify CSS files',
    'Minify JavaScript files',
    'Combine JavaScript files',
    'Preload Links',
    'Content Delivery Network',
    'Separate cache files for mobile devices',
    'Optimize Critical Images',
    'Automatic Lazy Rendering',
    'Preload fonts',
    'Preconnect to External Domains',
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
      'page cache': 'Cached, generated 2026-10-07 03:04:01 UTC',
      version: '3.20.0.2',
      'cache generated at': '2026-10-07 03:04:01 UTC'
    });
  });

  it('reads the pending page: every family feature composing to "collecting"', () => {
    const report = analyze('priority-elements-pending.html');
    expect(report['Optimize Critical Images']).toEqual({
      state: 'collecting',
      'preloaded images': 0
    });
    expect(report['Automatic Lazy Rendering']).toEqual({
      state: 'collecting',
      'converted elements': 0,
      'render hashes on page': 0
    });
    expect(report['Preload fonts']).toEqual({ state: 'collecting', 'preloaded fonts': 0 });
    expect(report['Preconnect to External Domains']).toEqual({
      state: 'collecting',
      'domains hinted': 0
    });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'desktop',
      'enabled features': [
        'Optimize Critical Images',
        'Automatic Lazy Rendering',
        'Preload fonts',
        'Preconnect to External Domains'
      ]
    });
  });

  it('reads the mixed page: per-feature assembly over one config', () => {
    const report = analyze('mixed-partial-applied.html');
    expect(report['Optimize Critical Images']).toEqual({
      state: 'applied',
      'preloaded images': 1
    });
    expect(report['Automatic Lazy Rendering']).toEqual({
      state: 'collecting',
      'converted elements': 0,
      'render hashes on page': 2
    });
    // The corpus's real config: fonts omitted, preconnect false — both the
    // plugin's own ways of saying "not enabled here".
    expect(report['Preload fonts']).toEqual({ state: 'not enabled', 'preloaded fonts': 0 });
    expect(report['Preconnect to External Domains']).toEqual({
      state: 'not enabled',
      'domains hinted': 0
    });
    expect(report['Priority Elements beacon']).toEqual({
      detected: true,
      'configured device': 'mobile',
      'enabled features': ['Optimize Critical Images', 'Automatic Lazy Rendering']
    });
  });
});
