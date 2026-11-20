/**
 * One scroll-request signal for a list fed by two sources: the find's
 * request (a committed query, a next/previous step) and the list's own
 * (Back restoring the row, a keyboard move bringing the next row in). The
 * virtual list takes exactly one `scrollTo` accessor, so both merge here:
 * the latest event wins, and each event is a fresh object (the list scrolls
 * once per change, never for an unchanged request).
 */
import { createComputed, createSignal, on, untrack, type Accessor } from 'solid-js';
import type { VirtualScrollRequest } from '../../../../components/ui/virtual-list';

/** What {@link mergeScrollRequests} hands the list. */
export interface ScrollRequests {
  /** The merged request — pass as the virtual list's `scrollTo`. */
  readonly request: Accessor<VirtualScrollRequest | null>;
  /**
   * Ask the list to bring a row into view (instant, nearest edge — the
   * list's own geometry); a negative index (a row not in the list) asks nothing.
   *
   * @param index The row's index in the rendered list.
   */
  scrollTo(index: number): void;
}

/**
 * Merge the find's requests with the list's own. Must run inside a Solid
 * owner. The find's value at creation seeds the signal untouched (the list
 * itself ignores a request present at mount); every later find change —
 * `null` included, so clearing the find never replays an older scroll — and
 * every {@link ScrollRequests.scrollTo} replace it.
 *
 * @param find The find's scroll request.
 * @returns The merged request and the list's own scroll entry.
 */
export function mergeScrollRequests(find: Accessor<VirtualScrollRequest | null>): ScrollRequests {
  const [request, setRequest] = createSignal<VirtualScrollRequest | null>(untrack(find), {
    // Identity, not structure: a fresh request object is a new scroll order.
    equals: false
  });
  createComputed(
    on(
      find,
      (next) => {
        setRequest(next);
      },
      { defer: true }
    )
  );
  return {
    request,
    scrollTo(index) {
      if (index < 0) return;
      setRequest({ index });
    }
  };
}
