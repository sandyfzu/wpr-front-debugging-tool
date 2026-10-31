/**
 * Character tests WP Rocket's patterns make, for the hand-written scanners
 * that replace them here: PCRE's `\s` without the UTF option, and ASCII-
 * only caseless literals (the `i` flag on a byte subject never folds a
 * non-ASCII byte onto an ASCII letter).
 */

/**
 * Whether `text[index]` is PCRE's `\s` without UTF — tab, LF, vertical
 * tab, form feed, CR and space (the byte set's `PCRE_SPACE_CHARS`) — tested by code
 * (scanners call it per character); `false` out of range.
 *
 * @param text The subject.
 * @param index An offset.
 */
export function isSpaceAt(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code === 0x20 || (code >= 0x09 && code <= 0x0d);
}

/**
 * Offset past the `\s` run starting at `index`.
 *
 * @param text The subject.
 * @param index An offset.
 */
export function skipSpaces(text: string, index: number): number {
  let at = index;
  while (isSpaceAt(text, at)) at++;
  return at;
}

/**
 * Start of the `\s` run ending just before `end` (`end` itself when none).
 *
 * @param text The subject.
 * @param end An offset.
 */
export function skipSpacesBack(text: string, end: number): number {
  let at = end;
  while (isSpaceAt(text, at - 1)) at--;
  return at;
}

/**
 * Whether `word` (lowercase ASCII) is spelled at `index`, ASCII letters
 * compared caselessly.
 *
 * @param text The subject.
 * @param index An offset.
 * @param word The literal, lowercase.
 */
export function asciiCaselessAt(text: string, index: number, word: string): boolean {
  if (index < 0 || index + word.length > text.length) return false;
  for (let offset = 0; offset < word.length; offset++) {
    const code = text.charCodeAt(index + offset);
    // Fold A–Z only: `| 0x20` would also map punctuation such as `@` onto a letter.
    const folded = code >= 65 && code <= 90 ? code + 32 : code;
    if (folded !== word.charCodeAt(offset)) return false;
  }
  return true;
}
