/**
 * Whether the current page shows a list detail view — a shell-session fact:
 * a page's master–detail lists publish it, the shell chrome reads it (the
 * nav folds while a detail is open), so neither side imports the other.
 *
 * Each publisher (one list) holds its own claim, so several lists on one page
 * never overwrite each other: the page shows a detail while any claim is open
 * on it, and a released claim takes only its own record away.
 *
 * A record belongs to the route it was published on: a route change reads
 * `false` at once (a fresh page has no detail open until it says so), and
 * stale records are dropped once the switch settles — so returning to the
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

/** One publisher's say in the presence (one master–detail list). */
export interface DetailPresenceClaim {
  /**
   * Publish this publisher's detail state, recorded against the route
   * current at the call. A repeat of the recorded state notifies nobody; a
   * call after {@link DetailPresenceClaim.release} is ignored (a write after
   * unmount would otherwise land on the next route).
   */
  set(open: boolean): void;
  /** Withdraw the claim for good — call it on the publisher's cleanup. Idempotent. */
  release(): void;
}

/** The session's detail-presence state. */
export interface DetailPresenceStore {
  /** True while any claim is open on the current route. */
  readonly detailOpen: Accessor<boolean>;
  /** A new claim, starting closed (one per publishing list). */
  claim(): DetailPresenceClaim;
}

/** Open claims only: claim id → the route it was opened on. */
type Records = ReadonlyMap<symbol, RouteId>;

/**
 * The records with one claim's entry set (`at`) or removed (`undefined`).
 *
 * @param records The current records.
 * @param id The claim.
 * @param at The route to record, or undefined to remove.
 * @returns The same map when nothing changes (so its signal stays quiet), else a copy.
 */
function withRecord(records: Records, id: symbol, at: RouteId | undefined): Records {
  if (records.get(id) === at) return records;
  const next = new Map(records);
  if (at === undefined) next.delete(id);
  else next.set(id, at);
  return next;
}

/**
 * The records kept on `route` (stale ones dropped).
 *
 * @param records The current records.
 * @param route The route switched to.
 * @returns The same map when nothing is stale, else a filtered copy.
 */
function keptOn(records: Records, route: RouteId): Records {
  const kept = [...records].filter(([, at]) => at === route);
  return kept.length === records.size ? records : new Map(kept);
}

/**
 * Create a detail-presence store over the shell's route.
 *
 * Keying records by route (rather than resetting a plain boolean in an
 * effect) makes the reset order-proof: a new page may publish during its own
 * mount, before any route-change effect runs, and that write is never
 * clobbered. Must run under a reactive owner (the shell body, or a test
 * root): its memo and cleanup effect live as long as that owner.
 *
 * @param route The shell router's current route.
 * @returns A store starting closed (`detailOpen() === false`).
 */
export function createDetailPresence(route: Accessor<RouteId>): DetailPresenceStore {
  const [records, setRecords] = createSignal<Records>(new Map());
  const detailOpen = createMemo(() => {
    const current = route();
    for (const at of records().values()) if (at === current) return true;
    return false;
  });
  // Drop records the route left behind, keeping those the new page already
  // published. Deferred: the boot route has nothing to drop. `on` runs its
  // callback untracked, so reading `records` here subscribes nothing.
  createEffect(
    on(
      route,
      (current) => {
        setRecords(keptOn(records(), current));
      },
      { defer: true }
    )
  );
  /**
   * Write one claim's record. Untracked: a publisher calling from inside its
   * own effect must not subscribe that effect to the route or the records.
   */
  const write = (id: symbol, open: boolean): void => {
    setRecords(withRecord(untrack(records), id, open ? untrack(route) : undefined));
  };
  return {
    detailOpen,
    claim() {
      const id = Symbol('detail-presence-claim');
      let released = false;
      return {
        set(open) {
          if (!released) write(id, open);
        },
        release() {
          write(id, false);
          released = true;
        }
      };
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
