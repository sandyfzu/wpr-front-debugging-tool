/**
 * The Runtime states rows: names (file name, inline ordinals), the state
 * chips (skipped and unknown under all states only), the searched text, the
 * source groups and their counts, row sameness across re-reads, seed heights.
 */
import { describe, expect, it } from 'vitest';
import { filterAndSearch, filterCounts } from '../../../../lib/panel/resources-view-model';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';
import { DELAYED, liveScript } from './runtime-fixtures';
import {
  estimateRuntimeRow,
  groupCounts,
  outsideFilterCounts,
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
