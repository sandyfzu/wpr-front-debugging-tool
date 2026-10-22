/**
 * Defer JS row matching as WP Rocket runs it. WP Rocket joins every stored
 * row into one `#(r1|r2|…)#i`, runs a pre-check on it (a failure defers no
 * script on the page), then tests it against each script's captured `src`.
 *
 * The joined alternation matches a subject exactly when one of its rows
 * matches it alone, as long as no row behaves differently joined — such rows
 * are row problems (`joined-changes-matching`, no matcher) — so the set's
 * matcher is the OR of the rows' translated matchers, and the page state is
 * the translator's replay of the pre-check. Which row matched is not
 * observable on WP Rocket; crediting the first matching row in list order
 * is this tool's best effort.
 *
 * One translation per row set, memoized: the validator and the transform
 * share it.
 */
import { createBoundedMemo, detachedString, stringBytes } from '../../utils/bounded-memo';
import type { InvalidExclusionRow } from './errors';
import type { ProblemId } from './pcre/problems';
import {
  compileFirstMatch,
  REGEX_BYTES_PER_CHAR,
  translationRowProblems,
  translateRegexRows,
  type PageState
} from './pcre/rows';

const FEATURE = 'defer_all_js';

/**
 * The problems a Defer JS row has only through the other rows of its set
 * (the joined pre-check, the joined matching): reading a row alone cannot
 * tell them — alone, `a\Qb` fails the pre-check; next to a row holding
 * `\E`, it passes — so only a whole-set reading may report them.
 */
export const JOINED_ONLY_PROBLEMS: ReadonlySet<ProblemId> = new Set<ProblemId>([
  'joined-page-off',
  'joined-changes-matching'
]);

/** A Defer JS row set, translated once. */
export interface DeferRowSet {
  /** Every row WP Rocket does not match as this tool would, as validation entries, in row order. */
  readonly problems: readonly InvalidExclusionRow[];
  /**
   * WP Rocket's page state under the rows: `off` — its pre-check fails and
   * it defers no script on the page (the rows behind it carry the
   * `joined-page-off` problem); `unknown` — the pre-check cannot be replayed
   * exactly here; `on` otherwise.
   */
  readonly page: PageState;
  /**
   * The rows behind a page `off`, by index in list order: those carrying
   * `joined-page-off` (unverified rows included). Empty when the page is
   * not off, or when only rows with an outranking problem (one WP Rocket's
   * save drops) turn it off — their own problem says so.
   */
  readonly pageOffRows: readonly number[];
  /**
   * The index of the first row, in list order, whose matcher matches the
   * subject; `-1` when none does. Rows without a matcher (each one has a
   * problem) never match.
   */
  readonly firstMatch: (subject: string) => number;
  /** Bytes the set retains at most, its matcher compiled (its memo weight). */
  readonly retainedBytes: number;
}

/**
 * The set memo's bounds: entries, and bytes retained (see
 * {@link DeferRowSet.retainedBytes}), so a few wire-cap sets cannot pin
 * megabytes in the overlay's realm.
 */
export const DEFER_ROW_SET_CACHE_LIMITS = { entries: 16, bytes: 128 * 1024 } as const;

/** Fixed bytes of one kept set (its record, closures and entry). */
const SET_ENTRY_BYTES = 4096;
/** Bytes per row of a kept set (its translated-row record, matcher and problem): measured ≈ 540. */
const SET_ROW_BYTES = 640;

/** The memo: the rows (as a JSON key) → their translation. */
const rowSetMemo = createBoundedMemo<DeferRowSet>({
  maxEntries: DEFER_ROW_SET_CACHE_LIMITS.entries,
  maxWeight: DEFER_ROW_SET_CACHE_LIMITS.bytes,
  weigh: (key, set) => stringBytes(key) + set.retainedBytes
});

/**
 * Translate a Defer JS row set (uncached). Matchers compile on the first
 * match, so validation-only callers never build a regex.
 *
 * @param rows The stored rows, in order.
 */
function translateRowSet(rows: readonly string[]): DeferRowSet {
  const translation = translateRegexRows(FEATURE, rows);
  let firstMatch: ((subject: string) => number) | null = null;
  const problems = translationRowProblems(FEATURE, translation);
  return {
    problems,
    page: translation.page,
    pageOffRows: problems
      .filter(({ problem }) => problem === 'joined-page-off')
      .map(({ index }) => index),
    // Upper bound of what the set keeps once its matcher ran: the rows'
    // records, their sources and those sources compiled.
    retainedBytes: translation.rows.reduce(
      (sum, { row, matcher }) =>
        sum +
        SET_ROW_BYTES +
        stringBytes(row) +
        (matcher === null
          ? 0
          : stringBytes(matcher.source) + REGEX_BYTES_PER_CHAR * matcher.source.length),
      SET_ENTRY_BYTES
    ),
    firstMatch: (subject) => {
      firstMatch ??= compileFirstMatch(translation.rows.map(({ matcher }) => matcher));
      return firstMatch(subject);
    }
  };
}

/**
 * A Defer JS row set's problems, page state and matcher, memoized by the
 * rows (bounded; the same rows always yield the same translation).
 *
 * @param rows The stored rows, in order.
 */
export function deferRowSet(rows: readonly string[]): DeferRowSet {
  // The set keeps its rows: never as views on the field's text.
  return rowSetMemo.get(JSON.stringify(rows), () => translateRowSet(rows.map(detachedString)));
}

/**
 * The Defer JS rows that do not match here as on the live site, as
 * validation entries (the page-wide `joined-page-off` included).
 *
 * @param rows The stored rows, in order.
 * @returns One entry per row with a problem, in row order.
 */
export function deferRowProblems(rows: readonly string[]): readonly InvalidExclusionRow[] {
  return deferRowSet(rows).problems;
}
