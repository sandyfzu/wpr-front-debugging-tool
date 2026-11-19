/**
 * The sticky-row math: which heading is active for a window, how it joins
 * the window's indexes, and the extractor the core calls per computed window.
 */
import { describe, expect, it, vi } from 'vitest';
import { activeStickyIndex, stickyRangeExtractor, withStickyIndex } from './virtual-list-sticky';

describe('activeStickyIndex', () => {
  it('picks the last sticky index at or above the first visible row', () => {
    const sticky = [0, 5, 12];
    expect(activeStickyIndex(sticky, 0)).toBe(0);
    expect(activeStickyIndex(sticky, 4)).toBe(0);
    expect(activeStickyIndex(sticky, 5)).toBe(5);
    expect(activeStickyIndex(sticky, 11)).toBe(5);
    expect(activeStickyIndex(sticky, 12)).toBe(12);
    expect(activeStickyIndex(sticky, 400)).toBe(12);
  });

  it('is null above the first sticky row and for an empty list', () => {
    expect(activeStickyIndex([3, 8], 2)).toBeNull();
    expect(activeStickyIndex([], 10)).toBeNull();
  });

  it('agrees with a linear scan over many headings (the binary search)', () => {
    const sticky = Array.from({ length: 257 }, (_, index) => index * 3 + 1);
    for (let start = 0; start < 800; start += 7) {
      const expected = sticky.filter((index) => index <= start).at(-1) ?? null;
      expect(activeStickyIndex(sticky, start)).toBe(expected);
    }
  });
});

describe('withStickyIndex', () => {
  it('returns the window unchanged without an active row or when it already holds it', () => {
    const window = [4, 5, 6];
    expect(withStickyIndex(window, null)).toBe(window);
    expect(withStickyIndex(window, 5)).toBe(window);
  });

  it('adds an active row outside the window, keeping the order ascending', () => {
    expect(withStickyIndex([10, 11, 12], 2)).toEqual([2, 10, 11, 12]);
  });
});

describe('stickyRangeExtractor', () => {
  it('serves the overscanned window plus the active row, reporting it per window', () => {
    const onActive = vi.fn<(active: number | null) => void>();
    const extract = stickyRangeExtractor([0, 20], onActive);
    // Rows 25–28 visible, overscan 2 → 23–30; heading 20 joins.
    expect(extract({ startIndex: 25, endIndex: 28, overscan: 2, count: 40 })).toEqual([
      20, 23, 24, 25, 26, 27, 28, 29, 30
    ]);
    expect(onActive).toHaveBeenLastCalledWith(20);
    // Inside the overscan: no duplicate.
    expect(extract({ startIndex: 21, endIndex: 24, overscan: 2, count: 40 })).toEqual([
      19, 20, 21, 22, 23, 24, 25, 26
    ]);
    expect(onActive).toHaveBeenCalledTimes(2);
  });

  it('reports null and serves the plain window above every sticky row', () => {
    const onActive = vi.fn<(active: number | null) => void>();
    const extract = stickyRangeExtractor([10], onActive);
    expect(extract({ startIndex: 0, endIndex: 3, overscan: 1, count: 20 })).toEqual([
      0, 1, 2, 3, 4
    ]);
    expect(onActive).toHaveBeenLastCalledWith(null);
  });
});
