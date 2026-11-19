/**
 * The virtual list's sticky rows (section headings that stay pinned to the
 * scroller's top while their section scrolls under them).
 *
 * Why a range extractor: a virtual row is absolutely placed at its offset, so
 * CSS `position: sticky` alone cannot pin it — and once its section scrolls
 * far enough, the heading leaves the render window entirely. The extractor
 * keeps the *active* sticky row (the last one at or above the first visible
 * row) in every window, and the list renders that one row sticky instead of
 * translated.
 */
import { defaultRangeExtractor, type Range } from '@tanstack/solid-virtual';

/**
 * The active sticky row for a window: the last sticky index at or above the
 * window's first visible row.
 *
 * @param sticky The sticky indexes, ascending (callers list rows in order; unsorted input reads wrong).
 * @param startIndex The first visible row's index.
 * @returns The active sticky index, or null when no sticky row sits at or above it.
 */
export function activeStickyIndex(sticky: readonly number[], startIndex: number): number | null {
  // Binary search: the lists are short, but a 5 000-row list may carry many headings.
  let low = 0;
  let high = sticky.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const index = sticky[middle] ?? Number.POSITIVE_INFINITY;
    if (index <= startIndex) {
      found = index;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/**
 * Add the active sticky index to a window's indexes, kept ascending and
 * unique (the list renders rows in index order — the DOM, tab and reading
 * order).
 *
 * Ordering invariant: the active row is at or above the window's first
 * visible row and the window is one contiguous run, so an active row the
 * window lacks sits below its first index — prepending keeps it ascending.
 *
 * @param indexes The window's indexes, ascending and contiguous.
 * @param active The active sticky index (at or above the window's first visible row), or null.
 * @returns `indexes` itself when nothing is added, else a new ascending list.
 */
export function withStickyIndex(indexes: number[], active: number | null): number[] {
  if (active === null || indexes.includes(active)) return indexes;
  return [active, ...indexes];
}

/**
 * Build the core's range extractor for a sticky list: the default window
 * (overscan included) plus the active sticky row, reported to `onActive`
 * each time the core computes a window (the list's only way to learn which
 * row is stuck: the core exposes no reactive range).
 *
 * @param sticky The sticky indexes, ascending.
 * @param onActive Receives the active sticky index (null when none) per computed window.
 * @returns The extractor to pass as the core's `rangeExtractor`.
 */
export function stickyRangeExtractor(
  sticky: readonly number[],
  onActive: (active: number | null) => void
): (range: Range) => number[] {
  return (range) => {
    const active = activeStickyIndex(sticky, range.startIndex);
    onActive(active);
    return withStickyIndex(defaultRangeExtractor(range), active);
  };
}
