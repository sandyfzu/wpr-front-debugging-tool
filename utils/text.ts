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
