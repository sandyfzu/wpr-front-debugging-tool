/**
 * Typed errors of the exclusion engine, and which named rows block. A
 * broken exclusion row is user data to fix in the editor, not a crash to
 * swallow — the validation error carries every problem at once so a UI can
 * render them all inline.
 */
import { NON_BLOCKING_PROBLEMS, type ProblemId } from './pcre/problems';
import type { ExclusionFeatureId } from './set';

/** One invalid exclusion row, named for inline feedback in the editor. */
export interface InvalidExclusionRow {
  readonly feature: ExclusionFeatureId;
  /** The row's index within its feature's list. */
  readonly index: number;
  /** The row as given. */
  readonly row: string;
  /** Why the row cannot work — actionable, naming the offending value. */
  readonly reason: string;
  /** The typed kind of problem, where one is named (e.g. a row that matches every element). */
  readonly problem?: ProblemId;
}

/**
 * Whether a named row blocks an apply (see {@link NON_BLOCKING_PROBLEMS}).
 *
 * @param entry The row's entry.
 */
export function isBlockingProblem(entry: Pick<InvalidExclusionRow, 'problem'>): boolean {
  return entry.problem === undefined || !NON_BLOCKING_PROBLEMS.has(entry.problem);
}

/**
 * The rows named as matching every candidate (`match-all`), in entry order —
 * a transform's report names them beside its counts.
 *
 * @param entries A feature's named rows.
 */
export function matchAllRows(entries: readonly InvalidExclusionRow[]): string[] {
  return entries.filter((entry) => entry.problem === 'match-all').map((entry) => entry.row);
}

/**
 * Thrown when an exclusion set carries invalid rows — from
 * `runExclusionPipeline` (every feature's problems at once, before any transform
 * runs) or from a directly-called transform (that feature's problems).
 */
export class ExclusionValidationError extends Error {
  override readonly name = 'ExclusionValidationError';

  /** Every problem found — all-at-once, never first-error-only. */
  readonly invalid: readonly InvalidExclusionRow[];

  /**
   * @param invalid The full problem list; must be non-empty (a validation
   *   error with no problems is a broken caller — constructing one throws).
   * @throws {@link Error} when `invalid` is empty.
   */
  constructor(invalid: readonly InvalidExclusionRow[]) {
    if (invalid.length === 0) {
      throw new Error('ExclusionValidationError requires at least one invalid row');
    }
    super(
      `Invalid exclusion rows (${String(invalid.length)}):\n${invalid
        .map(
          (problem) =>
            `  ${problem.feature}[${String(problem.index)}] ${JSON.stringify(problem.row)}: ${problem.reason}`
        )
        .join('\n')}`
    );
    this.invalid = invalid;
  }
}

/**
 * Throw for a feature's blocking rows; the non-blocking ones are the
 * caller's to apply (and report).
 *
 * @param entries Every row the feature's reading named.
 * @throws {@link ExclusionValidationError} naming every blocking row, when any.
 */
export function throwIfBlocking(entries: readonly InvalidExclusionRow[]): void {
  const blocking = entries.filter(isBlockingProblem);
  if (blocking.length > 0) throw new ExclusionValidationError(blocking);
}
