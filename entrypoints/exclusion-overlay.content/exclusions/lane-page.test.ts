/**
 * A lane's rows read as one set: the page state, the rows behind a
 * page-off (by lane position, stored form), the set's row problems and
 * warnings by row id — and, once committed, the same verdict as the
 * session's prevalidation; and one row's verdict composed from it.
 */
import { describe, expect, it } from 'vitest';
import { ROW_REASONS } from '../../../lib/exclusion-builder/row-reasons';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import { prevalidateExclusionSet } from '../../../lib/exclusion-builder/validate';
import { commitAll, createIdSource, draftFromSet, draftToSet, type DraftRow } from './draft';
import { lanePage, rowVerdict } from './lane-page';

/** Rows with ids `r1`, `r2`, … in order. */
const rows = (...texts: string[]): DraftRow[] =>
  texts.map((text, index) => ({ id: `r${String(index + 1)}`, text }));

describe('lanePage', () => {
  it('reads only lanes whose rows act as one set', () => {
    expect(lanePage('delayJs', rows('.*', '.*'))).toBeNull();
    expect(lanePage('lazyload', rows('a'))).toBeNull();
    expect(lanePage('lazyRender', rows('a'))).toBeNull();
    expect(lanePage('deferJs', [])).toEqual({
      page: 'on',
      offRows: [],
      problems: new Map(),
      warnings: new Map()
    });
  });

  it('names the rows behind a page-off by lane position (blank rows count) and stored form', () => {
    const page = lanePage('deferJs', rows("  (?'n'a) ", '', 'ok', "(?'n'b)"));
    expect(page?.page).toBe('off');
    expect(page?.offRows).toEqual([
      { id: 'r1', position: 1, stored: "(?'n'a)" },
      { id: 'r4', position: 4, stored: "(?'n'b)" }
    ]);
    // The page-off rows warn: WP Rocket defers nothing, and so does the preview.
    expect(page?.problems).toEqual(new Map());
    expect(page?.warnings).toEqual(
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
    expect([...(page?.warnings.keys() ?? [])]).toEqual(['r2']);
  });

  it('reads a row matching every script as a warning', () => {
    const page = lanePage('deferJs', rows('ok', 'zzz|'));
    expect(page?.problems).toEqual(new Map());
    expect(page?.warnings).toEqual(new Map([['r2', ROW_REASONS.matchAll]]));
  });

  it('leaves out rows the save drops, as their commit will', () => {
    // A typed copy of a row is one row once stored: no repeated group name.
    expect(lanePage('deferJs', rows("(?'n'a)x", " (?'n'a)x"))).toEqual(
      lanePage('deferJs', rows("(?'n'a)x"))
    );
    expect(lanePage('deferJs', rows("(?'n'a)x", " (?'n'a)x"))?.page).not.toBe('off');
    // A pattern PCRE rejects, typed (uncommitted), is dropped at its commit: the set
    // left is fine (the row's own problem comes from the row check, not from here).
    expect(lanePage('deferJs', rows('(', 'a'), new Set(['r1']))).toEqual({
      page: 'on',
      offRows: [],
      problems: new Map(),
      warnings: new Map()
    });
  });

  it('names the copy that stays: a typed copy leaves, the row already there wins', () => {
    // Row 1 typed (uncommitted) repeats row 3, which is behind the page-off: the
    // commit drops row 1, so the message names row 3.
    expect(lanePage('deferJs', rows('.*', 'ok', '.*'), new Set(['r1']))?.offRows).toEqual([
      { id: 'r3', position: 3, stored: '.*' }
    ]);
    // Nothing uncommitted (the apply's commit of every row): the first copy stays.
    expect(lanePage('deferJs', rows('.*', 'ok', '.*'))?.offRows).toEqual([
      { id: 'r1', position: 1, stored: '.*' }
    ]);
    // A row not in its stored form is committed whatever the tracking says.
    expect(lanePage('deferJs', rows(' .* ', 'ok', '.*'))?.offRows).toEqual([
      { id: 'r3', position: 3, stored: '.*' }
    ]);
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
      problems: new Map(),
      warnings: new Map()
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
      const session = prevalidateExclusionSet(draftToSet(committed));
      const byId = (entries: typeof session.invalid): Map<string, string> =>
        new Map(
          entries
            .filter(({ feature }) => feature === 'defer_all_js')
            .map(({ index, reason }) => [lane[index]?.id ?? '', reason])
        );
      expect({ typed, problems: page?.problems, warnings: page?.warnings }).toEqual({
        typed,
        problems: byId(session.invalid),
        warnings: byId(session.warnings)
      });
    }
  });
});

describe('rowVerdict', () => {
  const page = {
    page: 'off' as const,
    offRows: [],
    problems: new Map([['p', 'joined problem']]),
    warnings: new Map([['w', 'joined warning']])
  };
  const blocking = { reason: 'alone problem', blocking: true };
  const warning = { reason: 'alone warning', blocking: false };

  it('takes the set reading’s verdict on a row it read', () => {
    expect(rowVerdict(page, 'p', warning)).toEqual({ problem: 'joined problem', warning: null });
    expect(rowVerdict(page, 'w', blocking)).toEqual({ problem: null, warning: 'joined warning' });
  });

  it('falls back to the row alone otherwise, a problem or a warning (never both)', () => {
    expect(rowVerdict(page, 'x', blocking)).toEqual({ problem: 'alone problem', warning: null });
    expect(rowVerdict(null, 'x', warning)).toEqual({ problem: null, warning: 'alone warning' });
    expect(rowVerdict(null, 'x', null)).toEqual({ problem: null, warning: null });
  });
});
