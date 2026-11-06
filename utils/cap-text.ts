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
 * The UTF-16 length a string capped by {@link capText} at `points` code
 * points can reach: two units per astral code point, plus the ellipsis — the
 * cap a receiver checks a sender-capped string against.
 *
 * @param points The code-point cap.
 */
export function cappedUnits(points: number): number {
  return 2 * points + 1;
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
