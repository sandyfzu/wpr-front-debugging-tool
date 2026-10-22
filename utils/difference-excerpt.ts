/**
 * Excerpts of two long texts cut around where they differ, so a reader
 * comparing them sees the difference instead of two identical prefixes.
 */

/** Two texts as shown: each cut to the same window, `…` marking a cut. */
export interface DifferenceExcerpts {
  readonly left: string;
  readonly right: string;
}

/**
 * Cut two texts around their first difference: both keep the same start
 * (`context` code points before the difference, so the shared lead-in
 * lines up) and run to `context` code points past the difference's end,
 * at most `max` code points each. Texts that both fit are returned whole.
 * Counts code points (a surrogate pair is never split).
 *
 * @param left One text.
 * @param right The other.
 * @param max The most code points an excerpt keeps (ellipses excluded).
 * @param context Code points kept around the difference.
 * @throws {@link RangeError} When `max` or `context` is not a non-negative safe integer.
 */
export function differenceExcerpts(
  left: string,
  right: string,
  max: number,
  context = 12
): DifferenceExcerpts {
  for (const [name, value] of [
    ['max', max],
    ['context', context]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(
        `${name} must be a non-negative safe integer; received ${String(value)}.`
      );
  }
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length <= max && b.length <= max) return { left, right };
  const shortest = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shortest && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix])
    suffix += 1;
  const start = Math.max(0, prefix - context);
  return { left: cut(a, start, suffix, max, context), right: cut(b, start, suffix, max, context) };
}

/**
 * One text's window: from `start` to `context` past its differing part,
 * at most `max` long.
 */
function cut(
  points: readonly string[],
  start: number,
  suffix: number,
  max: number,
  context: number
): string {
  const differenceEnd = points.length - suffix;
  const end = Math.min(points.length, differenceEnd + context, start + max);
  const body = points.slice(start, end).join('');
  return `${start > 0 ? '…' : ''}${body}${end < points.length ? '…' : ''}`;
}
