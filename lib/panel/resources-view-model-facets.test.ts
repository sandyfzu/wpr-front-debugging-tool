/**
 * The JavaScript, Lazyload and Preloaded Resources pages' facets: every
 * single-select chip is reachable as one facet selection selecting exactly
 * its rows (with and without a query) over edge-row fixtures, choice values
 * are mutually exclusive, the overlapping states are toggles, and combined
 * facets narrow as the owner's Delay × Defer × Type example reads.
 */
import { describe, expect, it } from 'vitest';
import { chipParityMismatches, exclusivityViolations } from './facet-parity.fixtures';
import { UNATTRIBUTED, type HintAttribution } from './hint-attribution';
import { applyFacets, facetCounts, type FacetSelection } from './resource-facets';
import {
  JS_PAGE_FACETS,
  JS_PAGE_RESOURCES,
  LAZYLOAD_PAGE_FACETS,
  LAZYLOAD_PAGE_RESOURCES,
  PRELOADED_PAGE_FACETS,
  PRELOADED_PAGE_RESOURCES,
  type JsFacetId,
  type JsFilterId,
  type JsScriptResource,
  type LazyloadFacetId,
  type LazyloadFilterId,
  type LazyloadImageResource,
  type PreloadedFacetId,
  type PreloadedFilterId,
  type PreloadedResource
} from './resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import type { ResourceHintRel } from '../wp-rocket/types';

/** No search phase (the parity checks cover the query side). */
function noSearch(): { field: () => string; query: string } {
  return { field: () => '', query: '' };
}

/**
 * A script row: a plain external script unless overridden.
 *
 * @param overrides Fields to change.
 * @returns The row.
 */
function script(overrides: Partial<JsScriptResource>): JsScriptResource {
  return {
    id: 0,
    type: 'external',
    content: 'https://site.test/plain.js',
    delayed: false,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minified: false,
    combined: false,
    originalType: null,
    ...overrides
  };
}

/** Script edge rows: every chip holds somewhere, and the near misses next to it. */
const SCRIPTS: readonly JsScriptResource[] = [
  script({ type: 'inline', content: 'boot();', delayed: true }),
  script({ content: 'https://cdn.test/both.js', delayed: true, deferred: true }),
  script({ content: 'https://site.test/stamped.js', deferredByWPR: true }),
  // An inline script carrying `defer` is not Deferred (the browser ignores it).
  script({ type: 'inline', content: 'inline-defer();', deferred: true }),
  script({ content: 'https://site.test/cache/min/a.js', minified: true }),
  script({ content: 'https://site.test/cache/min/bundle.js', combined: true, delayed: true }),
  // Kept out of Delay JS by the marker: Excluded.
  script({ content: 'https://cdn.test/kept.js', fdtExcluded: 'delay_js' }),
  // A delayed script whose marker names Delay JS was not kept out of it.
  script({ content: 'https://site.test/marked.js', delayed: true, fdtExcluded: 'delay_js' }),
  // Kept out of Defer JS (external, not deferred): Excluded.
  script({ content: 'https://site.test/nodefer.js', fdtExcluded: 'defer_all_js' }),
  // Delayed and kept out of Defer JS: Excluded while Delayed.
  script({
    content: 'https://site.test/delayed-nodefer.js',
    delayed: true,
    fdtExcluded: 'defer_all_js'
  }),
  // Marker names Defer JS but the script is deferred: not Excluded.
  script({ content: 'https://site.test/d.js', deferred: true, fdtExcluded: 'defer_all_js' }),
  script({ type: 'inline', content: '' }),
  script({})
];

/** Old JavaScript chip → its one facet selection (every chip reachable as one selection). */
const JS_CHIP_MAP: Record<JsFilterId, FacetSelection<JsFacetId>> = {
  all: {},
  delayed: { delay: 'delayed' },
  'non-delayed': { delay: 'non-delayed' },
  deferred: { defer: 'deferred' },
  'non-deferred': { defer: 'non-deferred' },
  minified: { file: 'minified' },
  combined: { file: 'combined' },
  excluded: { excluded: 'yes' },
  inline: { type: 'inline' },
  external: { type: 'external' }
};

describe('JS_PAGE_FACETS', () => {
  it('declares Delay, Defer, Type, File and the Excluded toggle', () => {
    expect(JS_PAGE_FACETS.facets.map((facet) => [facet.id, facet.kind])).toEqual([
      ['delay', 'choice'],
      ['defer', 'choice'],
      ['type', 'choice'],
      ['file', 'choice'],
      ['excluded', 'toggle']
    ]);
  });

  it('reaches every chip as one selection with the same rows (with and without a query)', () => {
    expect(chipParityMismatches(SCRIPTS, JS_PAGE_RESOURCES, JS_PAGE_FACETS, JS_CHIP_MAP)).toEqual(
      []
    );
    for (const query of ['cdn', 'SITE.TEST', 'zzz']) {
      expect(
        chipParityMismatches(SCRIPTS, JS_PAGE_RESOURCES, JS_PAGE_FACETS, JS_CHIP_MAP, query)
      ).toEqual([]);
    }
  });

  it('keeps choice values mutually exclusive (Minified and Combined included)', () => {
    expect(exclusivityViolations(SCRIPTS, JS_PAGE_FACETS)).toEqual([]);
  });

  it('Excluded holds on Delayed and Not delayed rows alike (a toggle, not a Delay value)', () => {
    const excluded = applyFacets(SCRIPTS, JS_PAGE_FACETS, { excluded: 'yes' }, noSearch());
    expect(excluded.map((row) => [row.content, row.delayed])).toEqual([
      ['https://cdn.test/kept.js', false],
      ['https://site.test/nodefer.js', false],
      ['https://site.test/delayed-nodefer.js', true]
    ]);
  });

  it('combines Delay × Defer × Type', () => {
    const kept = applyFacets(
      SCRIPTS,
      JS_PAGE_FACETS,
      { delay: 'delayed', defer: 'deferred', type: 'external' },
      noSearch()
    );
    expect(kept.map((row) => row.content)).toEqual(['https://cdn.test/both.js']);
    const counts = facetCounts(
      SCRIPTS,
      JS_PAGE_FACETS,
      { delay: 'delayed', type: 'external' },
      noSearch()
    );
    // Delayed external scripts: both, bundle, marked, delayed-nodefer — only both.js deferred.
    expect(counts.byFacet.defer).toEqual({ any: 4, deferred: 1, 'non-deferred': 3 });
    expect(counts.matched).toBe(4);
  });
});

/**
 * An image row: a plain non-lazyloaded image unless overridden.
 *
 * @param overrides Fields to change.
 * @returns The row.
 */
function image(overrides: Partial<LazyloadImageResource>): LazyloadImageResource {
  return {
    id: 0,
    src: 'https://site.test/a.jpg',
    lazyloaded: false,
    excludedReasons: [],
    ...overrides
  };
}

/** Image edge rows: lazyloaded with and without the marker, excluded, other reasons, none. */
const IMAGES: readonly LazyloadImageResource[] = [
  image({ src: 'https://site.test/lazy.jpg', lazyloaded: true }),
  // The marker on a lazyloaded image proves no exclusion.
  image({
    src: 'https://cdn.test/lazy-marked.jpg',
    lazyloaded: true,
    excludedReasons: [FDT_EXCLUDED_RESOURCE]
  }),
  image({
    src: 'https://site.test/kept.jpg',
    excludedReasons: ['data-no-lazy', FDT_EXCLUDED_RESOURCE]
  }),
  image({ src: 'https://cdn.test/skipped.jpg', excludedReasons: ['data-no-lazy'] }),
  image({ src: '' })
];

/** Old Lazyload chip → facet selection. */
const LAZYLOAD_CHIP_MAP: Record<LazyloadFilterId, FacetSelection<LazyloadFacetId>> = {
  all: {},
  lazyloaded: { lazyload: 'lazyloaded' },
  'non-lazyloaded': { lazyload: 'non-lazyloaded' },
  excluded: { excluded: 'yes' }
};

describe('LAZYLOAD_PAGE_FACETS', () => {
  it('reaches every chip as one selection with the same rows (with and without a query)', () => {
    for (const query of ['', 'cdn', 'KEPT']) {
      expect(
        chipParityMismatches(
          IMAGES,
          LAZYLOAD_PAGE_RESOURCES,
          LAZYLOAD_PAGE_FACETS,
          LAZYLOAD_CHIP_MAP,
          query
        )
      ).toEqual([]);
    }
    expect(exclusivityViolations(IMAGES, LAZYLOAD_PAGE_FACETS)).toEqual([]);
  });

  it('Excluded sits inside Not lazyloaded: with it the same rows, with Lazyloaded none', () => {
    const alone = applyFacets(IMAGES, LAZYLOAD_PAGE_FACETS, { excluded: 'yes' }, noSearch());
    expect(
      applyFacets(
        IMAGES,
        LAZYLOAD_PAGE_FACETS,
        { lazyload: 'non-lazyloaded', excluded: 'yes' },
        noSearch()
      )
    ).toEqual(alone);
    expect(
      applyFacets(
        IMAGES,
        LAZYLOAD_PAGE_FACETS,
        { lazyload: 'lazyloaded', excluded: 'yes' },
        noSearch()
      )
    ).toEqual([]);
    expect(
      facetCounts(IMAGES, LAZYLOAD_PAGE_FACETS, { excluded: 'yes' }, noSearch()).byFacet.lazyload
    ).toEqual({
      any: 1,
      lazyloaded: 0,
      'non-lazyloaded': 1
    });
  });
});

/** WP Rocket's preload stamp. */
const STAMPED: HintAttribution = { by: 'wp-rocket', mark: 'preload', feature: null };

/**
 * A hint row.
 *
 * @param rel The hint kind.
 * @param as The `as` type.
 * @param attribution Who wrote it.
 * @param href The hinted URL.
 * @returns The row.
 */
function hint(
  rel: ResourceHintRel,
  as: string,
  attribution: HintAttribution,
  href = `https://site.test/${rel}-${as}`
): PreloadedResource {
  return { id: 0, rel, as, href, attribution };
}

/** Hint edge rows: each kind, image/font preloads both attributions, a non-preload `as="image"`, an empty href. */
const HINTS: readonly PreloadedResource[] = [
  hint('preload', 'image', STAMPED),
  hint('preload', 'image', UNATTRIBUTED, 'https://cdn.test/hero.jpg'),
  hint('preload', 'font', STAMPED),
  hint('preload', 'style', UNATTRIBUTED),
  // A srcset-only preload: no href, still a preload.
  hint('preload', 'image', UNATTRIBUTED, ''),
  // `as="image"` on a module preload is no image preload.
  hint('modulepreload', 'image', UNATTRIBUTED),
  hint('preconnect', '', { by: 'wp-rocket', mark: 'preconnect', feature: null }),
  hint('dns-prefetch', '', UNATTRIBUTED, 'https://cdn.test')
];

/** Old Preloaded Resources chip → facet selection. */
const PRELOADED_CHIP_MAP: Record<PreloadedFilterId, FacetSelection<PreloadedFacetId>> = {
  all: {},
  'wp-rocket': { source: 'wp-rocket' },
  unattributed: { source: 'unattributed' },
  preload: { hint: 'preload' },
  images: { 'preload-type': 'images' },
  fonts: { 'preload-type': 'fonts' },
  modulepreload: { hint: 'modulepreload' },
  preconnect: { hint: 'preconnect' },
  'dns-prefetch': { hint: 'dns-prefetch' }
};

describe('PRELOADED_PAGE_FACETS', () => {
  it('reaches every chip as one selection with the same rows (with and without a query)', () => {
    for (const query of ['', 'cdn', 'IMAGE']) {
      expect(
        chipParityMismatches(
          HINTS,
          PRELOADED_PAGE_RESOURCES,
          PRELOADED_PAGE_FACETS,
          PRELOADED_CHIP_MAP,
          query
        )
      ).toEqual([]);
    }
    expect(exclusivityViolations(HINTS, PRELOADED_PAGE_FACETS)).toEqual([]);
  });

  it('Images keep the preload condition; combined with a source they narrow further', () => {
    const images = applyFacets(
      HINTS,
      PRELOADED_PAGE_FACETS,
      { 'preload-type': 'images' },
      noSearch()
    );
    expect(images.every((row) => row.rel === 'preload')).toBe(true);
    expect(images).toHaveLength(3);
    expect(
      applyFacets(
        HINTS,
        PRELOADED_PAGE_FACETS,
        { 'preload-type': 'images', source: 'wp-rocket' },
        noSearch()
      )
    ).toEqual([HINTS[0]]);
    expect(
      applyFacets(
        HINTS,
        PRELOADED_PAGE_FACETS,
        { 'preload-type': 'fonts', hint: 'preconnect' },
        noSearch()
      )
    ).toEqual([]);
  });
});
