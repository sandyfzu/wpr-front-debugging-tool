/**
 * A lane's rows read as one set: the page state, the rows behind a
 * page-off (by lane position, stored form), the set's row problems by row
 * id — and, once committed, the same verdict as the session's prevalidation.
 */
import { describe, expect, it } from 'vitest';
import { ROW_REASONS } from '../../../lib/exclusion-builder/row-reasons';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import { prevalidateExclusionSet } from '../../../lib/exclusion-builder/validate';
import { commitAll, createIdSource, draftFromSet, draftToSet, type DraftRow } from './draft';
import { lanePage } from './lane-page';

/** Rows with ids `r1`, `r2`, … in order. */
const rows = (...texts: string[]): DraftRow[] =>
  texts.map((text, index) => ({ id: `r${String(index + 1)}`, text }));

describe('lanePage', () => {
  it('reads only lanes whose rows act as one set', () => {
    expect(lanePage('delayJs', rows('.*', '.*'))).toBeNull();
    expect(lanePage('lazyload', rows('a'))).toBeNull();
    expect(lanePage('lazyRender', rows('a'))).toBeNull();
    expect(lanePage('deferJs', [])).toEqual({ page: 'on', offRows: [], problems: new Map() });
  });

  it('names the rows behind a page-off by lane position (blank rows count) and stored form', () => {
    const page = lanePage('deferJs', rows("  (?'n'a) ", '', 'ok', "(?'n'b)"));
    expect(page?.page).toBe('off');
    expect(page?.offRows).toEqual([
      { id: 'r1', position: 1, stored: "(?'n'a)" },
      { id: 'r4', position: 4, stored: "(?'n'b)" }
    ]);
    expect(page?.problems).toEqual(
      new Map([
        ['r1', ROW_REASONS.joinedPageOff],
        ['r4', ROW_REASONS.joinedPageOff]
      ])
    );
  });

  it('names an unverified row that turns the page off', () => {
    const page = lanePage('deferJs', rows('a\\.js', '\\p{L}\\Qab'));
    expect(page).toMatchObject({
      page: 'off',
      offRows: [{ id: 'r2', position: 2, stored: '\\p{L}\\Qab' }]
    });
    expect(page?.problems.get('r1')).toBeUndefined();
  });

  it('leaves out rows the save drops, as their commit will', () => {
    // A typed copy of a row is one row once stored: no repeated group name.
    expect(lanePage('deferJs', rows("(?'n'a)x", " (?'n'a)x"))).toEqual(
      lanePage('deferJs', rows("(?'n'a)x"))
    );
    expect(lanePage('deferJs', rows("(?'n'a)x", " (?'n'a)x"))?.page).not.toBe('off');
    // A pattern PCRE rejects is dropped at save: the set left is fine (the row's own
    // problem comes from the row check, not from here).
    expect(lanePage('deferJs', rows('(', 'a'))).toEqual({
      page: 'on',
      offRows: [],
      problems: new Map()
    });
  });

  it('keeps a joined-only row problem a row problem, never a page-off', () => {
    const page = lanePage('deferJs', rows('(?-i)zzz', 'A.JS'));
    expect(page?.page).not.toBe('off');
    expect(page?.offRows).toEqual([]);
    expect([...(page?.problems.keys() ?? [])]).toEqual(['r1']);
    expect(page?.problems.get('r1')).toMatch(/^Joined with the other Defer JS rows, `\(\?-i\)`/);
  });

  it('says when the page state cannot be checked', () => {
    expect(lanePage('deferJs', rows('\\p{L}'))).toEqual({
      page: 'unknown',
      offRows: [],
      problems: new Map()
    });
  });

  it('agrees with the session prevalidation once the draft is committed', () => {
    const sets = [
      ["(?'n'a)", 'ok', "(?'n'b)"],
      ['a\\.js', '\\p{L}\\Qab'],
      ['.*'],
      ['(?-i)zzz', 'A.JS'],
      [' jquery ', 'zzz|', '(?>a)'],
      ['\\p{L}', 'b'],
      ['(', '(?<n>a)', "(?'n'b)"]
    ];
    for (const typed of sets) {
      const draft = draftFromSet(
        { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, deferJs: typed } },
        createIdSource()
      );
      const committed = commitAll(draft).draft;
      const lane = committed.rows.deferJs;
      const page = lanePage('deferJs', lane);
      const session = prevalidateExclusionSet(draftToSet(committed)).invalid.filter(
        ({ feature }) => feature === 'defer_all_js'
      );
      expect({ typed, problems: page?.problems }).toEqual({
        typed,
        problems: new Map(session.map(({ index, reason }) => [lane[index]?.id ?? '', reason]))
      });
    }
  });
});
