/**
 * Uppercase the first character of a string, leaving the rest untouched — labels and
 * names rendered from data that arrives lowercase.
 *
 * @param text The string to capitalize; may be empty.
 * @returns `text` with its first character uppercased (empty stays empty).
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * How many times a non-empty text occurs in another, non-overlapping
 * (linear: one `indexOf` walk).
 *
 * @param text The text searched.
 * @param needle The text counted.
 * @throws {@link Error} when `needle` is empty (it would occur everywhere).
 */
export function countOccurrences(text: string, needle: string): number {
  if (needle === '') throw new Error('countOccurrences: the needle is empty');
  let count = 0;
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

/**
 * Join words as an English list without a serial comma: "A", "A and B",
 * "A, B and C".
 *
 * @param words The words, in order (empty gives '').
 */
export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}
