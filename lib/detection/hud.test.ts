/**
 * The HUD registry's pins: one row per feature detection row (exhaustive
 * against the meta-token registry), full names only from the verified label
 * set, compact wordings pinned to the plugin strings they were verified
 * against, groups/order, and the reading matrix (verdict, count, source,
 * why) over every state the report composes.
 */
import { describe, expect, it } from 'vitest';
import { FEATURE_META_TOKENS } from '../wp-rocket/constants';
import type { FeatureMetaRow, WprDetections } from '../wp-rocket/types';
import { describeDetections } from './describe';
import {
  COLLECTING_WHY,
  HUD_FEATURES,
  HUD_GROUPS,
  hudFeatureOf,
  hudGroupedFeatures,
  hudStateLine,
  readHudFeature,
  SOURCE_COPY,
  SOURCE_REPORT_TEXT,
  type HudFeature
} from './hud';
import { FEATURE_LABELS, LABEL_PRIORITY_ELEMENTS_BEACON } from './labels';

/** The engine's zero page, fresh per call. */
function zero(): WprDetections {
  return {
    wpr: { present: false, cacheMarkerFound: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    async_css: { present: false, criticalStyle: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    minify_concatenate_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
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

/** A zero page WP Rocket handled (the plugin row present). */
function handled(): WprDetections {
  return {
    ...zero(),
    wpr: { present: true, cacheMarkerFound: true, cached: false, version: '3.23', timeStamp: null }
  };
}

/** The HUD row of a detection row (throws when absent, so a typo fails loudly). */
function feature(row: FeatureMetaRow): HudFeature {
  const found = hudFeatureOf(row);
  if (found === undefined) throw new Error(`no HUD row for ${row}`);
  return found;
}

/** Read one row over a detections set. */
function read(row: FeatureMetaRow, detections: WprDetections) {
  return readHudFeature(feature(row), describeDetections(detections), detections);
}

describe('the HUD registry shape', () => {
  it('has exactly one row per feature detection row (the meta registry is the key set)', () => {
    const rows = HUD_FEATURES.map((entry) => entry.row);
    expect(new Set(rows).size).toBe(rows.length);
    expect([...rows].sort()).toEqual(Object.keys(FEATURE_META_TOKENS).sort());
  });

  it('full names come only from the verified label set, beacon excluded, each once', () => {
    const labels = HUD_FEATURES.map((entry) => entry.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect([...labels].sort()).toEqual(
      FEATURE_LABELS.filter((label) => label !== LABEL_PRIORITY_ELEMENTS_BEACON).sort()
    );
  });

  it('compact wordings are the plugin strings they were verified against', () => {
    // Literals restated: WP Rocket 3.23.5.1 support-data option names, the
    // settings page's field/section titles and the Priority Elements notice.
    expect(Object.fromEntries(HUD_FEATURES.map((entry) => [entry.row, entry.shortLabel]))).toEqual({
      remove_unused_css: 'Remove Unused CSS',
      delay_js: 'Delay JS',
      defer_all_js: 'Defer JS',
      async_css: 'Load CSS asynchronously',
      minify_css: 'Minify CSS',
      minify_js: 'Minify JS',
      minify_concatenate_js: 'Combine JS',
      lazyload: 'Lazyload Images',
      lazyload_iframes: 'Lazyload Iframes',
      lazyload_css_bg_img: 'Lazyload CSS Background Images',
      image_dimensions: 'Image Dimensions',
      self_hosted_fonts: 'Self-host Google Fonts',
      preload_links: 'Preload Links',
      rocket_cdn: 'CDN',
      rocket_above_the_fold_optimization: 'Critical Images',
      automatic_lazy_rendering: 'Automatic Lazy Rendering',
      auto_preload_fonts: 'Preload Fonts',
      preconnect_external_domains: 'Preconnect to External Domains'
    });
  });

  it('no compact wording is an acronym the plugin does not print', () => {
    for (const entry of HUD_FEATURES) {
      expect(entry.shortLabel, entry.row).not.toMatch(/\b(RUCSS|CPCSS|SHGF|OCI|ALR|LRC|DJE)\b/);
    }
  });

  it('a unit and a count reader are declared together, never one without the other', () => {
    for (const entry of HUD_FEATURES) {
      expect(entry.unit === null, entry.row).toBe(entry.count === null);
    }
  });

  it('only the rows whose footprint cannot prove absence declare undecided copy', () => {
    const undecided = HUD_FEATURES.filter((entry) => entry.undecided !== null).map(
      (entry) => entry.row
    );
    expect(undecided).toEqual(['minify_concatenate_js', 'image_dimensions', 'self_hosted_fonts']);
  });

  it('non-feature rows have no HUD row', () => {
    expect(hudFeatureOf('wpr')).toBeUndefined();
    expect(hudFeatureOf('priority_elements_beacon')).toBeUndefined();
    expect(hudFeatureOf('future_feature')).toBeUndefined();
  });
});

describe('hudGroupedFeatures', () => {
  it('renders the groups in order, rows in registry order, every row exactly once', () => {
    const grouped = hudGroupedFeatures();
    expect(grouped.map((group) => group.heading)).toEqual([
      'JavaScript & CSS',
      'Image & Media',
      'Preload',
      'Content Delivery',
      'Features'
    ]);
    expect(grouped.map((group) => group.id)).toEqual(HUD_GROUPS.map((group) => group.id));
    // Registry order IS render order: grouping never reorders a row.
    expect(grouped.flatMap((group) => group.features)).toEqual(HUD_FEATURES);
    expect(grouped.find((group) => group.id === 'media')?.features.map((f) => f.row)).toEqual([
      'lazyload',
      'lazyload_iframes',
      'lazyload_css_bg_img',
      'image_dimensions',
      'self_hosted_fonts'
    ]);
  });
});

describe('readHudFeature — the reading matrix', () => {
  it('applied with a count, the deciding source carried', () => {
    const detections = handled();
    detections.delay_js = {
      present: true,
      scripts: [],
      version: null,
      delayedScripts: 4,
      source: 'footprint'
    };
    expect(read('delay_js', detections)).toEqual({
      verdict: 'applied',
      count: 4,
      source: 'footprint',
      why: null
    });
  });

  it('not applied without a unit reads a null count and no why', () => {
    expect(read('minify_css', handled())).toEqual({
      verdict: 'not applied',
      count: null,
      source: null,
      why: null
    });
  });

  it('meta-refuted rows read not applied with the meta source', () => {
    const detections = handled();
    detections.minify_js = { present: false, source: 'meta' };
    expect(read('minify_js', detections)).toMatchObject({ verdict: 'not applied', source: 'meta' });
  });

  it('collecting family rows carry the collecting why (composed by the report)', () => {
    const detections = handled();
    detections.priority_elements_beacon = { present: true, status: { lrc: true }, isMobile: null };
    expect(read('automatic_lazy_rendering', detections)).toEqual({
      verdict: 'collecting',
      count: 0,
      source: null,
      why: COLLECTING_WHY
    });
  });

  it('a withheld context reads not enabled (no why — it is a configuration fact)', () => {
    const detections = handled();
    detections.priority_elements_beacon = {
      present: true,
      status: { preload_fonts: false },
      isMobile: null
    };
    expect(read('auto_preload_fonts', detections)).toMatchObject({
      verdict: 'not enabled',
      why: null
    });
  });

  it.each(['image_dimensions', 'self_hosted_fonts'] as const)(
    'undecided %s on a handled page is unknown with its own why',
    (row) => {
      const reading = read(row, handled());
      expect(reading.verdict).toBe('unknown');
      expect(reading.why).toBe(feature(row).undecided);
    }
  );

  it.each(['image_dimensions', 'self_hosted_fonts'] as const)(
    'undecided %s on a plugin-absent page is plainly not applied',
    (row) => {
      expect(read(row, zero())).toMatchObject({ verdict: 'not applied', why: null });
    }
  );

  it.each([
    ['meta', true, 'applied'],
    ['meta', false, 'not applied'],
    ['footprint', true, 'applied']
  ] as const)('decided self_hosted_fonts (%s, present %s) reads %s', (source, present, verdict) => {
    const detections = handled();
    detections.self_hosted_fonts = { present, source };
    expect(read('self_hosted_fonts', detections)).toMatchObject({ verdict, source, why: null });
  });
});

describe('hudStateLine', () => {
  const delay = feature('delay_js');
  const rucss = feature('remove_unused_css');
  it.each([
    [delay, 'applied', 3, 'applied on this page: 3 scripts.'],
    [rucss, 'applied', null, 'applied on this page.'],
    [rucss, 'collecting', null, COLLECTING_WHY],
    [rucss, 'not enabled', null, "not enabled in the site's current configuration."],
    [
      rucss,
      'not applied',
      null,
      "nothing matched on this page (the page may predate the plugin's work)."
    ]
  ] as const)('%#: %s reads its line', (entry, verdict, count, expected) => {
    expect(hudStateLine(entry, { verdict, count, source: null, why: null })).toBe(expected);
  });

  it('a meta-refuted row never suggests a stale page', () => {
    const line = hudStateLine(rucss, {
      verdict: 'not applied',
      count: null,
      source: 'meta',
      why: null
    });
    expect(line).toBe("WP Rocket's generator meta does not declare it on this page.");
    expect(line).not.toContain('predate');
  });

  it('a footprint-decided not-applied line keeps the stale-page hint', () => {
    expect(
      hudStateLine(rucss, { verdict: 'not applied', count: null, source: 'footprint', why: null })
    ).toContain('predate');
  });

  it('unknown reads the row’s undecided copy', () => {
    const dims = feature('image_dimensions');
    expect(hudStateLine(dims, { verdict: 'unknown', count: null, source: null, why: null })).toBe(
      dims.undecided
    );
  });
});

describe('SOURCE_COPY / SOURCE_REPORT_TEXT', () => {
  it('declares chip, tooltip and report wording for both evidence classes', () => {
    expect(SOURCE_COPY).toEqual({
      meta: { chip: 'Meta', tooltip: "Decided by WP Rocket's generator meta tag on this page." },
      footprint: { chip: 'Footprint', tooltip: 'Decided by markup WP Rocket left on this page.' }
    });
    expect(SOURCE_REPORT_TEXT).toEqual({ meta: 'Generator meta', footprint: 'Page footprint' });
  });
});
