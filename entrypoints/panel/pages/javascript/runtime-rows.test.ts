/**
 * The Runtime states rows: names (file name, inline ordinals), the state
 * chips (skipped and unknown under all states only), the searched text, the
 * source groups and their counts, row sameness across re-reads, seed heights.
 */
import { describe, expect, it } from 'vitest';
import { exclusivityViolations } from '../../../../lib/panel/facet-parity.fixtures';
import { applyFacets, facetCounts } from '../../../../lib/panel/resource-facets';
import { filterAndSearch, filterCounts } from '../../../../lib/panel/resources-view-model';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import { DELAYED, liveScript } from './runtime-fixtures';
import {
  estimateRuntimeRow,
  groupCounts,
  outsideFilterCounts,
  RUNTIME_FACETS,
  RUNTIME_GROUPS,
  RUNTIME_STATE_LIST,
  rowsOfSource,
  runtimeRows,
  sameRuntimeRow
} from './runtime-rows';

/** One script per state and group. */
function scripts(): LiveScriptRecord[] {
  return [
    liveScript({
      type: DELAYED,
      delayedSrc: 'https://a.test/wp-content/themes/t/main.js?ver=1',
      status: 'executed'
    }),
    liveScript({
      type: DELAYED,
      src: 'https://a.test/wp-content/plugins/p/x.js',
      status: 'failed-network'
    }),
    liveScript({ type: DELAYED, text: 'pending();', id: 'boot', classes: ['a', 'b'] }),
    liveScript({ src: 'https://cdn.test/lib.js' }),
    liveScript({ type: 'application/ld+json', text: '{"@type":"Thing"}' }),
    liveScript({ type: DELAYED, src: 'https://a.test/legacy.js', status: 'skipped' }),
    liveScript({ type: DELAYED, text: 'later();', status: 'later' })
  ];
}

describe('runtimeRows', () => {
  it('ids by document position, names URLs by file and inline scripts by ordinal', () => {
    const rows = runtimeRows(scripts());
    expect(rows.map((row) => row.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows.map((row) => row.name)).toEqual([
      'main.js',
      'x.js',
      'Inline script 1',
      'lib.js',
      'Inline script 2',
      'legacy.js',
      'Inline script 3'
    ]);
  });
});

describe('RUNTIME_STATE_LIST', () => {
  it('counts each state chip; skipped and unknown only under all states', () => {
    expect(filterCounts(runtimeRows(scripts()), RUNTIME_STATE_LIST)).toEqual({
      all: 7,
      executed: 1,
      failed: 1,
      pending: 1,
      'not-delayed': 2
    });
  });

  it('searches URLs, ids, classes and code', () => {
    const rows = runtimeRows(scripts());
    const ids = (query: string): number[] =>
      filterAndSearch(rows, RUNTIME_STATE_LIST, 'all', query).map((row) => row.id);
    expect(ids('themes/t')).toEqual([0]);
    expect(ids('boot')).toEqual([2]);
    expect(ids('b')).toContain(2);
    expect(ids('@type')).toEqual([4]);
    expect(ids('pending()')).toEqual([2]);
  });
});

describe('source groups', () => {
  it('counts each group and narrows to one', () => {
    const rows = runtimeRows(scripts());
    expect(groupCounts(rows)).toEqual({ theme: 1, plugin: 1, inline: 3, other: 2 });
    expect(rowsOfSource(rows, 'all')).toBe(rows);
    expect(rowsOfSource(rows, 'inline').map((row) => row.id)).toEqual([2, 4, 6]);
  });

  it('counts the rows no state chip covers', () => {
    const rows = runtimeRows(scripts());
    expect(outsideFilterCounts(rows)).toEqual({ skipped: 1, unknown: 1 });
    expect(outsideFilterCounts(rowsOfSource(rows, 'theme'))).toEqual({ skipped: 0, unknown: 0 });
  });
});

describe('RUNTIME_FACETS', () => {
  const rows = runtimeRows(scripts());
  const search = (query: string) => ({ field: RUNTIME_STATE_LIST.searchField, query });

  it('reaches every source × state chip pair as one selection with the same rows', () => {
    for (const query of ['', 'a.test', 'PENDING']) {
      for (const source of ['all', ...RUNTIME_GROUPS] as const) {
        for (const chip of RUNTIME_STATE_LIST.filters) {
          const expected = filterAndSearch(
            rowsOfSource(rows, source),
            RUNTIME_STATE_LIST,
            chip.id,
            query
          );
          const selection = {
            source: source === 'all' ? 'any' : source,
            state: chip.id === 'all' ? 'any' : chip.id
          };
          expect(applyFacets(rows, RUNTIME_FACETS, selection, search(query))).toEqual(expected);
        }
      }
    }
  });

  it('keeps one source and one state per script', () => {
    expect(exclusivityViolations(rows, RUNTIME_FACETS)).toEqual([]);
  });

  it('counts each facet given the other (skipped and unknown under Any only)', () => {
    expect(facetCounts(rows, RUNTIME_FACETS, {}, search('')).byFacet.state).toEqual({
      any: 7,
      executed: 1,
      failed: 1,
      pending: 1,
      'not-delayed': 2
    });
    const inline = facetCounts(rows, RUNTIME_FACETS, { source: 'inline' }, search(''));
    expect(inline.byFacet.state).toEqual({
      any: 3,
      executed: 0,
      failed: 0,
      pending: 1,
      'not-delayed': 1
    });
    // Source counts follow the state selection (groupCounts ignores it).
    expect(
      facetCounts(rows, RUNTIME_FACETS, { state: 'not-delayed' }, search('')).byFacet.source
    ).toEqual({
      any: 2,
      theme: 0,
      plugin: 0,
      inline: 1,
      other: 1
    });
  });
});

describe('sameRuntimeRow', () => {
  it('holds for an identical re-read and breaks on any shown field', () => {
    const [a] = runtimeRows(scripts());
    const [b] = runtimeRows(scripts());
    if (a === undefined || b === undefined) throw new Error('fixture');
    expect(sameRuntimeRow(a, b)).toBe(true);
    const variants: Partial<LiveScriptRecord>[] = [
      { state: 'failed' },
      { rawStatus: 'x' },
      { group: 'other' },
      { structuredData: true },
      { sourceKind: 'inline' },
      { source: 'y' },
      { id: 'z' },
      { fullText: 't' },
      { fullTextCut: true },
      { classes: ['c'] }
    ];
    for (const change of variants) {
      expect(sameRuntimeRow(a, { ...b, script: { ...b.script, ...change } })).toBe(false);
    }
    expect(sameRuntimeRow(a, { ...b, name: 'other.js' })).toBe(false);
    const withClasses = { ...a, script: { ...a.script, classes: ['p', 'q'] } };
    expect(
      sameRuntimeRow(withClasses, { ...a, script: { ...a.script, classes: ['p', 'r'] } })
    ).toBe(false);
  });
});

describe('estimateRuntimeRow', () => {
  it('seeds taller rows for id/classes and for open details', () => {
    const rows = runtimeRows(scripts());
    const plain = rows[0];
    const withFacts = rows[2];
    if (plain === undefined || withFacts === undefined) throw new Error('fixture');
    expect(estimateRuntimeRow(withFacts, false)).toBeGreaterThan(estimateRuntimeRow(plain, false));
    expect(estimateRuntimeRow(plain, true)).toBeGreaterThan(estimateRuntimeRow(plain, false));
  });
});
