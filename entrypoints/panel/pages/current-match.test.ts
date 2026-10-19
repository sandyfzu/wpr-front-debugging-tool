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

/**
 * Mount the seam in one root and hand everything back. An optional table
 * makes the seam's subset form (matches scattered among scaffold rows).
 */
interface MountedSeam {
  readonly search: SearchStore;
  readonly match: CurrentMatch;
  readonly setRows: (count: number) => void;
  readonly setTable: ((table: readonly number[]) => void) | undefined;
  readonly dispose: () => void;
}

function mountSeam(initialRows: number, initialTable?: readonly number[]): MountedSeam {
  const search = createSearchStore();
  let match: CurrentMatch | undefined;
  let setRows: (count: number) => void = () => {};
  let setTable: ((table: readonly number[]) => void) | undefined;
  let dispose = (): void => {};
  createRoot((d) => {
    dispose = d;
    const [rows, setSize] = createSignal(initialRows);
    setRows = setSize;
    if (initialTable === undefined) {
      match = createCurrentMatch(search, () => rows());
    } else {
      const [table, setTableSignal] = createSignal(initialTable);
      setTable = setTableSignal;
      match = createCurrentMatch(search, () => rows(), table);
    }
  });
  return { search, match: match as CurrentMatch, setRows, setTable, dispose };
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

    // A successor page reports a DIFFERENT count next while the outgoing
    // owner is still mounted, then the outgoing owner is disposed — the
    // reverse of the real route-swap flush (where the cleanup runs first
    // and the successor's report effect queues behind it). With unequal
    // counts the outcome is order-insensitive: whatever the flush does, the
    // disposed page never erases the successor's claim (the guard's
    // equality read fails against a foreign count). The one ordering that
    // would erase — EQUAL counts under this reversed flush — is the
    // documented boundary the next test pins.
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

  it('the standing assumption’s boundary: an equal-count successor, flushed reversed, is erased', () => {
    vi.useFakeTimers();
    const search = createSearchStore();
    search.perform('img');
    settleFind();

    let disposeOutgoing = (): void => {};
    createRoot((d) => {
      disposeOutgoing = d;
      createCurrentMatch(search, () => 4);
    });
    expect(search.matchCount()).toBe(4);

    // The one ordering the guard cannot survive: an EQUAL-count successor
    // reports while the outgoing owner is still mounted, then the outgoing
    // owner disposes LAST — the guard reads its own count (4 === 4) and
    // clears, dropping the store's count to 0 while the successor is still
    // mounted. Production can never produce it (a successor's first report
    // effect queues behind the outgoing cleanup — the seam's documented
    // standing assumption), so this pin records the boundary honestly, not
    // a bug; an ownership token is the future fix should a flow ever
    // reverse the order.
    let disposeSuccessor = (): void => {};
    createRoot((d) => {
      disposeSuccessor = d;
      createCurrentMatch(search, () => 4);
    });
    expect(search.matchCount()).toBe(4);
    disposeOutgoing();
    expect(search.matchCount()).toBe(0); // the documented erasure boundary

    disposeSuccessor();
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

describe('createCurrentMatch — the subset table (matches among scaffold rows)', () => {
  it('the cursor walks the table: the marker and the scroll land on the mapped row', () => {
    vi.useFakeTimers();
    // Three matches rendered at list positions 1, 4, 6 (scaffold between).
    const { search, match, setTable } = mountSeam(3, [1, 4, 6]);
    if (setTable === undefined) throw new Error('the table seam did not mount');
    search.perform('img');
    settleFind();
    expect(search.matchCount()).toBe(3);
    expect(match.current()).toBe(1);
    expect(match.request()).toEqual({ index: 1 });

    search.advance(1);
    expect(match.current()).toBe(4);
    expect(match.request()).toEqual({ index: 4 });
    search.advance(1);
    expect(match.current()).toBe(6);
    // Forward wrap lands back on the first match's rendered row; backward
    // from it wraps to the last again.
    search.advance(1);
    expect(match.current()).toBe(1);
    search.advance(-1);
    expect(match.current()).toBe(6);

    // A reshaped list re-derives the marker through the table (a refresh),
    // and a reshape is geometry, not a find event: the request object keeps
    // its identity — the list never scrolls for it.
    const atRow6 = match.request();
    setTable([2, 5, 8]);
    expect(match.current()).toBe(8);
    expect(match.request()).toBe(atRow6);
  });

  it('a shorter table is the smaller set: the count follows it and the stale cursor names no row', () => {
    vi.useFakeTimers();
    // Rewritten to the derived semantics: with a table present the table's
    // length IS the match set, so a count/table mismatch is impossible by
    // construction and the former mismatch scenario cannot exist — the
    // honest form of this test is "the report follows the table".
    const { search, match, setTable } = mountSeam(2, [3, 7]);
    if (setTable === undefined) throw new Error('the table seam did not mount');
    search.perform('img');
    settleFind();
    search.advance(1); // cursor 1 → rendered row 7
    expect(match.current()).toBe(7);
    const atRow7 = match.request();

    // The list reshapes shorter (a refresh dropping a match): the count
    // follows the table, and the stale cursor falls outside the smaller
    // set — no row is named. The reshape is geometry, not a find event:
    // the request keeps its identity (the list never scrolls for it).
    setTable([3]);
    expect(search.matchCount()).toBe(1);
    expect(match.current()).toBeNull();
    expect(match.request()).toBe(atRow7);

    // The next find event recovers: the wrap math snaps the stale cursor
    // into the smaller set and the scroll re-fires at the mapped row.
    search.advance(1);
    expect(match.current()).toBe(3);
    expect(match.request()).toEqual({ index: 3 });
    expect(match.request()).not.toBe(atRow7);

    // Blank/whitespace: nothing reported, nothing named, no request.
    search.cancel();
    expect(search.matchCount()).toBe(0);
    expect(match.current()).toBeNull();
    expect(match.request()).toBeNull();
  });
});
