/** Maximum retained code points in a hover title, excluding the ellipsis. */
export const TITLE_MAX = 300;

/**
 * Bound display text without splitting surrogate pairs or scanning its full tail.
 *
 * @param text The full text; copy values and link targets must remain separate.
 * @param max The non-negative, safe-integer limit in Unicode code points.
 * @returns The original text, or the retained prefix plus an ellipsis.
 * @throws {@link RangeError} When the limit is not a non-negative safe integer.
 */
export function capText(text: string, max: number): string {
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new RangeError(`Text cap must be a non-negative safe integer; received ${String(max)}.`);
  }
  let length = 0;
  let end = 0;
  for (const point of text) {
    if (length === max) return `${text.slice(0, end)}…`;
    length += 1;
    end += point.length;
  }
  return text;
}

/**
 * Bound a hover title using the shared code-point limit.
 *
 * @param text The full display text.
 * @returns At most {@link TITLE_MAX} retained code points plus an ellipsis.
 */
export function capTitle(text: string): string {
  return capText(text, TITLE_MAX);
}

/**
 * Cut a string to `max` UTF-16 units without leaving half a surrogate pair
 * (for caps counted in units, as storage and message bounds are).
 *
 * @param text The text.
 * @param max The cap in UTF-16 units (a non-negative integer).
 * @returns The text, or its longest whole-character prefix within the cap.
 */
export function cutToUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 0) return '';
  const last = text.charCodeAt(max - 1);
  // A high surrogate at the cut would be half a character.
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * Clip a string to `max` UTF-16 units, marking a cut with `…` (counted in
 * the cap), never splitting a surrogate pair.
 *
 * @param text The text.
 * @param max The cap in UTF-16 units (at least 1).
 * @returns The text, or its clipped prefix plus `…`.
 */
export function clipToUnits(text: string, max: number): string {
  return text.length <= max ? text : `${cutToUnits(text, max - 1)}…`;
}
