/**
 * Excerpts of two long texts cut around where they differ, so a reader
 * comparing them sees the difference instead of two identical prefixes.
 * Texts are read as user-perceived characters (grapheme clusters, via
 * `Intl.Segmenter` — Chrome 87+, Firefox 125+, Node 16+), so a cut never
 * leaves a lone combining accent or half a ZWJ emoji.
 */

/** Two texts as shown: each cut to the same window, `…` marking a cut. */
export interface DifferenceExcerpts {
  readonly left: string;
  readonly right: string;
}

/** One grapheme segmenter for every call (locale-independent for cluster bounds). */
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * A text's grapheme clusters, in order.
 *
 * @param text The text.
 */
function clusters(text: string): string[] {
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment);
}

/**
 * Cut two texts around their first difference: both keep the same start
 * (`context` characters before the difference, so the shared lead-in lines
 * up) and run to `context` characters past the difference's end, at most
 * `max` characters each. Texts that both fit are returned whole. A
 * character is a grapheme cluster: a cut falls only between clusters.
 *
 * @param left One text.
 * @param right The other.
 * @param max The most characters an excerpt keeps (ellipses excluded).
 * @param context Characters kept around the difference.
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
  const a = clusters(left);
  const b = clusters(right);
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
 *
 * @param parts The text's clusters.
 * @param start The window's first cluster.
 * @param suffix Clusters both texts share at their end.
 * @param max The window's most clusters.
 * @param context Clusters kept past the difference.
 */
function cut(
  parts: readonly string[],
  start: number,
  suffix: number,
  max: number,
  context: number
): string {
  const differenceEnd = parts.length - suffix;
  const end = Math.min(parts.length, differenceEnd + context, start + max);
  const body = parts.slice(start, end).join('');
  return `${start > 0 ? '…' : ''}${body}${end < parts.length ? '…' : ''}`;
}
