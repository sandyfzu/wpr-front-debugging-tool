/**
 * PHP's `preg_quote` and the delimiter scan PHP runs on a delimited
 * pattern — what decides whether WP Rocket's joined list patterns compile.
 */

/** Characters `preg_quote` escapes with a backslash (PHP ≥ 7.3: `#` included). */
const QUOTED = new Set('.\\+*?[^]$(){}=!<>|:-#');

/**
 * PHP's `preg_quote($text, $delimiter)`: a backslash before every regex
 * special character and before the delimiter's first character (PHP reads
 * only that one), NUL as `\000`.
 *
 * @param text The literal text.
 * @param delimiter The pattern delimiter (absent = none extra).
 */
export function pregQuote(text: string, delimiter?: string): string {
  const extra = delimiter?.[0];
  let out = '';
  for (const char of text) {
    if (char === '\0') out += '\\000';
    else if (QUOTED.has(char) || char === extra) out += `\\${char}`;
    else out += char;
  }
  return out;
}

/**
 * Where PHP's pattern reader stops a delimited pattern's body: the first
 * delimiter not preceded by a backslash escape. In a pattern built as
 * `delimiter + body + delimiter + modifiers`, a stop inside the body makes
 * the rest read as modifiers — PHP's "Unknown modifier" warning, and
 * `preg_match` returns false (nothing matches).
 *
 * @param body The text between the delimiters.
 * @param delimiter The one-character delimiter.
 * @returns The stop offset in `body`, or -1 when the body is intact.
 */
export function unescapedDelimiterAt(body: string, delimiter: string): number {
  for (let index = 0; index < body.length; index++) {
    if (body[index] === '\\') index++;
    else if (body[index] === delimiter) return index;
  }
  return -1;
}
