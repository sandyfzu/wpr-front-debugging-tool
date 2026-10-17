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
  filterCounts
} from './resources-view-model';
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
      fdtExcluded: record.fdtExcluded ?? null
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
        fdtExcluded: null
      },
      {
        id: 1,
        type: 'external',
        content: '/overlay.js',
        delayed: false,
        deferred: true,
        deferredByWPR: true,
        fdtExcluded: null
      }
    ]);
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
  it('maps the hint rows; a report without a list maps to zero rows', () => {
    const report: PreloadedResources = {
      present: true,
      resources: [
        { href: '/hero.webp', type: 'image' },
        { href: '/fonts/x.woff2', type: 'font' }
      ]
    };
    expect(buildPreloadedRows(report)).toEqual([
      { id: 0, type: 'image', href: '/hero.webp' },
      { id: 1, type: 'font', href: '/fonts/x.woff2' }
    ]);
    expect(buildPreloadedRows({ present: true })).toEqual([]);
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
      ['inline', 'Inline'],
      ['external', 'External']
    ]);
    expect(JS_PAGE_RESOURCES.searchField).toBeTypeOf('function');
  });

  it('the Lazyload pattern carries its three chips; the field is src', () => {
    expect(LAZYLOAD_PAGE_RESOURCES.filters.map((filter) => filter.id)).toEqual([
      'all',
      'lazyloaded',
      'non-lazyloaded'
    ]);
    const rows = buildLazyloadRows({
      present: true,
      images: [
        { src: '/a.jpg', lazyloadDetected: true, excludedReasonsFound: [] },
        { src: '/b.jpg', lazyloadDetected: false, excludedReasonsFound: [] }
      ]
    });
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'lazyloaded', '')).toEqual(
      rows.filter((row) => row.lazyloaded)
    );
    expect(filterAndSearch(rows, LAZYLOAD_PAGE_RESOURCES, 'all', '/b.jpg')).toEqual([rows[1]]);
  });

  it('the Preloaded pattern class image/font is case-insensitive per the as hint', () => {
    const rows = buildPreloadedRows({
      present: true,
      resources: [
        { href: '/a.webp', type: 'image' },
        { href: '/b.webp', type: 'IMAGE' },
        { href: '/c.woff2', type: 'font' },
        { href: '/d.png', type: '' }
      ]
    });
    const images = filterAndSearch(rows, PRELOADED_PAGE_RESOURCES, 'images', '');
    expect(images.map((row) => row.href)).toEqual(['/a.webp', '/b.webp']);
    const fonts = filterAndSearch(rows, PRELOADED_PAGE_RESOURCES, 'fonts', '');
    expect(fonts.map((row) => row.href)).toEqual(['/c.woff2']);
    const all = filterAndSearch(rows, PRELOADED_PAGE_RESOURCES, 'all', '');
    expect(all).toHaveLength(4);
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
      'non-lazyloaded': 0
    });
  });

  it('the preloaded counts read Images/Fonts + the total', () => {
    const rows = buildPreloadedRows({
      present: true,
      resources: [
        { href: '/a.webp', type: 'image' },
        { href: '/b.woff2', type: 'font' },
        { href: '/c.png', type: '' }
      ]
    });
    expect(filterCounts(rows, PRELOADED_PAGE_RESOURCES)).toEqual({
      all: 3,
      images: 1,
      fonts: 1
    });
  });
});
