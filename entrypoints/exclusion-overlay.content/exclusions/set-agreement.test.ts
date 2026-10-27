/**
 * Property: the editor's final row verdicts agree with the session's
 * prevalidation on every Defer JS set — the editor never blocks an apply the
 * session accepts, nor lets through one it refuses, and it warns on exactly
 * the rows the session warns on. The editor's verdict for a row is its
 * lane's set reading, else the single-row check (`rowVerdict`, as the
 * controller composes them); the session judges the set the editor applies
 * (the next commit of the uncommitted rows, then the apply's commit of
 * every row). Checked in three states per set: every row typed, every row
 * committed, and committed rows plus one typed caret row (often a copy).
 *
 * Sets come from a seeded generator over adversarial PCRE fragments (named
 * groups, `\Q…\E`, inline options, verbs, back-references, recursion,
 * entities); `SET_AGREEMENT_FILES` (comma-separated JSONL paths of
 * `{ rows }`) adds external corpora for a local run.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EMPTY_EXCLUSION_SET } from '../../../lib/exclusion-builder/set';
import { prevalidateExclusionSet } from '../../../lib/exclusion-builder/validate';
import {
  commitAll,
  commitRows,
  createRowValidator,
  draftToSet,
  isBlankRow,
  type Draft,
  type DraftRow
} from './draft';
import { lanePage, rowVerdict, type RowVerdict } from './lane-page';

/** Fragments rows are built from (WP Rocket's hard cases for a joined pattern). */
const FRAGMENTS = [
  '(?<n>a)',
  "(?'n'x)",
  '(?a)',
  '|',
  '(?P<n>d)',
  '(?J)',
  '(?-J)',
  '(?|(?<n>a)|(?<n>b))',
  '(?<n>a)|(?<n>b)',
  '(?i)',
  '(?-i)',
  '(?x)',
  '(?s)',
  '\\G',
  '\\K',
  'd\\K',
  '.+?',
  '.*',
  'dummy',
  '-string',
  'a.js',
  '(',
  ')',
  '\\g1',
  '(?-1)',
  '\\1',
  '(a)\\1',
  '(?1)',
  '(?R)',
  '\\w+',
  '(?=s)',
  '(?<=y)-',
  'zzz|',
  '0',
  '(?:)',
  '(**)',
  '(?(',
  '(*UTF)',
  '(*CR)',
  '(?C)',
  '(*FAIL)',
  '(*ACCEPT)',
  '(*SKIP)',
  '(?(1)a|b)',
  '\\p{L}',
  '\\X',
  '\\R',
  '\\N',
  '(?>a+)',
  'a++',
  '\\c',
  '[[:alpha:]]',
  '[[:foo:]]',
  '(?<n>a)(?&n)',
  '\\k<n>',
  '(?P=n)',
  '\\8',
  '#',
  '/',
  '~',
  '*',
  '+a',
  '?',
  '{2}',
  'a{2,1}',
  '(?<=a+)',
  '(?<=a|bc)',
  '(?#c)',
  '\\Q(\\E',
  '\\Q',
  '\\E',
  'a\\Qb',
  'zz\\E',
  ' ',
  '&lt;',
  '%41'
];

/** A seeded PRNG (mulberry32): the corpus is the same on every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` generated sets of 1–5 rows. */
function generatedSets(seed: number, count: number): string[][] {
  const next = random(seed);
  const pick = (): string => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '';
  return Array.from({ length: count }, () =>
    Array.from({ length: 1 + Math.floor(next() * 5) }, () => {
      let row = pick();
      if (next() < 0.5) row += pick();
      return next() < 0.2 ? `x${row}` : row;
    })
  );
}

/** External corpora for a local run (none in CI). */
function externalSets(): string[][] {
  const files = process.env.SET_AGREEMENT_FILES;
  if (files === undefined || files === '') return [];
  return files.split(',').flatMap((file) =>
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as { rows: string[] }).rows)
  );
}

const validate = createRowValidator();

/** A draft whose Defer lane holds `rows`. */
const draftOf = (rows: readonly DraftRow[]): Draft => ({
  rows: { ...{ delayJs: [], lazyload: [], lazyRender: [] }, deferJs: rows },
  disable: { ...EMPTY_EXCLUSION_SET.disable }
});

/** The editor's verdict for each row: the set reading, else the single-row check. */
function editorVerdicts(
  rows: readonly DraftRow[],
  uncommitted: ReadonlySet<string>
): Map<string, RowVerdict> {
  const page = lanePage('deferJs', rows, uncommitted);
  return new Map(
    rows.map((row) => [row.id, rowVerdict(page, row.id, validate('deferJs', row.text))])
  );
}

/** The session's verdict for each row the applied set holds, by row id. */
function sessionVerdicts(rows: readonly DraftRow[], uncommitted: ReadonlySet<string>) {
  const next = commitRows(draftOf(rows), 'deferJs', [...uncommitted]).draft;
  const applied = commitAll(next).draft;
  const kept = applied.rows.deferJs.filter((row) => !isBlankRow(row.text));
  const { invalid, warnings } = prevalidateExclusionSet(draftToSet(applied));
  const byId = new Map<string, RowVerdict>(
    kept.map((row) => [row.id, { problem: null, warning: null }])
  );
  const verdictOf = (index: number): RowVerdict =>
    byId.get(kept[index]?.id ?? '') ?? { problem: null, warning: null };
  for (const { feature, index, reason } of invalid)
    if (feature === 'defer_all_js')
      byId.set(kept[index]?.id ?? '', { ...verdictOf(index), problem: reason });
  for (const { feature, index, reason } of warnings)
    if (feature === 'defer_all_js')
      byId.set(kept[index]?.id ?? '', { ...verdictOf(index), warning: reason });
  return { byId, applied: applied.rows.deferJs };
}

/** Rows with ids `r1`, `r2`, … */
const withIds = (texts: readonly string[]): DraftRow[] =>
  texts.map((text, index) => ({ id: `r${String(index + 1)}`, text }));

/**
 * Check one state: the editor's verdict (problem and warning) for every row
 * that stays equals the session's; and once committed as at apply (nothing
 * uncommitted), every row.
 */
function expectAgreement(rows: readonly DraftRow[], uncommitted: ReadonlySet<string>): void {
  const { byId, applied } = sessionVerdicts(rows, uncommitted);
  const before = editorVerdicts(rows, uncommitted);
  for (const [id, verdict] of byId)
    expect({ rows: rows.map((row) => row.text), id, editor: before.get(id) }).toEqual({
      rows: rows.map((row) => row.text),
      id,
      editor: verdict
    });
  const after = editorVerdicts(applied, new Set());
  for (const [id, verdict] of byId)
    expect({ applied: applied.map((row) => row.text), id, editor: after.get(id) }).toEqual({
      applied: applied.map((row) => row.text),
      id,
      editor: verdict
    });
}

describe('editor ↔ session agreement on Defer JS sets', () => {
  it('a row that fails alone but passes joined blocks nothing (`a\\Qb` + `zz\\E`)', () => {
    const rows = withIds(['a\\Qb', 'zz\\E']);
    expect(prevalidateExclusionSet(draftToSet(draftOf(rows))).valid).toBe(true);
    expect([...editorVerdicts(rows, new Set()).values()]).toEqual([
      { problem: null, warning: null },
      { problem: null, warning: null }
    ]);
    expectAgreement(rows, new Set());
  });

  it('a page-off set and a match-all row warn, and block nothing (K.5c)', () => {
    const pageOff = withIds(["(?'n'a)x", 'ok', "(?'n'b)y"]);
    expect(prevalidateExclusionSet(draftToSet(draftOf(pageOff))).valid).toBe(true);
    const verdicts = [...editorVerdicts(pageOff, new Set()).values()];
    expect(verdicts.map(({ problem }) => problem)).toEqual([null, null, null]);
    expect(verdicts.map(({ warning }) => warning !== null)).toEqual([true, false, true]);
    expectAgreement(pageOff, new Set());
    const matchAll = withIds(['zzz', '(?a)']);
    expect(editorVerdicts(matchAll, new Set()).get('r2')).toEqual({
      problem: null,
      warning: 'WP Rocket stores this and it excludes every script'
    });
    expectAgreement(matchAll, new Set());
  });

  const sets = [...generatedSets(0x5b, 1200), ...externalSets()];

  it(`agrees on ${String(sets.length)} sets: all typed, all committed, committed + a typed caret row`, () => {
    const next = random(0xc0ffee);
    for (const texts of sets) {
      const typed = withIds(texts);
      expectAgreement(typed, new Set(typed.map((row) => row.id)));
      const committed = commitRows(
        draftOf(typed),
        'deferJs',
        typed.map((row) => row.id)
      ).draft.rows.deferJs;
      expectAgreement(committed, new Set());
      // A caret row: a copy of a row (half the time) or a fresh fragment, anywhere.
      const at = Math.floor(next() * (committed.length + 1));
      const text =
        next() < 0.5 && committed.length > 0
          ? ` ${committed[Math.floor(next() * committed.length)]?.text ?? ''}`
          : (FRAGMENTS[Math.floor(next() * FRAGMENTS.length)] ?? '');
      const caret = { id: 'caret', text };
      expectAgreement(
        [...committed.slice(0, at), caret, ...committed.slice(at)],
        new Set(['caret'])
      );
    }
  });
});
