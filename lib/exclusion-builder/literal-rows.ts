/**
 * How WP Rocket's runtime reads the rows of the two literal features before
 * matching them — the one declaring site for their empty-row semantics,
 * shared by validation and the feature transforms.
 *
 * - Image Lazyload: `array_filter` drops `''` and `"0"` from the row list,
 *   so those rows never match anything; every other row is a substring.
 * - Automatic Lazy Rendering: the rows are `preg_quote`d and joined into one
 *   `/(r1|r2…)/i` alternation, skipped altogether when PHP's `empty()` holds
 *   for the joined text (`''` or `"0"`); otherwise an empty row is an empty
 *   alternative, which matches every element.
 */

/**
 * Whether WP Rocket ignores a Lazyload row (`array_filter` drops it).
 *
 * @param row The row as stored.
 */
export function isIgnoredLazyloadRow(row: string): boolean {
  return row === '' || row === '0';
}

/**
 * Whether a set of Automatic Lazy Rendering rows excludes nothing at all:
 * the joined alternation is `''` or `"0"`, which WP Rocket skips.
 *
 * @param rows The rows as given to WP Rocket's filter.
 */
export function lazyRenderRowsInert(rows: readonly string[]): boolean {
  const joined = rows.join('|');
  return joined === '' || joined === '0';
}

/**
 * Whether an Automatic Lazy Rendering row matches every element: an empty
 * row in a set that is not inert (an empty alternative of the joined
 * pattern).
 *
 * @param row The row.
 * @param rows Every row of the set (decides whether the set is inert).
 */
export function isMatchAllLazyRenderRow(row: string, rows: readonly string[]): boolean {
  return row === '' && !lazyRenderRowsInert(rows);
}

/**
 * ASCII-only lowercasing — PCRE's `i` flag without `u` folds `A`–`Z` only
 * (`É` and `é` stay distinct), unlike `String.prototype.toLowerCase`.
 *
 * @param text Any text.
 * @returns The text with `A`–`Z` lowered and everything else unchanged.
 */
export function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}
