/** PHP `trim`'s default character set (space, tab, LF, CR, NUL, vertical tab), at either end. */
const PHP_TRIM = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/**
 * PHP's `trim($text)` with its default character set — the trim WP Rocket
 * and WordPress apply to rows and attribute values. Wider Unicode spaces
 * (no-break space, line separator, BOM…) and form feed are kept.
 *
 * @param text The text.
 */
export function phpTrim(text: string): string {
  return text.replace(PHP_TRIM, '');
}
