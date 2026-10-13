/**
 * The panel's search store: the single home of the devtools find-in-panel
 * state (`panelSearch` streams here; pages read, they never touch messaging).
 *
 * UX-D4: typed input streams in and commits on a 250 ms quiet period (an
 * intentional delta from the source's 400 ms — snappier first filter; logged
 * delta per the master plan's enhancement-delta rule), Escape clears
 * immediately (the source's Esc was a no-op), and a route change resets.
 * Matches are navigated via a cursor over a count the consuming page
 * reports; the cursor math is pure so wrap/edge behavior is pinned.
 */
import { createSignal, type Accessor } from 'solid-js';
import { debounce } from '../../../utils/debounce';

/** The quiet period before a typed query commits to the store. */
export const SEARCH_DEBOUNCE_MS = 250;

/** One match-navigation step's direction. */
export type SearchDirection = 1 | -1;

/**
 * Move the match cursor one step, wrapping over the match set.
 *
 * No matches (`count <= 0`) changes nothing; a cursor outside the set snaps
 * to the end the first step would enter (position recovery after the match
 * set changed size under a stale cursor). The math is total — no `NaN` or
 * out-of-range cursor can leave this function alive.
 *
 * @param cursor The current cursor (`[0, count)`).
 * @param count The match set's size, as the consuming page reports it.
 * @param delta The step direction: `1` = next, `-1` = previous.
 * @returns The wrapped cursor after the step.
 */
export function moveCursor(cursor: number, count: number, delta: SearchDirection): number {
  if (count <= 0) return cursor;
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= count) {
    return delta === 1 ? 0 : count - 1;
  }
  return (cursor + delta + count) % count;
}

/** The search state every panel consumer reads (pages, status bar, nav). */
export interface SearchStore {
  /** The committed query — last input that survived the quiet period. */
  readonly query: Accessor<string>;
  /** The match cursor the page pairs with `matchCount` for next/prev. */
  readonly cursor: Accessor<number>;
  /** The match set's size; pages report it, the store only carries it. */
  readonly matchCount: Accessor<number>;
  /**
   * Stream one `performSearch` delivery: commits after the quiet period,
   * resets the cursor, and an empty delivery clears immediately.
   */
  perform(rawQuery: string): void;
  /** Clear query, cursor and count now — and drop the pending commit. */
  cancel(): void;
  /** Move the match cursor one step (no-op without matches). */
  advance(delta: SearchDirection): void;
  /** Give the store the match set's size (validated; junk → 0). */
  setMatchCount(count: number): void;
}

/**
 * Create the store. One per panel run; the data layer feeds `perform` /
 * `cancel` / `advance` from the `panelSearch` relay.
 *
 * @returns The store handle with typed accessors for the consumers.
 */
export function createSearchStore(): SearchStore {
  const [query, setQuery] = createSignal<string>('');
  const [cursor, setCursor] = createSignal<number>(0);
  const [matchCount, setMatchCount] = createSignal<number>(0);

  // The shared debounce util owns the trailing semantics (last call wins,
  // `cancel` drops a pending run) — the store only owns the state changes.
  const commit = debounce((raw: string): void => {
    setQuery(raw);
    // A new query invalidates the previous position; reading starts at the
    // first match again.
    setCursor(0);
  }, SEARCH_DEBOUNCE_MS);

  /** `cancel`-level clear: everything back to the empty state, now. */
  const clear = (): void => {
    commit.cancel();
    setQuery('');
    setCursor(0);
    setMatchCount(0);
  };

  return {
    query,
    cursor,
    matchCount,
    perform(rawQuery) {
      if (rawQuery === '') {
        // An emptied find bar carries the same intent as Escape: clear now
        // (a pending burst must not resurrect the just-cleared text).
        clear();
        return;
      }
      commit(rawQuery);
    },
    cancel: clear,
    advance(delta) {
      setCursor((current) => moveCursor(current, matchCount(), delta));
    },
    setMatchCount(count) {
      setMatchCount(Number.isInteger(count) && count >= 0 ? count : 0);
    }
  };
}
