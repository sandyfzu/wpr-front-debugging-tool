/**
 * Typed errors of the exclusion engine. A broken exclusion row is user data
 * to fix in the editor, not a crash to swallow — the validation error
 * carries every problem at once so a UI can render them all inline.
 */
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
}

/**
 * Thrown when an exclusion set carries invalid rows — from
 * `applyPipeline` (every feature's problems at once, before any transform
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
