/**
 * The shared facet/search pattern's tests: the builders' content
 * resolution, the three pages' searched fields and facet value predicates,
 * the composed facet + query semantics (the facets stay applied while
 * searching), the one-pass counts, and the unknown-value throw.
 */
import { describe, expect, it } from 'vitest';
import { applyFacets, facetCounts, type FacetSelection } from './resource-facets';
import {
  JS_PAGE_FACETS,
  LAZYLOAD_PAGE_FACETS,
  PRELOADED_PAGE_FACETS,
  buildLazyloadRows,
  buildPreloadedRows,
  buildScriptRows,
  jsScriptSearchField,
  lazyloadImageSearchField,
  preloadedHintSearchField,
  reportHints,
  reportHintsTruncated,
  type JsFacetId,
  type JsScriptResource,
  type PreloadedFacetId
} from './resources-view-model';
import { emptyDetections } from './support-report.fixtures';
import { FDT_EXCLUDED_RESOURCE } from '../wp-rocket/constants';
import type { PreloadedResources, WprDetections } from '../wp-rocket/types';

/** Build delay-JS rows straight from record-shaped scripts. */
function scripts(
  records: Array<
    { inline?: boolean; content?: string; src?: string } & Partial<
      WprDetections['delay_js']['scripts'][number]
    >
  >
): WprDetections['delay_js'] {
  return {
    present: true,
    version: null,
    delayedScripts: 0,
    scripts: records.map((record) => ({
      inline: record.inline ?? false,
      src: record.src,
      content: record.content,
      delayed: record.delayed ?? false,
      deferred: record.deferred ?? false,
      deferredByWPR: record.deferredByWPR ?? false,
      fdtExcluded: record.fdtExcluded ?? null,
      minifyAttribute: record.minifyAttribute ?? false,
      ...(record.originalType === undefined ? {} : { originalType: record.originalType })
    }))
  };
}

describe('buildScriptRows', () => {
  it('fills content per type: inline source text, external URL', () => {
    const rows = buildScriptRows(
      scripts([
        { inline: true, content: 'alert("hi");', delayed: true },
        { inline: false, src: '/overlay.js', deferred: true, deferredByWPR: true }
      ])
    );
    expect(rows).toEqual([
      {
        id: 0,
        type: 'inline',
        content: 'alert("hi");',
        delayed: true,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        minified: false,
        combined: false,
        minifyAttribute: false,
        originalType: null
      },
      {
        id: 1,
        type: 'external',
        content: '/overlay.js',
        delayed: false,
        deferred: true,
        deferredByWPR: true,
        fdtExcluded: null,
        minified: false,
        combined: false,
        minifyAttribute: false,
        originalType: null
      }
    ]);
  });

  it("carries the tag's minify stamp apart from the page-proven Minified state", () => {
    const [row] = buildScriptRows(
      scripts([{ inline: false, src: '/a.js', minifyAttribute: true }])
    );
    expect(row?.minifyAttribute).toBe(true);
    expect(row?.minified).toBe(false);
  });

  it('a record without its content/src reads as an empty searched field', () => {
    const rows = buildScriptRows(scripts([{ inline: true }, { inline: false }]));
    expect(rows.map((row) => row.content)).toEqual(['', '']);
  });

  it('carries the exclusion marker through to the row', () => {
    const rows = buildScriptRows(
      scripts([{ src: '/x.js', delayed: false, fdtExcluded: 'delay_js' }])
    );
    expect(rows[0]).toMatchObject({ fdtExcluded: 'delay_js', type: 'external' });
  });

  it('keeps the original type on delayed rows only', () => {
    const rows = buildScriptRows(
      scripts([
        { src: '/m.js', delayed: true, originalType: 'module' },
        { src: '/c.js', delayed: true },
        // Never recorded on an undelayed script; a stray one is not shown.
        { src: '/x.js', delayed: false, originalType: 'module' }
      ])
    );
    expect(rows.map((row) => row.originalType)).toEqual(['module', null, null]);
  });

  it('reads the minify states under the page facts (none by default)', () => {
    const inventory = scripts([
      { src: 'https://site.test/wp-content/cache/min/1/wp-includes/js/a.js' },
      { src: 'https://site.test/wp-content/cache/min/1/0123456789abcdef0123456789abcdef.js' }
    ]);
    expect(buildScriptRows(inventory).map((row) => [row.minified, row.combined])).toEqual([
      [false, false],
      [false, false]
    ]);
    const facts = { minifyJs: true, wprProven: true, combineDeclared: true };
    expect(buildScriptRows(inventory, facts).map((row) => [row.minified, row.combined])).toEqual([
      [true, false],
      [false, true]
    ]);
  });
});

describe('buildLazyloadRows', () => {
  it('maps the scan records and copies the exclusion reasons', () => {
    const image: WprDetections['lazyload']['images'][number] = {
      src: '/hero.jpg',
      lazyloadDetected: false,
      excludedReasonsFound: ['width', 'height']
    };
    const rows = buildLazyloadRows({ present: true, images: [image] });
    const copied = rows.at(0);
    if (copied === undefined) throw new Error('the builder produced no row');
    expect(copied).toEqual({
      id: 0,
      src: '/hero.jpg',
      lazyloaded: false,
      excludedReasons: ['width', 'height']
    });
    // The row is independent of the payload it came from.
    image.excludedReasonsFound.push('more');
    expect(copied.excludedReasons).toEqual(['width', 'height']);
  });
});

describe('buildPreloadedRows', () => {
  const none = emptyDetections();

  it('reads the hint inventory: WP Rocket first, then by kind, preloads by type, ids = capture order', () => {
    const report: PreloadedResources = {
      present: true,
      resources: [{ href: '/hero.webp', type: 'image' }],
      hints: [
        { rel: 'dns-prefetch', href: 'https://dns.example/', as: '' },
        { rel: 'preload', href: '/x.woff2', as: 'font', mark: 'preload' },
        { rel: 'preconnect', href: 'https://ped.example/', as: '', mark: 'preconnect' },
        { rel: 'preload', href: '/hero.webp', as: 'image', mark: 'preload' },
        { rel: 'modulepreload', href: '/m.js', as: '' },
        { rel: 'preload', href: '/plain.css', as: 'style' },
        { rel: 'preload', href: '/plain.json', as: 'json' },
        { rel: 'preload', href: '/untyped', as: '' },
        { rel: 'preload', href: '/plain.png', as: 'image' }
      ]
    };
    const rows = buildPreloadedRows(report, none);
    expect(rows.map((row) => [row.id, row.rel, row.as, row.attribution.by])).toEqual([
      [3, 'preload', 'image', 'wp-rocket'],
      [1, 'preload', 'font', 'wp-rocket'],
      [2, 'preconnect', '', 'wp-rocket'],
      [8, 'preload', 'image', 'page'],
      [5, 'preload', 'style', 'page'],
      [6, 'preload', 'json', 'page'],
      [7, 'preload', '', 'page'],
      [4, 'modulepreload', '', 'page'],
      [0, 'dns-prefetch', '', 'page']
    ]);
  });

  it('keeps one row per hint, in capture order among equal ranks (duplicates kept)', () => {
    const hint = { rel: 'preload' as const, href: '/same.webp', as: 'image' };
    const rows = buildPreloadedRows({ present: false, hints: [hint, hint, hint] }, none);
    expect(rows.map((row) => row.id)).toEqual([0, 1, 2]);
  });

  it('names the proven feature on a row (attribution is the hint module own)', () => {
    const detections = emptyDetections();
    detections.rocket_above_the_fold_optimization.present = true;
    const [row] = buildPreloadedRows(
      {
        present: true,
        resources: [],
        hints: [{ rel: 'preload', href: '/a', as: 'image', mark: 'preload' }]
      },
      detections
    );
    expect(row?.attribution).toEqual({
      by: 'wp-rocket',
      mark: 'preload',
      feature: 'Optimize Critical Images'
    });
  });

  it('reads a capture without the inventory as its stamped preloads, type normalized', () => {
    const report: PreloadedResources = {
      present: true,
      resources: [
        { href: '/hero.webp', type: ' IMAGE ' },
        { href: '/fonts/x.woff2', type: 'font' }
      ]
    };
    expect(reportHints(report)).toEqual([
      { rel: 'preload', href: '/hero.webp', as: 'image', mark: 'preload' },
      { rel: 'preload', href: '/fonts/x.woff2', as: 'font', mark: 'preload' }
    ]);
    expect(buildPreloadedRows(report, none).map((row) => row.href)).toEqual([
      '/hero.webp',
      '/fonts/x.woff2'
    ]);
    expect(buildPreloadedRows({ present: true }, none)).toEqual([]);
    expect(buildPreloadedRows({ present: false }, none)).toEqual([]);
  });

  it('reads each list by its own cut mark', () => {
    expect(reportHintsTruncated({ present: true, resources: [], truncated: true })).toBe(true);
    expect(
      reportHintsTruncated({ present: true, resources: [], truncated: true, hints: [] })
    ).toBeUndefined();
    expect(
      reportHintsTruncated({
        present: false,
        hints: [{ rel: 'preconnect', href: 'https://a/', as: '' }],
        hintsTruncated: true
      })
    ).toBe(true);
  });
});

describe('the page facets — searched fields and value predicates', () => {
  it("the JavaScript page searches an inline script's code and an external one's URL", () => {
    const [external, inline] = buildScriptRows(
      scripts([{ src: '/a.js' }, { inline: true, content: 'boot();' }])
    );
    expect(external === undefined ? null : jsScriptSearchField(external)).toBe('/a.js');
    expect(inline === undefined ? null : jsScriptSearchField(inline)).toBe('boot();');
  });

  it('the Lazyload values; the field is src', () => {
    const rows = buildLazyloadRows({
      present: true,
      images: [
        { src: '/a.jpg', lazyloadDetected: true, excludedReasonsFound: [] },
        { src: '/b.jpg', lazyloadDetected: false, excludedReasonsFound: [] },
        { src: '/c.jpg', lazyloadDetected: false, excludedReasonsFound: [FDT_EXCLUDED_RESOURCE] }
      ]
    });
    const search = (query: string) => ({ field: lazyloadImageSearchField, query });
    expect(applyFacets(rows, LAZYLOAD_PAGE_FACETS, { lazyload: 'lazyloaded' }, search(''))).toEqual(
      [rows[0]]
    );
    expect(
      applyFacets(rows, LAZYLOAD_PAGE_FACETS, { lazyload: 'non-lazyloaded' }, search(''))
    ).toEqual([rows[1], rows[2]]);
    // The toggle selects exactly the rows whose chip reads Excluded.
    expect(applyFacets(rows, LAZYLOAD_PAGE_FACETS, { excluded: 'yes' }, search(''))).toEqual([
      rows[2]
    ]);
    expect(applyFacets(rows, LAZYLOAD_PAGE_FACETS, {}, search('/b.jpg'))).toEqual([rows[1]]);
  });

  it('the Preloaded values: attribution, kinds, preload images/fonts (preload kind only)', () => {
    const rows = buildPreloadedRows(
      {
        present: true,
        resources: [],
        hints: [
          { rel: 'preload', href: '/a.webp', as: 'image', mark: 'preload' },
          { rel: 'preload', href: '/b.webp', as: 'image' },
          { rel: 'preload', href: '/c.woff2', as: 'font' },
          { rel: 'preload', href: '/d.png', as: '' },
          { rel: 'modulepreload', href: '/e.js', as: 'image' },
          { rel: 'preconnect', href: 'https://f/', as: 'font', mark: 'preconnect' },
          { rel: 'dns-prefetch', href: 'https://g/', as: '', mark: 'prefetch' },
          { rel: 'dns-prefetch', href: 'https://h/', as: '' }
        ]
      },
      emptyDetections()
    );
    const hrefs = (selection: FacetSelection<PreloadedFacetId>, query = ''): string[] =>
      applyFacets(rows, PRELOADED_PAGE_FACETS, selection, {
        field: preloadedHintSearchField,
        query
      }).map((row) => row.href);
    expect(hrefs({ 'preload-type': 'images' })).toEqual(['/a.webp', '/b.webp']);
    expect(hrefs({ 'preload-type': 'fonts' })).toEqual(['/c.woff2']);
    expect(hrefs({ hint: 'preload' })).toEqual(['/a.webp', '/b.webp', '/c.woff2', '/d.png']);
    expect(hrefs({ hint: 'modulepreload' })).toEqual(['/e.js']);
    expect(hrefs({ hint: 'preconnect' })).toEqual(['https://f/']);
    expect(hrefs({ hint: 'dns-prefetch' })).toEqual(['https://g/', 'https://h/']);
    expect(hrefs({ source: 'wp-rocket' })).toEqual(['/a.webp', 'https://f/', 'https://g/']);
    expect(hrefs({ source: 'unattributed' })).toEqual([
      '/b.webp',
      '/c.woff2',
      '/d.png',
      '/e.js',
      'https://h/'
    ]);
    expect(hrefs({})).toHaveLength(8);
    expect(hrefs({}, 'WEBP')).toHaveLength(2);
  });
});

describe('the composed facet + query semantics', () => {
  const rows = buildScriptRows(
    scripts([
      { src: '/wp-rocket.js', delayed: true, deferredByWPR: true },
      { src: '/analytics.js', delayed: false },
      { src: '/overlay.js', delayed: false, deferred: true },
      { inline: true, content: 'const seoHelper = 1;', delayed: true }
    ])
  );
  /** The rows a selection and a query keep. */
  const kept = (selection: FacetSelection<JsFacetId>, query: string): JsScriptResource[] => [
    ...applyFacets(rows, JS_PAGE_FACETS, selection, { field: jsScriptSearchField, query })
  ];

  it('an empty query is the facets alone; rows keep their order', () => {
    expect(kept({ delay: 'non-delayed' }, '')).toEqual([rows[1], rows[2]]);
  });

  it('the query narrows the facet subset, not the whole list', () => {
    // 'js' matches wp-rocket.js (delayed) and overlay.js (non-delayed) —
    // only the delayed one survives the composition.
    expect(kept({ delay: 'delayed' }, 'js')).toEqual([rows[0]]);
    // The inline row's code is the searched field.
    expect(kept({}, 'seoHelper')).toEqual([rows[3]]);
  });

  it('the query compare is case-insensitive on both sides', () => {
    expect(kept({ type: 'external' }, 'wp-rocket')).toEqual([rows[0]]);
    expect(kept({ type: 'external' }, 'WP-ROCKET')).toEqual([rows[0]]);
  });

  it('no match under a facet yields the empty list for the shared empty state', () => {
    expect(kept({ delay: 'delayed' }, 'nothing-matches')).toEqual([]);
  });

  it('an unknown value id throws (a wiring bug, named)', () => {
    expect(() => kept({ delay: 'delayed-x' }, '')).toThrow(/delayed-x/);
  });
});

describe('facetCounts over the page facets — one pass, every value', () => {
  const rows = buildScriptRows(
    scripts([
      { src: '/a.js', delayed: true },
      { src: '/b.js', delayed: false, deferred: true },
      { inline: true, content: 'x;', delayed: true, deferred: false, deferredByWPR: true },
      { inline: false, src: '/d.js', delayed: false }
    ])
  );
  const none = { field: jsScriptSearchField, query: '' };

  it('counts every value from the same rows (Any = the total)', () => {
    const counts = facetCounts(rows, JS_PAGE_FACETS, {}, none);
    expect(counts.matched).toBe(4);
    expect(counts.byFacet).toEqual({
      delay: { any: 4, delayed: 2, 'non-delayed': 2 },
      defer: { any: 4, deferred: 1, 'non-deferred': 3 },
      type: { any: 4, inline: 1, external: 3 },
      file: { any: 4, minified: 0, combined: 0 },
      excluded: { any: 4, yes: 0 }
    });
  });

  it('the counts agree with filtering per value (the memo contract)', () => {
    const counts = facetCounts(rows, JS_PAGE_FACETS, {}, none);
    for (const facet of JS_PAGE_FACETS.facets) {
      for (const value of facet.values) {
        const selection: FacetSelection<JsFacetId> = { [facet.id]: value.id };
        expect(applyFacets(rows, JS_PAGE_FACETS, selection, none)).toHaveLength(
          counts.byFacet[facet.id][value.id] ?? -1
        );
      }
    }
  });

  it('an empty inventory counts zero everywhere', () => {
    expect(
      facetCounts([], LAZYLOAD_PAGE_FACETS, {}, { field: lazyloadImageSearchField, query: '' })
    ).toEqual({
      matched: 0,
      byFacet: {
        lazyload: { any: 0, lazyloaded: 0, 'non-lazyloaded': 0 },
        excluded: { any: 0, yes: 0 }
      }
    });
  });

  it('the preloaded counts read every value in one pass', () => {
    const hints = buildPreloadedRows(
      {
        present: true,
        resources: [],
        hints: [
          { rel: 'preload', href: '/a.webp', as: 'image', mark: 'preload' },
          { rel: 'preload', href: '/b.woff2', as: 'font' },
          { rel: 'preload', href: '/c.png', as: '' },
          { rel: 'dns-prefetch', href: 'https://d/', as: '' }
        ]
      },
      emptyDetections()
    );
    expect(
      facetCounts(hints, PRELOADED_PAGE_FACETS, {}, { field: preloadedHintSearchField, query: '' })
        .byFacet
    ).toEqual({
      source: { any: 4, 'wp-rocket': 1, unattributed: 3 },
      hint: { any: 4, preload: 3, modulepreload: 0, preconnect: 0, 'dns-prefetch': 1 },
      'preload-type': { any: 4, images: 1, fonts: 1 }
    });
  });
});

describe('the JavaScript state values — one predicate per value', () => {
  const rows = buildScriptRows(
    scripts([
      { src: '/a.js', delayed: true, fdtExcluded: 'defer_all_js' },
      { src: '/b.js', deferredByWPR: true },
      { src: '/c.js', fdtExcluded: 'delay_js', deferred: true },
      { inline: true, content: 'x;', deferred: true, fdtExcluded: 'defer_all_js' },
      { src: 'https://s.test/wp-content/cache/min/1/0123456789abcdef0123456789abcdef.js' },
      { src: 'https://s.test/wp-content/cache/min/1/wp-includes/js/m.js' }
    ]),
    { minifyJs: true, wprProven: true, combineDeclared: true }
  );
  /** The source paths a selection keeps. */
  const under = (selection: FacetSelection<JsFacetId>): string[] =>
    applyFacets(rows, JS_PAGE_FACETS, selection, { field: jsScriptSearchField, query: '' }).map(
      (row) => row.content
    );

  it('selects exactly the rows each state holds on', () => {
    expect(under({ delay: 'delayed' })).toEqual(['/a.js']);
    // WP Rocket's stamp alone is Deferred; an inline `defer` is not.
    expect(under({ defer: 'deferred' })).toEqual(['/b.js', '/c.js']);
    expect(under({ excluded: 'yes' })).toEqual(['/a.js', '/c.js']);
    expect(under({ file: 'combined' })).toEqual([
      'https://s.test/wp-content/cache/min/1/0123456789abcdef0123456789abcdef.js'
    ]);
    expect(under({ file: 'minified' })).toEqual([
      'https://s.test/wp-content/cache/min/1/wp-includes/js/m.js'
    ]);
  });

  it('the negative values are the exact complements', () => {
    const counts = facetCounts(rows, JS_PAGE_FACETS, {}, { field: jsScriptSearchField, query: '' });
    expect((counts.byFacet.delay.delayed ?? 0) + (counts.byFacet.delay['non-delayed'] ?? 0)).toBe(
      rows.length
    );
    expect((counts.byFacet.defer.deferred ?? 0) + (counts.byFacet.defer['non-deferred'] ?? 0)).toBe(
      rows.length
    );
    expect(under({ defer: 'non-deferred' })).toContain('x;');
  });
});
