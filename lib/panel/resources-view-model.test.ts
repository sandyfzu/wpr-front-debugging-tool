/**
 * The shared filter/search pattern's tests: the three page definitions'
 * chips and predicates, the builders' content resolution, the composed
 * filter+query semantics (the chip stays applied while searching), the
 * one-pass counts, and the unknown-chip throw.
 */
import { describe, expect, it } from 'vitest';
import {
  JS_PAGE_RESOURCES,
  LAZYLOAD_PAGE_RESOURCES,
  PRELOADED_PAGE_RESOURCES,
  buildLazyloadRows,
  buildPreloadedRows,
  buildScriptRows,
  filterAndSearch,
  filterCounts,
  reportHints,
  reportHintsTruncated,
  type JsFilterId,
  type PreloadedFilterId
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

describe('the page definitions — chips and predicates', () => {
  it('the JavaScript pattern carries the reference chip labels in order', () => {
    expect(JS_PAGE_RESOURCES.filters.map((filter) => [filter.id, filter.label])).toEqual([
      ['all', 'Show all'],
      ['delayed', 'Delayed'],
      ['non-delayed', 'Non-delayed'],
      ['deferred', 'Deferred'],
      ['non-deferred', 'Non-deferred'],
      ['minified', 'Minified'],
      ['combined', 'Combined'],
      ['excluded', 'Excluded'],
      ['inline', 'Inline'],
      ['external', 'External']
    ]);
    expect(JS_PAGE_RESOURCES.searchField).toBeTypeOf('function');
  });

  it('the Lazyload pattern carries its four chips; the field is src', () => {
    expect(LAZYLOAD_PAGE_RESOURCES.filters.map((filter) => [filter.id, filter.label])).toEqual([
      ['all', 'Show all'],
      ['lazyloaded', 'Lazyloaded'],
      ['non-lazyloaded', 'Non-lazyloaded'],
      ['excluded', 'Excluded']
    ]);
    const rows = buildLazyloadRows({
      present: true,
      images: [
        { src: '/a.jpg', lazyloadDetected: true, excludedReasonsFound: [] },
        { src: '/b.jpg', lazyloadDetected: false, excludedReasonsFound: [] },
        { src: '/c.jpg', lazyloadDetected: false, excludedReasonsFound: [FDT_EXCLUDED_RESOURCE] }
      ]
    });
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'lazyloaded', '')).toEqual([rows[0]]);
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'non-lazyloaded', '')).toEqual([
      rows[1],
      rows[2]
    ]);
    // The filter selects exactly the rows whose chip reads Excluded.
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'excluded', '')).toEqual([rows[2]]);
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'all', '/b.jpg')).toEqual([rows[1]]);
  });

  it('the Preloaded pattern: attribution, kinds, preload images/fonts (preload kind only)', () => {
    expect(PRELOADED_PAGE_RESOURCES.filters.map((filter) => [filter.id, filter.label])).toEqual([
      ['all', 'Show all'],
      ['wp-rocket', 'WP Rocket'],
      ['unattributed', 'Unattributed'],
      ['preload', 'Preload'],
      ['images', 'Images'],
      ['fonts', 'Fonts'],
      ['modulepreload', 'Module preload'],
      ['preconnect', 'Preconnect'],
      ['dns-prefetch', 'DNS prefetch']
    ]);
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
    const hrefs = (id: PreloadedFilterId): string[] =>
      filterAndSearch(rows, PRELOADED_PAGE_RESOURCES, id, '').map((row) => row.href);
    expect(hrefs('images')).toEqual(['/a.webp', '/b.webp']);
    expect(hrefs('fonts')).toEqual(['/c.woff2']);
    expect(hrefs('preload')).toEqual(['/a.webp', '/b.webp', '/c.woff2', '/d.png']);
    expect(hrefs('modulepreload')).toEqual(['/e.js']);
    expect(hrefs('preconnect')).toEqual(['https://f/']);
    expect(hrefs('dns-prefetch')).toEqual(['https://g/', 'https://h/']);
    expect(hrefs('wp-rocket')).toEqual(['/a.webp', 'https://f/', 'https://g/']);
    expect(hrefs('unattributed')).toEqual(['/b.webp', '/c.woff2', '/d.png', '/e.js', 'https://h/']);
    expect(hrefs('all')).toHaveLength(8);
    expect(filterAndSearch(rows, PRELOADED_PAGE_RESOURCES, 'all', 'WEBP')).toHaveLength(2);
  });
});

describe('filterAndSearch — the composed chip + query semantics', () => {
  const rows = buildScriptRows(
    scripts([
      { src: '/wp-rocket.js', delayed: true, deferredByWPR: true },
      { src: '/analytics.js', delayed: false },
      { src: '/overlay.js', delayed: false, deferred: true },
      { inline: true, content: 'const seoHelper = 1;', delayed: true }
    ])
  );

  it('an empty query is the chip alone; rows keep their order', () => {
    expect(filterAndSearch(rows, JS_PAGE_RESOURCES, 'non-delayed', '')).toEqual([rows[1], rows[2]]);
  });

  it('the query narrows the chip subset, not the whole list', () => {
    // 'js' matches wp-rocket.js (delayed) and overlay.js (non-delayed) —
    // only the delayed one survives the composition.
    expect(filterAndSearch(rows, JS_PAGE_RESOURCES, 'delayed', 'js')).toEqual([rows[0]]);
    // The inline row's code is the searched field for external matching.
    expect(filterAndSearch(rows, JS_PAGE_RESOURCES, 'all', 'seoHelper')).toEqual([rows[3]]);
  });

  it('the query compare is case-insensitive on both sides', () => {
    expect(filterAndSearch(rows, JS_PAGE_RESOURCES, 'external', 'WP-ROCKET')).toEqual([rows[0]]);
  });

  it('no match under a chip yields the empty list for the shared empty state', () => {
    expect(filterAndSearch(rows, JS_PAGE_RESOURCES, 'delayed', 'nothing-matches')).toEqual([]);
  });

  it('an unknown chip id throws (a wiring bug, named)', () => {
    expect(() => filterAndSearch(rows, JS_PAGE_RESOURCES, 'delayed-x', '')).toThrow(
      /no id "delayed-x"/
    );
  });
});

describe('filterCounts — one pass, every chip', () => {
  const rows = buildScriptRows(
    scripts([
      { src: '/a.js', delayed: true },
      { src: '/b.js', delayed: false, deferred: true },
      { inline: true, content: 'x;', delayed: true, deferred: false, deferredByWPR: true },
      { inline: false, src: '/d.js', delayed: false }
    ])
  );

  it('counts every chip from the same rows (Show All = the total)', () => {
    const counts = filterCounts(rows, JS_PAGE_RESOURCES);
    expect(counts).toEqual({
      all: 4,
      delayed: 2,
      'non-delayed': 2,
      deferred: 1,
      'non-deferred': 3,
      minified: 0,
      combined: 0,
      excluded: 0,
      inline: 1,
      external: 3
    });
  });

  it('the counts agree with filtering per chip (the memo contract)', () => {
    const counts = filterCounts(rows, JS_PAGE_RESOURCES);
    for (const filter of JS_PAGE_RESOURCES.filters) {
      const chipRows = filterAndSearch(rows, JS_PAGE_RESOURCES, filter.id, '');
      expect(chipRows).toHaveLength(counts[filter.id]);
    }
  });

  it('an empty inventory counts zero everywhere', () => {
    expect(filterCounts([], LAZYLOAD_PAGE_RESOURCES)).toEqual({
      all: 0,
      lazyloaded: 0,
      'non-lazyloaded': 0,
      excluded: 0
    });
  });

  it('the preloaded counts read every chip in one pass', () => {
    const rows = buildPreloadedRows(
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
    expect(filterCounts(rows, PRELOADED_PAGE_RESOURCES)).toEqual({
      all: 4,
      'wp-rocket': 1,
      unattributed: 3,
      preload: 3,
      images: 1,
      fonts: 1,
      modulepreload: 0,
      preconnect: 0,
      'dns-prefetch': 1
    });
  });
});

describe('the JavaScript state filters — one predicate per chip', () => {
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
  /** The source paths a chip selects. */
  const under = (id: JsFilterId): string[] =>
    filterAndSearch(rows, JS_PAGE_RESOURCES, id, '').map((row) => row.content);

  it('selects exactly the rows each state holds on', () => {
    expect(under('delayed')).toEqual(['/a.js']);
    // WP Rocket's stamp alone is Deferred; an inline `defer` is not.
    expect(under('deferred')).toEqual(['/b.js', '/c.js']);
    expect(under('excluded')).toEqual(['/a.js', '/c.js']);
    expect(under('combined')).toEqual([
      'https://s.test/wp-content/cache/min/1/0123456789abcdef0123456789abcdef.js'
    ]);
    expect(under('minified')).toEqual([
      'https://s.test/wp-content/cache/min/1/wp-includes/js/m.js'
    ]);
  });

  it('the negative chips are the exact complements', () => {
    const counts = filterCounts(rows, JS_PAGE_RESOURCES);
    expect(counts['delayed'] + counts['non-delayed']).toBe(rows.length);
    expect(counts['deferred'] + counts['non-deferred']).toBe(rows.length);
    expect(under('non-deferred')).toContain('x;');
  });
});
