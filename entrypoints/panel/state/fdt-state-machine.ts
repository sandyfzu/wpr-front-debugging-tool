/**
 * The panel's data-state machine — the pure half of the data layer.
 *
 * States are one typed discriminated union (`idle / fetching / ready /
 * refreshing / error / unavailable` — never symbol-keyed). The events are the
 * shell's controls: `fetch` (the boot flow or the retry control), `refresh`
 * (the in-tab reload notification — this is the soft refresh, which refetches
 * in place rather than reloading the page), `settled` (the request outcome,
 * parsed and classified by the caller) and `unavailable` (this context cannot
 * message tabs at all — terminal: nothing a retry or a refresh could change).
 *
 * The transition table is total: every (state, event) pair has a defined
 * result, and every trigger that cannot apply resolves to the current state.
 *
 * Soft refresh: `refreshing` *retains* the previously loaded data so only the
 * data ever swaps — route, scroll position, focus and sub-state survive the
 * inspected page's navigation by construction. Hard-reload fallback: when a
 * request lands a payload that breaks its contract, the state carries the
 * `hardReload` marker and the store's thin fallback effect drives the reload
 * instead of trusting the payload into a corrupt `ready`.
 */
import type { FdtData } from '../../../lib/wp-rocket/types';

/**
 * The failure shape of one settled request: `hardReload` marks a payload
 * that failed contract validation (the corrupt-data fallback), while any
 * other failure explains itself via `cause` for the error view's retry.
 */
export type FetchOutcome =
  | { readonly ok: true; readonly data: FdtData }
  | { readonly ok: false; readonly cause: string; readonly hardReload: boolean };

/** What can happen to the data state. */
export type DataEvent =
  /** Boot flow, or the error view's retry control. */
  | { readonly type: 'fetch' }
  /** The in-tab reload notification (the soft-refresh trigger). */
  | { readonly type: 'refresh' }
  /** The in-flight request finished with a parsed-and-classified outcome. */
  | { readonly type: 'settled'; readonly outcome: FetchOutcome }
  /** This context has no way to message the page (feature-detected once). */
  | { readonly type: 'unavailable'; readonly reason: string };

/** The panel's data state as every surface reads it. */
export type DataState =
  /** Between boot and the first fetch (transient; the shell fetches at mount). */
  | { readonly status: 'idle' }
  /** A first fetch / retry is in flight; nothing to render yet. */
  | { readonly status: 'fetching' }
  /** Loaded, live data — updated granularly by the push messages. */
  | { readonly status: 'ready'; readonly data: FdtData; readonly fetchedAt: number }
  /** Soft refresh in flight — the previous data stays on screen until the swap. */
  | { readonly status: 'refreshing'; readonly data: FdtData; readonly requestedAt: number }
  /** The request failed (or the data broke its contract; `hardReload` flags that). */
  | { readonly status: 'error'; readonly cause: string; readonly hardReload: boolean }
  /** The context cannot reach the page at all (terminal; `reason` says why). */
  | { readonly status: 'unavailable'; readonly reason: string };

/**
 * The transition table — pure, total, and entirely testable without a DOM.
 *
 * Deduplication rules (the store's flights can race its own controls):
 * - a second trigger while one flight is running changes nothing — the
 *   in-flight request settles into fresh data anyway (the content script
 *   serves its current page state at response time);
 * - a `settled` outcome applies only onto a flight in the air — anything
 *   else is impossible bookkeeping and leaves the state unchanged.
 *
 * @param state The current data state.
 * @param event The trigger (with its outcome when it settles).
 * @param nowMs The event's wall-clock stamp, for the freshness fields.
 * @returns The next state (the same object when nothing changed).
 */
export function transitionDataState(state: DataState, event: DataEvent, nowMs: number): DataState {
  // Terminal: no fetch, refresh or late settle can make the page reachable.
  if (state.status === 'unavailable') return state;
  switch (event.type) {
    case 'unavailable':
      return { status: 'unavailable', reason: event.reason };
    case 'fetch': {
      // While a flight runs, the fetch is a no-op (dedup); from `ready` a
      // plain fetch trigger is not a control the shell exposes (it would
      // discard good data for no reason), and changing nothing is the safe
      // reading of it.
      if (state.status === 'fetching' || state.status === 'ready') return state;
      return { status: 'fetching' };
    }
    case 'refresh': {
      // While `ready`, this is the soft refresh's trigger: carry the current
      // data and stay visually live while the fresh batch is asked for. On
      // `error` the notification is auto-recovery: the content script just
      // demonstrated it is alive, so ask fresh.
      if (state.status === 'fetching' || state.status === 'refreshing') return state;
      if (state.status === 'ready') {
        return { status: 'refreshing', data: state.data, requestedAt: nowMs };
      }
      return { status: 'fetching' };
    }
    case 'settled': {
      // A settle applies only onto a flight in the air.
      const flying = state.status === 'fetching' || state.status === 'refreshing';
      if (!flying) return state;
      if (event.outcome.ok) {
        return { status: 'ready', data: event.outcome.data, fetchedAt: nowMs };
      }
      return {
        status: 'error',
        cause: event.outcome.cause,
        hardReload: event.outcome.hardReload
      };
    }
  }
}
