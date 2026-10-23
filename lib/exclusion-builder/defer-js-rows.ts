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
   * Compile the rows' matchers into a lookup of the first row, in list
   * order, whose matcher matches the subject (`-1` when none does; rows
   * without a matcher — each one has a problem — never match). Compiled
   * per call and never kept by the set: compiled regexes cost up to 80 B
   * per source character, so a memoized set stays small (validation never
   * compiles) and a caller keeps its lookup only while it matches.
   */
  readonly compileMatcher: () => (subject: string) => number;
  /** Bytes the set retains at most, uncompiled (its memo weight). */
  readonly retainedBytes: number;
}

/**
 * The set memo's bounds: entries, and bytes retained (see
 * {@link DeferRowSet.retainedBytes}): a full realistic lane (500 rows of
 * script paths or patterns) fits, so re-reading an unchanged lane is a
 * hit, while a few wire-cap sets cannot pin megabytes in the overlay's
 * realm (one heavier than the bound is translated per read, never kept).
 */
export const DEFER_ROW_SET_CACHE_LIMITS = { entries: 16, bytes: 512 * 1024 } as const;

/** Fixed bytes of one kept set (its record, closures and entry). */
const SET_ENTRY_BYTES = 4096;
/**
 * Bytes per row of a kept set beyond its row and source strings (its
 * translated-row record, matcher description and problem): Chromium
 * retains ≤ 280 per row with the strings, uncompiled.
 */
const SET_ROW_BYTES = 384;

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
  const problems = translationRowProblems(FEATURE, translation);
  return {
    problems,
    page: translation.page,
    pageOffRows: problems
      .filter(({ problem }) => problem === 'joined-page-off')
      .map(({ index }) => index),
    // Upper bound of what the set keeps: the rows' records, the rows and
    // their sources (never compiled: see `compileMatcher`).
    retainedBytes: translation.rows.reduce(
      (sum, { row, matcher }) =>
        sum +
        SET_ROW_BYTES +
        stringBytes(row) +
        (matcher === null ? 0 : stringBytes(matcher.source)),
      SET_ENTRY_BYTES
    ),
    compileMatcher: () => compileFirstMatch(translation.rows.map(({ matcher }) => matcher))
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

/** What the set memo keeps now (entries, bytes by its weights): its bound is pinned by tests. */
export function deferRowSetCacheUsage(): { readonly entries: number; readonly bytes: number } {
  return { entries: rowSetMemo.size, bytes: rowSetMemo.weight };
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
