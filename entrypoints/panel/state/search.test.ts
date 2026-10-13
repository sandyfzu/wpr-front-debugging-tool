/**
 * The search store's tests: the 250 ms debounced query commit (the
 * intentionally-snappier delta the shell logs), immediate clear semantics,
 * cursor math (wrapping, no-match no-ops, out-of-range recovery), and the
 * page-fed match count validation. The debounce runs on fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, createSearchStore, moveCursor } from './search';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createSearchStore', () => {
  it('commits the query after the quiet period — 250 ms, the logged delta', async () => {
    const store = createSearchStore();
    store.perform('wp');
    expect(store.query()).toBe('');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 1);
    expect(store.query()).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(store.query()).toBe('wp');
  });

  it('keeps only the last delivery of a burst (trailing debounce)', async () => {
    const store = createSearchStore();
    store.perform('wp');
    store.perform('wp r');
    store.perform('wp roc');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.query()).toBe('wp roc');
  });

  it('resets the match cursor when a fresh query commits', async () => {
    const store = createSearchStore();
    store.setMatchCount(5);
    store.advance(1);
    store.advance(1);
    store.perform('fresh');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.cursor()).toBe(0);
  });

  it('clears immediately on cancel (no pending resurrection)', async () => {
    const store = createSearchStore();
    store.perform('wp');
    store.cancel();
    expect(store.query()).toBe('');
    expect(store.cursor()).toBe(0);
    expect(store.matchCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2);
    expect(store.query()).toBe('');
  });

  it('treats an emptied input as an immediate clear too', async () => {
    const store = createSearchStore();
    store.perform('wp');
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(store.query()).toBe('wp');
    store.perform('');
    expect(store.query()).toBe('');
    expect(store.cursor()).toBe(0);
    expect(store.matchCount()).toBe(0);
  });

  it('moves the cursor over the reported match count, wrapping both ways', () => {
    const store = createSearchStore();
    store.setMatchCount(3);
    store.advance(1);
    expect(store.cursor()).toBe(1);
    store.advance(1);
    store.advance(1);
    expect(store.cursor()).toBe(0); // wrapped forward at the end
    store.advance(-1);
    expect(store.cursor()).toBe(2); // wrapped backward at the start
  });

  it('ignores the advance without a match set', () => {
    const store = createSearchStore();
    store.advance(1);
    store.advance(-1);
    expect(store.cursor()).toBe(0);
  });

  it('clamps junk match counts to zero', () => {
    const store = createSearchStore();
    store.setMatchCount(-3);
    expect(store.matchCount()).toBe(0);
    store.setMatchCount(Number.NaN);
    expect(store.matchCount()).toBe(0);
    store.setMatchCount(4);
    expect(store.matchCount()).toBe(4);
  });
});

describe('moveCursor (pure cursor math)', () => {
  it('wraps forward past the end and backward past the start', () => {
    expect(moveCursor(2, 3, 1)).toBe(0);
    expect(moveCursor(0, 3, -1)).toBe(2);
    expect(moveCursor(0, 3, 1)).toBe(1);
  });

  it('is a no-op without matches', () => {
    expect(moveCursor(0, 0, 1)).toBe(0);
    expect(moveCursor(4, 0, -1)).toBe(4);
  });

  it('snaps a stale out-of-range cursor to the step-end it enters', () => {
    expect(moveCursor(9, 4, 1)).toBe(0);
    expect(moveCursor(9, 4, -1)).toBe(3);
  });

  it('treats a non-finite cursor as the same recovery case (the NaN guard)', () => {
    // A cursor corrupted to NaN must not poison the wrap arithmetic: the
    // non-integer arm catches it and recovers, both directions.
    expect(moveCursor(Number.NaN, 3, 1)).toBe(0);
    expect(moveCursor(Number.NaN, 3, -1)).toBe(2);
    expect(moveCursor(Number.POSITIVE_INFINITY, 3, 1)).toBe(0);
    expect(moveCursor(1.5, 3, 1)).toBe(0);
  });
});
