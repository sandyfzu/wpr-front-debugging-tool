/**
 * The JavaScript, Lazyload and Preloaded Resources pages' facets: their
 * sentence-case words, every single value keeping exactly its rows (with and
 * without a query) over edge-row fixtures, choice values mutually exclusive,
 * the overlapping states as toggles, and combined facets narrowing as the
 * owner's Delay × Defer × Type example reads.
 */
import { describe, expect, it } from 'vitest';
import {
  exclusivityViolations,
  selectionMismatches,
  type SelectionCase
} from './facet-checks.fixtures';
import { UNATTRIBUTED, type HintAttribution } from './hint-attribution';
import { applyFacets, facetCounts, type FacetSet } from './resource-facets';
import {
  JS_PAGE_FACETS,
  jsScriptSearchField,
  LAZYLOAD_PAGE_FACETS,
  lazyloadImageSearchField,
  PRELOADED_PAGE_FACETS,
  preloadedHintSearchField,
  type JsFacetId,
  type JsScriptResource,
  type LazyloadFacetId,
  type LazyloadImageResource,
  type PreloadedFacetId,
  type PreloadedResource
} from './resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import type { ResourceHintRel } from '../wp-rocket/types';

/**
 * A page's facet and value words, in render order.
 *
 * @param facets The page's facets.
 * @returns `[facet label, kind, value labels]` per facet.
 */
function words<Row, Id extends string>(facets: FacetSet<Row, Id>): [string, string, string[]][] {
  return facets.facets.map((facet) => [
    facet.label,
    facet.kind,
    facet.values.map((value) => value.label)
  ]);
}

/** No search phase (the selection checks cover the query side). */
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
    minifyAttribute: false,
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

/** Each single value (and no selection) → the {@link SCRIPTS} it keeps. */
const JS_CASES: Readonly<Record<string, SelectionCase<JsFacetId>>> = {
  any: { selection: {}, rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  delayed: { selection: { delay: 'delayed' }, rows: [0, 1, 5, 7, 9] },
  'non-delayed': { selection: { delay: 'non-delayed' }, rows: [2, 3, 4, 6, 8, 10, 11, 12] },
  // WP Rocket's stamp alone is Deferred; an inline `defer` is not.
  deferred: { selection: { defer: 'deferred' }, rows: [1, 2, 10] },
  'non-deferred': { selection: { defer: 'non-deferred' }, rows: [0, 3, 4, 5, 6, 7, 8, 9, 11, 12] },
  minified: { selection: { file: 'minified' }, rows: [4] },
  combined: { selection: { file: 'combined' }, rows: [5] },
  excluded: { selection: { excluded: 'yes' }, rows: [6, 8, 9] },
  inline: { selection: { type: 'inline' }, rows: [0, 3, 11] },
  external: { selection: { type: 'external' }, rows: [1, 2, 4, 5, 6, 7, 8, 9, 10, 12] }
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

  it('words every facet and value in sentence case', () => {
    expect(words(JS_PAGE_FACETS)).toEqual([
      ['Delay', 'choice', ['Delayed', 'Non-delayed']],
      ['Defer', 'choice', ['Deferred', 'Non-deferred']],
      ['Type', 'choice', ['Inline', 'External']],
      ['File', 'choice', ['Minified', 'Combined']],
      ['Excluded', 'toggle', ['Excluded']]
    ]);
  });

  it('keeps exactly its rows under each single value (with and without a query)', () => {
    for (const query of ['', 'cdn', 'SITE.TEST', 'zzz']) {
      expect(
        selectionMismatches(SCRIPTS, JS_PAGE_FACETS, jsScriptSearchField, JS_CASES, query)
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

/** Each single value (and no selection) → the {@link IMAGES} it keeps. */
const LAZYLOAD_CASES: Readonly<Record<string, SelectionCase<LazyloadFacetId>>> = {
  any: { selection: {}, rows: [0, 1, 2, 3, 4] },
  lazyloaded: { selection: { lazyload: 'lazyloaded' }, rows: [0, 1] },
  'non-lazyloaded': { selection: { lazyload: 'non-lazyloaded' }, rows: [2, 3, 4] },
  // The marker on a lazyloaded image proves no exclusion.
  excluded: { selection: { excluded: 'yes' }, rows: [2] }
};

describe('LAZYLOAD_PAGE_FACETS', () => {
  it('words every facet and value in sentence case', () => {
    expect(words(LAZYLOAD_PAGE_FACETS)).toEqual([
      ['LazyLoad', 'choice', ['Lazy loaded', 'Not lazy loaded']],
      ['Excluded', 'toggle', ['Excluded']]
    ]);
  });

  it('keeps exactly its rows under each single value (with and without a query)', () => {
    for (const query of ['', 'cdn', 'KEPT']) {
      expect(
        selectionMismatches(
          IMAGES,
          LAZYLOAD_PAGE_FACETS,
          lazyloadImageSearchField,
          LAZYLOAD_CASES,
          query
        )
      ).toEqual([]);
    }
    expect(exclusivityViolations(IMAGES, LAZYLOAD_PAGE_FACETS)).toEqual([]);
  });

  it('Excluded sits inside Not lazy loaded: with it the same rows, with Lazy loaded none', () => {
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

/** Each single value (and no selection) → the {@link HINTS} it keeps. */
const PRELOADED_CASES: Readonly<Record<string, SelectionCase<PreloadedFacetId>>> = {
  any: { selection: {}, rows: [0, 1, 2, 3, 4, 5, 6, 7] },
  'wp-rocket': { selection: { source: 'wp-rocket' }, rows: [0, 2, 6] },
  unattributed: { selection: { source: 'unattributed' }, rows: [1, 3, 4, 5, 7] },
  preload: { selection: { hint: 'preload' }, rows: [0, 1, 2, 3, 4] },
  // `as="image"` on a module preload is no image preload.
  images: { selection: { 'preload-type': 'images' }, rows: [0, 1, 4] },
  fonts: { selection: { 'preload-type': 'fonts' }, rows: [2] },
  modulepreload: { selection: { hint: 'modulepreload' }, rows: [5] },
  preconnect: { selection: { hint: 'preconnect' }, rows: [6] },
  'dns-prefetch': { selection: { hint: 'dns-prefetch' }, rows: [7] }
};

describe('PRELOADED_PAGE_FACETS', () => {
  it('words every facet and value in sentence case', () => {
    expect(words(PRELOADED_PAGE_FACETS)).toEqual([
      ['Source', 'choice', ['WP Rocket', 'Unattributed']],
      ['Hint', 'choice', ['Preload', 'Module preload', 'Preconnect', 'DNS prefetch']],
      ['Preload type', 'choice', ['Images', 'Fonts']]
    ]);
  });

  it('keeps exactly its rows under each single value (with and without a query)', () => {
    for (const query of ['', 'cdn', 'IMAGE']) {
      expect(
        selectionMismatches(
          HINTS,
          PRELOADED_PAGE_FACETS,
          preloadedHintSearchField,
          PRELOADED_CASES,
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
