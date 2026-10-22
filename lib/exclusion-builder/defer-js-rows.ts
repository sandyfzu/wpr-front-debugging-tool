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
import type { InvalidExclusionRow } from './errors';
import {
  compileFirstMatch,
  translationRowProblems,
  translateRegexRows,
  type PageState
} from './pcre/rows';

const FEATURE = 'defer_all_js';

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
   * The index of the first row, in list order, whose matcher matches the
   * subject; `-1` when none does. Rows without a matcher (each one has a
   * problem) never match.
   */
  readonly firstMatch: (subject: string) => number;
}

/** The memo's entry bound — oldest-inserted sets evicted first. */
export const DEFER_ROW_SET_CACHE_LIMIT = 16;

/** The memo: the rows (as a JSON key) → their translation. */
const rowSetCache = new Map<string, DeferRowSet>();

/**
 * Translate a Defer JS row set (uncached). Matchers compile on the first
 * match, so validation-only callers never build a regex.
 *
 * @param rows The stored rows, in order.
 */
function translateRowSet(rows: readonly string[]): DeferRowSet {
  const translation = translateRegexRows(FEATURE, rows);
  let firstMatch: ((subject: string) => number) | null = null;
  return {
    problems: translationRowProblems(FEATURE, translation),
    page: translation.page,
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
  const key = JSON.stringify(rows);
  const cached = rowSetCache.get(key);
  if (cached !== undefined) return cached;
  const translated = translateRowSet(rows);
  if (rowSetCache.size >= DEFER_ROW_SET_CACHE_LIMIT) {
    const oldest = rowSetCache.keys().next();
    if (oldest.done !== true) rowSetCache.delete(oldest.value);
  }
  rowSetCache.set(key, translated);
  return translated;
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
