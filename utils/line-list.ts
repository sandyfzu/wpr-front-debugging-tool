/**
 * One-entry-per-line list fields (patterns, selectors, file names typed in a
 * textarea) read the same way everywhere: every line break form splits,
 * each line is trimmed, blank lines are dropped, and repeats collapse onto
 * their first occurrence so the typed order survives.
 */

/**
 * Parse line-list text into its entries.
 *
 * CRLF, lone CR and LF all break a line (a textarea's value normalizes to LF,
 * a paste may not). Commas never split: a line is one entry whatever it
 * holds (`a, b` is a valid CSS selector list, `x{1,3}` a valid pattern).
 *
 * @param text The raw field text.
 * @returns The trimmed, non-empty, order-preserving deduplicated entries.
 */
export function parseLineList(text: string): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r\n?|\n/)) {
    const entry = line.trim();
    if (entry !== '') seen.add(entry);
  }
  // A Set iterates in insertion order and ignores re-adds: first occurrence wins.
  return [...seen];
}
