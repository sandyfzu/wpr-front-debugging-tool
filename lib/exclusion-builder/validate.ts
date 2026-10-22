/**
 * All-at-once prevalidation of an exclusion set: every row of every
 * feature is checked, and every problem is named (feature, index, row,
 * reason) — never first-error-only, so an editor can render all feedback
 * inline in one pass. Pure: no compilation state is kept.
 */
import type { InvalidExclusionRow } from './errors';
import { trimExclusionRow } from './field-text';
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

/**
 * Why one row cannot work, or `null` when it is valid.
 *
 * A row empty once trimmed the way the settings save trims it would match
 * every element (an empty regex and an empty `includes` are always-true),
 * so it is rejected as the user mistake it is. A pattern row must compile as a regular expression and carry no
 * known catastrophic-backtracking shape (`./regex-risk` — a heuristic; the
 * guard rejects exponential shapes only — polynomial ones are accepted and
 * bounded only where the engine runs preemptibly); a literal row is never
 * compiled — regex-looking text is a fine substring.
 *
 * @param row The row as given.
 * @param rowKind How the row will be matched.
 */
function rowProblem(row: string, rowKind: ExclusionRowKind): string | null {
  if (trimExclusionRow(row) === '') return 'Row is empty — it would match every element';
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
  const problems: InvalidExclusionRow[] = [];
  rows.forEach((row, index) => {
    const reason = rowProblem(row, rowKind);
    if (reason !== null) problems.push({ feature, index, row, reason });
  });
  return problems;
}

/**
 * Prevalidate a whole exclusion set — the UI's inline-feedback source and
 * the pipeline's gate: every row of every feature is checked, and the
 * result names each invalid one. Compilation itself lives in
 * `compilePattern`/`compilePatternRows`, which re-run these checks on the
 * throwing path.
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
