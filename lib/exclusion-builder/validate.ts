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
import { BACKTRACKING_RISK_REASONS, regexBacktrackingRisk } from './regex-risk';
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

/** The lead every invalid-pattern reason carries (V8's own messages start with it too). */
const REGEX_REASON_LEAD = 'Invalid regular expression: ';

/**
 * The engine-specific detail of a regex compile error, without any lead or
 * echoed pattern: V8 reports `Invalid regular expression: /<row>/: <detail>`
 * (the row repeated verbatim), SpiderMonkey only the detail. The row itself
 * travels beside the reason, so echoing it would only bloat the reason —
 * unboundedly with the row's length.
 *
 * @param row The pattern that failed to compile.
 * @param error What `new RegExp(row)` threw.
 * @returns The bare detail (e.g. `Unterminated group`).
 */
function regexErrorDetail(row: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const echoed = `${REGEX_REASON_LEAD}/${row}/: `;
  if (message.startsWith(echoed)) return message.slice(echoed.length);
  return message.startsWith(REGEX_REASON_LEAD) ? message.slice(REGEX_REASON_LEAD.length) : message;
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

/**
 * Why one pattern row cannot work, or `null` when it is valid.
 *
 * A row empty once trimmed the way the settings save trims it would match
 * every element (an empty regex is always-true), so it is rejected as the
 * user mistake it is. A pattern row must compile as a regular expression and carry no
 * known catastrophic-backtracking shape (`./regex-risk` — a heuristic; the
 * guard rejects exponential shapes only — polynomial ones are accepted and
 * bounded only where the engine runs preemptibly).
 *
 * @param row The row as given.
 * @param rowKind How the row will be matched.
 */
function rowProblem(row: string, rowKind: ExclusionRowKind): string | null {
  if (trimExclusionRow(row) === '') return EMPTY_ROW_REASON;
  if (rowKind === 'pattern') {
    try {
      new RegExp(row);
    } catch (error) {
      return `${REGEX_REASON_LEAD}${regexErrorDetail(row, error)}`;
    }
    const risk = regexBacktrackingRisk(row);
    if (risk !== null) return BACKTRACKING_RISK_REASONS[risk];
  }
  return null;
}

/**
 * Pattern features WP Rocket matches with PCRE, keyed to their translator's
 * row problems (whole-set: some only exist joined) — these replace the
 * generic JS compile + backtracking checks for that feature's rows. One
 * entry per feature; features absent here keep the generic checks.
 */
const PCRE_ROW_PROBLEMS: Partial<
  Record<ExclusionFeatureId, (rows: readonly string[]) => readonly InvalidExclusionRow[]>
> = {
  defer_all_js: deferRowProblems
};

/**
 * Validate one feature's rows — all of them.
 *
 * @param feature The feature the rows belong to (names the problem rows).
 * @param rowKind How the rows will be matched.
 * @param rows The rows as given.
 * @returns Every problem, in list order; empty when the rows are valid.
 */
export function featureRowProblems(
  feature: ExclusionFeatureId,
  rowKind: ExclusionRowKind,
  rows: readonly string[]
): readonly InvalidExclusionRow[] {
  const translated = rowKind === 'pattern' ? PCRE_ROW_PROBLEMS[feature] : undefined;
  const pcreProblems =
    translated === undefined
      ? null
      : new Map(translated(rows).map((problem) => [problem.index, problem]));
  const problems: InvalidExclusionRow[] = [];
  rows.forEach((row, index) => {
    if (rowKind === 'literal') {
      const problem = literalRowProblem(feature, row, rows);
      if (problem !== null) problems.push({ feature, index, row, ...problem });
      return;
    }
    // An empty row stays the editor's own mistake, ahead of any PCRE reading.
    if (pcreProblems !== null && trimExclusionRow(row) !== '') {
      const problem = pcreProblems.get(index);
      if (problem !== undefined) problems.push(problem);
      return;
    }
    const reason = rowProblem(row, rowKind);
    if (reason !== null) problems.push({ feature, index, row, reason });
  });
  return problems;
}

/**
 * Prevalidate a whole exclusion set — the UI's inline-feedback source and
 * the pipeline's gate: every row of every feature is checked, and the
 * result names each invalid one. Each transform re-runs its feature's
 * checks on its throwing path (`compilePatternRows`, or the feature's own
 * matcher module).
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
