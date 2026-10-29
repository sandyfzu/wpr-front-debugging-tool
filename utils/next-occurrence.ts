/**
 * Repeated "first hit at or after `from`" searches over one text, answered
 * from what earlier searches already proved: a scan whose search starts
 * mostly move forward then reads each character about once in total,
 * where a fresh search per call re-reads the same stretch every time —
 * quadratic when the hit is far away or absent.
 */

/** Finds the first hit at or after an offset (`-1` when none). */
export type NextOccurrence = (from: number) => number;

/**
 * A forward search over a fixed per-offset property (whether a hit starts
 * at an offset never depends on where the search started).
 *
 * @param from Where the search starts.
 * @param to Where it stops (exclusive; `Infinity` = the end of the text).
 * @returns The first hit in `[from, to)`, or `-1`.
 */
export type ForwardSearch = (from: number, to: number) => number;

/**
 * A search that remembers one proven stretch: no hit in `[lo, found)`
 * (`found = -1`: none from `lo` on). A call inside it is answered at once;
 * a call before it searches only the gap up to `lo`; a call past it
 * searches afresh. Exact for any call order; linear in total when starts
 * never decrease, and only the gaps are re-read when they step back.
 *
 * @param search The bounded forward search.
 * @returns The finder.
 */
export function cachedForwardSearch(search: ForwardSearch): NextOccurrence {
  let lo = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from) => {
    if (from >= lo && (found === -1 || from <= found)) return found;
    if (from < lo) {
      const hit = search(from, lo);
      lo = from;
      // Nothing in the gap: the proven stretch now starts at `from`.
      if (hit !== -1) found = hit;
      return found;
    }
    lo = from;
    found = search(from, Number.POSITIVE_INFINITY);
    return found;
  };
}

/**
 * A cached `text.indexOf(needle, from)` ({@link cachedForwardSearch}).
 *
 * @param text The text searched.
 * @param needle The non-empty string looked for.
 * @returns The finder: the occurrence's offset, or `-1` when none.
 * @throws {@link Error} when `needle` is empty (every offset would match).
 */
export function nextOccurrenceFinder(text: string, needle: string): NextOccurrence {
  if (needle === '') throw new Error('nextOccurrenceFinder needs a non-empty needle');
  return cachedForwardSearch((from, to) => {
    if (to === Number.POSITIVE_INFINITY) return text.indexOf(needle, from);
    // Bounded: a gap search must not read past its end.
    const at = text.slice(Math.max(from, 0), to + needle.length - 1).indexOf(needle);
    return at === -1 ? -1 : Math.max(from, 0) + at;
  });
}
