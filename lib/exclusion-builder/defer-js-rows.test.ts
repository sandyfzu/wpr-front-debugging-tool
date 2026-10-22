/**
 * Defer JS rows read as WP Rocket's one joined pattern: the OR of the rows'
 * matchers, the first matching row credited, every problem (page-wide
 * included) as a validation entry, and one translation per row set.
 */
import { describe, expect, it } from 'vitest';
import { DEFER_ROW_SET_CACHE_LIMITS, deferRowProblems, deferRowSet } from './defer-js-rows';

describe('deferRowSet — matching', () => {
  it('credits the first row in list order that matches the subject', () => {
    const rows = deferRowSet(['zzz', 'jquery', '\\.js$']);
    expect(rows.firstMatch('/wp-includes/js/jquery/jquery.min.js')).toBe(1);
    expect(rows.firstMatch('/a.js')).toBe(2);
    expect(rows.firstMatch('/a.css')).toBe(-1);
  });

  it('matches caselessly over the subject bytes, as `#…#i` does on WP Rocket', () => {
    const rows = deferRowSet(['^/É\\.JS$', '^/.\\.js$']);
    // `É` folds to nothing on bytes (ASCII-only case), and `.` is one byte, not one character.
    expect(rows.firstMatch('/é.js')).toBe(-1);
    expect(rows.firstMatch('/a.js')).toBe(1);
  });

  it('never matches with a row that has no matcher (its problem invalidates the set)', () => {
    const rows = deferRowSet(['(?>a)', 'b']);
    expect(rows.problems.map(({ index, problem }) => [index, problem])).toEqual([[0, 'pcre-only']]);
    expect(rows.firstMatch('a')).toBe(-1);
    expect(rows.firstMatch('b')).toBe(1);
  });
});

describe('deferRowSet — set-level outcomes', () => {
  it('is `on` with no problems for clean rows, and for no rows', () => {
    expect(deferRowSet(['jquery', 'gtag'])).toMatchObject({ page: 'on', problems: [] });
    expect(deferRowSet([])).toMatchObject({ page: 'on', problems: [] });
  });

  it('is `off` when WP Rocket’s pre-check fails, the rows behind it named page-wide', () => {
    const rows = deferRowSet(['ok', '.*']);
    expect(rows.page).toBe('off');
    expect(rows.problems).toEqual([
      expect.objectContaining({
        feature: 'defer_all_js',
        index: 1,
        row: '.*',
        problem: 'joined-page-off'
      })
    ]);
  });

  it('lists the rows behind a page-off — unverified ones too, never outranked ones', () => {
    expect(deferRowSet(['ok', '.*']).pageOffRows).toEqual([1]);
    expect(deferRowSet(["(?'n'a)", 'ok', "(?'n'b)"]).pageOffRows).toEqual([0, 2]);
    // `\p{L}` leaves its save unmodeled; its open `\Q` breaks the joined pattern.
    expect(deferRowSet(['a\\.js', '\\p{L}\\Qab'])).toMatchObject({
      page: 'off',
      pageOffRows: [1]
    });
    // Off only through a row the save drops: that row's own problem says it.
    expect(deferRowSet(['(', 'a'])).toMatchObject({ page: 'off', pageOffRows: [] });
    expect(deferRowSet(['ok']).pageOffRows).toEqual([]);
    expect(deferRowSet(['(?>x)', 'zzz']).pageOffRows).toEqual([]);
  });

  it('is `unknown` when a row cannot be replayed — never `on`', () => {
    expect(deferRowSet(['(?>x)', 'zzz']).page).toBe('unknown');
  });

  it('keeps match-all and joined-changes-matching rows row problems', () => {
    expect(deferRowProblems(['zzz|', '(?-i)zzz', 'A.JS']).map(({ problem }) => problem)).toEqual([
      'match-all',
      'joined-changes-matching'
    ]);
  });
});

describe('deferRowSet — memo', () => {
  it('translates a row set once and serves it again', () => {
    expect(deferRowSet(['memo-a', 'memo-b'])).toBe(deferRowSet(['memo-a', 'memo-b']));
    expect(deferRowSet(['memo-a', 'memo-b'])).not.toBe(deferRowSet(['memo-a']));
    // Rows that would join into the same text are still different sets.
    expect(deferRowSet(['a|b'])).not.toBe(deferRowSet(['a', 'b']));
  });

  it('evicts the oldest set beyond its bound', () => {
    const first = deferRowSet(['evict-first']);
    for (let index = 0; index < DEFER_ROW_SET_CACHE_LIMITS.entries; index++) {
      deferRowSet([`filler-${String(index)}`]);
    }
    expect(deferRowSet(['evict-first'])).not.toBe(first);
    const last = deferRowSet([`filler-${String(DEFER_ROW_SET_CACHE_LIMITS.entries - 1)}`]);
    expect(deferRowSet([`filler-${String(DEFER_ROW_SET_CACHE_LIMITS.entries - 1)}`])).toBe(last);
  });

  it('never keeps a set heavier than its character bound (translated again, same result)', () => {
    const heavy = Array.from({ length: 80 }, (_, i) => `${'h'.repeat(2000)}${String(i)}`);
    const first = deferRowSet(heavy);
    expect(deferRowSet(heavy)).not.toBe(first);
    expect(deferRowSet(heavy).problems).toEqual(first.problems);
  });
});
