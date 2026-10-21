/** Regular-expression text helpers shared by every module that builds a pattern from data. */

/**
 * Escape every regex metacharacter so the text matches itself literally
 * when interpolated into a pattern (no-flag and `u` syntax alike). Readable
 * on purpose — `-` and `/` stay as-is (they are only special inside a class
 * or a literal's delimiters) — because some callers show the result to a
 * user as an editable pattern.
 *
 * @param input The literal text.
 * @returns The escaped pattern text.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
