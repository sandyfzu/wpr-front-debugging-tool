/**
 * All-at-once prevalidation of an exclusion set: every row of every
 * feature is checked, and every problem is named (feature, index, row,
 * reason) — never first-error-only, so an editor can render all feedback
 * inline in one pass. Pure: the same rows always yield the same problems
 * (Defer JS’s reading is memoized by its own module, never kept here).
 */
import { deferRowProblems } from './defer-js-rows';
import type { InvalidExclusionRow } from './errors';
import { trimExclusionRow } from './field-text';
import { isIgnoredLazyloadRow, isMatchAllLazyRenderRow } from './literal-rows';
import { regexRowProblems } from './pcre/rows';
import type { RegexFeatureId } from './pcre/translate';
import {
  EXCLUSION_FEATURES,
  type ExclusionRowKind,
  type ExclusionSet,
  type ExclusionFeatureId
} from './set';

/** The outcome of validating a whole set. */
export interface ExclusionSetProblems {
  /** `true` when no row is invalid. */
  readonly valid: boolean;
  /** Every problem, feature by feature in registry order, rows in list order. */
  readonly invalid: readonly InvalidExclusionRow[];
}

/** The reason for a row empty once trimmed. */
const EMPTY_ROW_REASON = 'Row is empty — it would match every element';

/** The reason for an empty Automatic Lazy Rendering row next to other rows. */
const MATCH_ALL_LAZY_RENDER_REASON =
  'Row is empty — next to other rows it matches every element (WP Rocket joins the rows into one pattern)';

/** One row's problem: the reason, plus its typed id where one is named. */
type RowProblem = Pick<InvalidExclusionRow, 'reason' | 'problem'>;

/**
 * Why one literal row cannot work, or `null` when it is valid — WP Rocket's
 * own reading of empty rows (`./literal-rows`): Lazyload ignores `''` and
 * `"0"` (but a whitespace-only row would match nearly every image — its
 * subject starts with whitespace); Automatic Lazy Rendering takes any text,
 * and an empty row is a problem only next to other rows, where it matches
 * every element. A literal row is never compiled — regex-looking text is a
 * fine substring.
 *
 * @param feature The literal feature.
 * @param row The row as given.
 * @param rows Every row of the feature (the set-level empty-row rule).
 */
function literalRowProblem(
  feature: ExclusionFeatureId,
  row: string,
  rows: readonly string[]
): RowProblem | null {
  if (feature === 'automatic_lazy_rendering') {
    return isMatchAllLazyRenderRow(row, rows)
      ? { reason: MATCH_ALL_LAZY_RENDER_REASON, problem: 'match-all' }
      : null;
  }
  if (feature === 'lazyload' && isIgnoredLazyloadRow(row)) return null;
  return trimExclusionRow(row) === '' ? { reason: EMPTY_ROW_REASON } : null;
}

/** A pattern feature's row problems, read the way WP Rocket's PCRE reads the rows. */
type PcreRowReading = (rows: readonly string[]) => readonly InvalidExclusionRow[];

/**
 * Every pattern feature, keyed to its PCRE translator's row problems
 * (whole-set: some only exist joined): WP Rocket matches these rows with
 * PCRE, so the translator — never a JS compile — says what is wrong.
 */
const PCRE_ROW_PROBLEMS: Readonly<Record<RegexFeatureId, PcreRowReading>> = {
  delay_js: (rows) => regexRowProblems('delay_js', rows),
  defer_all_js: deferRowProblems
};

/**
 * Validate one feature's rows — all of them.
 *
 * @param feature The feature the rows belong to (names the problem rows).
 * @param rowKind How the rows will be matched.
 * @param rows The rows as given.
 * @returns Every problem, in list order; empty when the rows are valid.
 * @throws {@link Error} for pattern rows of a feature without a PCRE reading
 *   (a broken registry, never user data).
 */
export function featureRowProblems(
  feature: ExclusionFeatureId,
  rowKind: ExclusionRowKind,
  rows: readonly string[]
): readonly InvalidExclusionRow[] {
  if (rowKind === 'literal') {
    return rows.flatMap((row, index) => {
      const problem = literalRowProblem(feature, row, rows);
      return problem === null ? [] : [{ feature, index, row, ...problem }];
    });
  }
  const reading = (PCRE_ROW_PROBLEMS as Partial<Record<ExclusionFeatureId, PcreRowReading>>)[
    feature
  ];
  if (reading === undefined) throw new Error(`No PCRE reading for pattern rows of ${feature}`);
  const byIndex = new Map(reading(rows).map((entry) => [entry.index, entry]));
  return rows.flatMap((row, index): InvalidExclusionRow[] => {
    // An empty row stays the editor's own mistake, ahead of any PCRE reading
    // (the exact `''` is WP Rocket's match-everything row: verified for both
    // features — a filter-delivered `''` excludes every script).
    if (trimExclusionRow(row) === '') {
      const matchAll = row === '' ? { problem: 'match-all' as const } : {};
      return [{ feature, index, row, reason: EMPTY_ROW_REASON, ...matchAll }];
    }
    const entry = byIndex.get(index);
    return entry === undefined ? [] : [entry];
  });
}

/**
 * Prevalidate a whole exclusion set — the UI's inline-feedback source and
 * the pipeline's gate: every row of every feature is checked, and the
 * result names each invalid one. Each transform re-runs its feature's
 * checks on its throwing path.
 *
 * @param set The set as given (rows untrusted until validated).
 */
export function prevalidateExclusionSet(set: ExclusionSet): ExclusionSetProblems {
  const invalid: InvalidExclusionRow[] = [];
  for (const feature of EXCLUSION_FEATURES) {
    invalid.push(...featureRowProblems(feature.id, feature.rowKind, set.rows[feature.rowsKey]));
  }
  return { valid: invalid.length === 0, invalid };
}

/** The warning for a whitespace-only Automatic Lazy Rendering row. */
const WHITESPACE_LAZY_RENDER_REASON =
  'Row is only whitespace — it matches nearly every element (any opening tag holding it)';

/**
 * Non-blocking row warnings: rows WP Rocket accepts and applies as written
 * that are almost surely mistakes. A whitespace-only Automatic Lazy
 * Rendering row is a valid literal there (the engine keeps it valid,
 * faithfully) yet, like the whitespace-only Lazyload row the engine
 * rejects, it matches nearly every element. The `''` row is not warned
 * here (a lone one is inert; next to others it is the `match-all` problem).
 *
 * @param feature The feature the rows belong to.
 * @param rows The rows as given.
 * @returns One warning per such row, in list order (never thrown).
 */
export function featureRowWarnings(
  feature: ExclusionFeatureId,
  rows: readonly string[]
): readonly InvalidExclusionRow[] {
  if (feature !== 'automatic_lazy_rendering') return [];
  const warnings: InvalidExclusionRow[] = [];
  rows.forEach((row, index) => {
    if (row !== '' && trimExclusionRow(row) === '') {
      warnings.push({ feature, index, row, reason: WHITESPACE_LAZY_RENDER_REASON });
    }
  });
  return warnings;
}
