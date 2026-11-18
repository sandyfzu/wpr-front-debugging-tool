/**
 * Whether the current page shows a list detail view — a shell-session fact:
 * a page's master–detail list publishes it, the shell chrome reads it (the
 * nav folds while a detail is open), so neither side imports the other.
 *
 * The answer belongs to the route that published it: a route change reads
 * `false` at once (a fresh page has no detail open until it says so), and
 * the stale record is dropped once the switch settles — so returning to the
 * old route never resurrects its closed detail. Never persisted.
 */
import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  untrack,
  useContext,
  type Accessor
} from 'solid-js';
import type { RouteId } from '../routes';

/** The session's detail-presence state. */
export interface DetailPresenceStore {
  /** True while the current route's page shows a detail view. */
  readonly detailOpen: Accessor<boolean>;
  /**
   * Publish the current page's detail state, recorded against the route
   * current at the call. Publishers write only while mounted (and write
   * `false` on cleanup): a write after unmount would land on the next route.
   */
  setDetailOpen(open: boolean): void;
}

/**
 * Create a detail-presence store over the shell's route.
 *
 * Keying the record by route (rather than resetting a plain boolean in an
 * effect) makes the reset order-proof: a new page may publish during its own
 * mount, before any route-change effect runs, and that write is never
 * clobbered. Must run under a reactive owner (the shell body, or a test
 * root): its memo and cleanup effect live as long as that owner.
 *
 * @param route The shell router's current route.
 * @returns A store starting closed (`detailOpen() === false`).
 */
export function createDetailPresence(route: Accessor<RouteId>): DetailPresenceStore {
  // The route whose page has a detail open; null = none.
  const [openOn, setOpenOn] = createSignal<RouteId | null>(null);
  const detailOpen = createMemo(() => openOn() === route());
  // Drop a record the route left behind, keeping one the new page already
  // published. Deferred: the boot route has nothing to drop. `on` runs its
  // callback untracked, so reading `openOn` here subscribes nothing.
  createEffect(
    on(
      route,
      (current) => {
        if (openOn() !== current) setOpenOn(null);
      },
      { defer: true }
    )
  );
  return {
    detailOpen,
    setDetailOpen: (open) => {
      // Untracked: a publisher calling from inside its own effect must not
      // subscribe that effect to the route.
      setOpenOn(open ? untrack(route) : null);
    }
  };
}

/** The shell-provided detail-presence store (absent outside the panel shell). */
export const DetailPresenceContext = createContext<DetailPresenceStore>();

/**
 * The provisioned detail-presence store inside the shell's component tree.
 *
 * @returns The store the shell created.
 * @throws {@link Error} outside the panel shell (a wiring bug: a published
 *   detail would never reach the chrome that folds on it).
 */
export function useDetailPresence(): DetailPresenceStore {
  const store = useContext(DetailPresenceContext);
  if (store === undefined) {
    throw new Error('useDetailPresence() ran outside the panel shell.');
  }
  return store;
}
