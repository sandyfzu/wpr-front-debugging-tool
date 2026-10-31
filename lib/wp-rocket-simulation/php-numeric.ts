/**
 * WordPress's `absint($text)` = `abs((int) $text)` on a string, as PHP 8
 * converts it: optional leading whitespace (space, tab, LF, CR, vertical
 * tab, form feed), an optional sign, then the longest decimal number
 * prefix (digits, an optional fraction, an optional exponent with digits);
 * anything else after it is ignored, and no number at all gives 0. An
 * integer prefix converts as is; one with a fraction or exponent converts
 * through a float, truncated toward zero.
 *
 * Only values JavaScript represents exactly are reproduced: past 2^53 PHP
 * saturates at its 64-bit limits (and `abs` of the lowest one turns into a
 * float), so such a value is `null` — not reproducible.
 */

/** The number prefix PHP reads, after its leading whitespace. */
const NUMBER_PREFIX = /^[ \t\n\r\v\f]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

/**
 * `absint($text)`, or `null` when the magnitude reaches 2^53.
 *
 * @param text The attribute value.
 */
export function phpAbsint(text: string): number | null {
  const prefix = NUMBER_PREFIX.exec(text)?.[1];
  if (prefix === undefined) return 0;
  const value = Math.abs(Math.trunc(Number(prefix)));
  return Number.isSafeInteger(value) ? value : null;
}
