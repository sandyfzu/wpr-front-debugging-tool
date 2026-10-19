/**
 * The current-match seam's contract: the count report gated on a committed
 * query, the active-match highlight's honesty (a cursor the current set
 * doesn't reach names no row), the scroll-request re-fire rules (find events
 * re-fire per event even at the same row; list geometry changes never do),
 * and the dispose guard that clears only the page's own report.
 */
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SEARCH_DEBOUNCE_MS, createSearchStore, type SearchStore } from '../state/search';
import { createCurrentMatch, type CurrentMatch } from './current-match';

afterEach(() => {
  vi.useRealTimers();
});

/** The quiet period's settle shorthand. */
function settleFind(): void {
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
}

/** Mounts the seam over a set-size signal and hands everything back. */
interface MountedSeam {
  readonly search: SearchStore;
  readonly match: CurrentMatch;
  readonly setRows: (count: number) => void;
  readonly dispose: () => void;
}

/**
 * Mount the seam in one root and return after it: Solid flushes a root's
 * queued effects at its end, so the store-driving happens outside the body.
 */
function mountSeam(initialRows: number): MountedSeam {
  const search = createSearchStore();
  let match: CurrentMatch | undefined;
  let setRows: (count: number) => void = () => {};
  let dispose = (): void => {};
  createRoot((d) => {
    dispose = d;
    const [rows, setSize] = createSignal(initialRows);
    setRows = setSize;
    match = createCurrentMatch(search, () => rows());
  });
  return { search, match: match as CurrentMatch, setRows, dispose };
}

describe('createCurrentMatch — count report', () => {
  it('never reports a blank or whitespace query; a commit reports the set', () => {
    vi.useFakeTimers();
    const { search, match, setRows } = mountSeam(5);
    expect(match.current()).toBeNull();
    expect(search.matchCount()).toBe(0);

    search.perform('   '); // whitespace: commits later, still blank to pages
    settleFind();
    expect(search.matchCount()).toBe(0);

    search.perform('img');
    settleFind();
    expect(search.matchCount()).toBe(5);
    expect(match.current()).toBe(0);

    // A set-size change under the live query re-reports (a refresh's shrink).
    setRows(2);
    expect(search.matchCount()).toBe(2);
  });

  it('a page remounted under an active query re-reports its fresh set at once', () => {
    vi.useFakeTimers();
    const search = createSearchStore();
    let dispose = (): void => {};
    createRoot((d) => {
      createCurrentMatch(search, () => 4);
      dispose = d;
    });
    search.perform('img');
    settleFind();
    expect(search.matchCount()).toBe(4);

    // The retry/refresh lifecycle unmounts the page without a store reset.
    dispose();
    expect(search.matchCount()).toBe(0);

    let remountedCurrent: number | null = null;
    createRoot(() => {
      remountedCurrent = createCurrentMatch(search, () => 4).current();
    });
    expect(search.matchCount()).toBe(4);
    expect(remountedCurrent).toBe(0); // the store cursor survives and stays valid
  });

  it('dispose clears the page’s own report, never a newer page’s', () => {
    vi.useFakeTimers();
    const search = createSearchStore();
    search.perform('img');
    settleFind();

    let disposeOld = (): void => {};
    createRoot((d) => {
      disposeOld = d;
      createCurrentMatch(search, () => 4);
    });
    expect(search.matchCount()).toBe(4);

    // A successor page reports next while the outgoing owner is still
    // mounted, then the outgoing owner is disposed. This models the reverse
    // of the real route-swap flush (where the cleanup runs first and the
    // successor's report effect queues behind it): both orderings end at the
    // successor's count, so the pin is deliberately ordering-insensitive —
    // whatever the flush does, a disposed page must not erase it.
    let disposeNew = (): void => {};
    createRoot((d) => {
      disposeNew = d;
      createCurrentMatch(search, () => 6);
    });
    disposeOld();
    expect(search.matchCount()).toBe(6);

    disposeNew();
    expect(search.matchCount()).toBe(0);
  });
});

describe('createCurrentMatch — active match and scroll request', () => {
  it('derives the cursor’s row; no matches or an out-of-range cursor name none', () => {
    vi.useFakeTimers();
    const { search, match } = mountSeam(3);
    search.perform('img');
    settleFind();
    expect(match.current()).toBe(0);
    expect(match.request()).toEqual({ index: 0 });

    search.advance(1);
    expect(match.current()).toBe(1);
    expect(match.request()).toEqual({ index: 1 });

    // Forward wrap: last → first. Backward wrap: first → last.
    search.advance(-1);
    expect(match.current()).toBe(0);
    expect(match.request()).toEqual({ index: 0 });
    search.advance(-1);
    expect(match.current()).toBe(2);
    expect(match.request()).toEqual({ index: 2 });
    search.advance(1);
    expect(match.current()).toBe(0);
  });

  it('a find event re-fires the request at the same row; a geometry change never does', () => {
    vi.useFakeTimers();
    const { search, match, setRows } = mountSeam(3);
    search.perform('img');
    settleFind();
    const firstSelection = match.request();

    // A new query, same first row: a fresh request (a new selection).
    search.perform('url');
    settleFind();
    expect(match.request()).toEqual({ index: 0 });
    expect(match.request()).not.toBe(firstSelection);

    // A step also re-fires; the following shrink is geometry, not a find
    // event: no new request — while the highlight re-derives and hides an
    // out-of-range cursor.
    search.advance(1);
    const atRow1 = match.request();
    setRows(1);
    expect(match.current()).toBeNull(); // cursor 1 over a set of 1
    expect(match.request()).toBe(atRow1); // identity retained (no scroll order)

    // The next step recovers the position and re-fires the scroll.
    search.advance(1);
    expect(match.current()).toBe(0);
    expect(match.request()).toEqual({ index: 0 });
    expect(match.request()).not.toBe(atRow1);
  });

  it('an emptied set retains its request until the next event; cancel ends the find', () => {
    vi.useFakeTimers();
    const { search, match, setRows } = mountSeam(2);
    search.perform('img');
    settleFind();
    const selection = match.request();

    // Everything matching left the list (chip change, refresh, revision):
    // the highlight goes, the last request object is retained — a refetching
    // set (rows are back) resurrects the marker without any scroll order.
    setRows(0);
    expect(match.current()).toBeNull();
    expect(match.request()).toBe(selection);
    setRows(2);
    expect(match.current()).toBe(0);
    expect(match.request()).toBe(selection);

    search.cancel();
    expect(match.current()).toBeNull();
    expect(match.request()).toBeNull();
  });
});
