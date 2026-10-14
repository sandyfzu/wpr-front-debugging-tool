/**
 * The panel's data layer: the store singleton the shell and every page
 * consume. Pages never touch messaging — this factory owns the request
 * flight, the push subscriptions, the search-relay intake and the reload
 * flow, and exposes typed state over Solid signals.
 *
 * Mount discipline: every message receiver registers at `start()` — before
 * the first fetch resolves and never inside the data promise — so search
 * actions and push notifications that arrive early land in state instead of
 * vanishing in a promise chain, and `cancelSearch` clears for real.
 *
 * Tab scoping: the push channels carry the sender's tab id; a delivery from
 * any tab but the inspected one is ignored at debug level, so a second open
 * devtools window cannot act on this panel's state (or reload it). Relay
 * search actions carry the relaying devtools page's inspected tab instead
 * (an extension send has no runtime sender tab) and are scoped identically.
 *
 * Push buffering: both push channels stream from one-shot page events, so a
 * delivery may land while no data is loaded (boot fetch in the air, an error
 * window) — those payloads are held per channel (last one wins; each push
 * carries the channel's full state) and drain onto the store the first time
 * a flight settles to a loaded state, in both arms of a refresh too.
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import { parseFdtDataExplained } from '../../../lib/messaging/validate';
import { isNoReceiverError } from '../../../lib/messaging/no-receiver';
import { numericTabId } from '../../../lib/messaging/sender';
import { createLogger } from '../../../lib/logger';
import type { FdtData, PanelSearchAction } from '../../../lib/wp-rocket/types';
import { PANEL_SEARCH_ACTIONS } from '../../../lib/wp-rocket/types';
import type { PanelReceivers } from './edges';
import type { HardReloadBudget } from './hard-reload-budget';
import { transitionDataState, type DataState, type FetchOutcome } from './fdt-state-machine';
import type { SearchStore } from './search';

const log = createLogger('panel');

/** Which of the machine's two request triggers a flight runs for. */
type FlightKind = 'fetch' | 'refresh';

export interface FdtDataDeps {
  /**
   * The devtools-inspected tab accessor: the request target and the id the
   * push channels' tab scoping compares senders against. Null ⇒ there is
   * nothing to request from.
   */
  inspectedTabId: () => number | null;
  /** One request flight: ask the content script for the full page data. */
  request: (tabId: number | undefined) => Promise<unknown>;
  /** Register the receivers at mount; returns the stop handle for unload. */
  receive: (receivers: PanelReceivers) => () => void;
  /** The search store the `panelSearch` relay drives. */
  search: SearchStore;
  /** The full-reload fallback (production: `window.location.reload()`). */
  reload: () => void;
  /**
   * Gates the full-reload fallback to once per contract-failure streak,
   * across the reload itself (production: session-storage backed). Without
   * it, a payload that keeps failing reloads the panel forever.
   */
  hardReloadBudget: HardReloadBudget;
  /** The wall clock for the freshness stamps. */
  now: () => number;
}

/** What the shell and the pages read once this store exists. */
export interface FdtDataStore {
  /** The machine state (fetching / ready / refreshing / error / idle). */
  readonly state: Accessor<DataState>;
  /**
   * Boot: register every receiver, then run the first fetch — in that order,
   * and the fetch never gates the receivers. Idempotent.
   */
  start(): void;
  /** Stop: unregister the receivers (the shell's unload / tests). */
  stop(): void;
  /** The error view's retry control: a fresh 'fetch' flight. */
  retry(): void;
  /**
   * The user-driven reload control (e.g. the command palette's reload
   * action): a 'refresh' flight. The machine decides what that means per
   * state — a soft refresh carrying live data under `ready`, auto-recovery
   * under `error`, and plain fetching from `idle` — so the control is the
   * same one the in-tab notification drives, deduped identically.
   */
  reload(): void;
}

/** The user-facing cause the error view renders for a dropped no-receiver ask. */
const NO_RECEIVER_CAUSE =
  'The inspected page has no data source reachable. Open a page this tool supports (http/https), let it finish loading, or reload it — then retry.';

/** The cause for a request that failed in transit (or its own side). */
const REQUEST_FAILURE_CAUSE = 'The page could not be reached for its data.';

/** The cause when the content script answered `null` (its processing failed). */
const EMPTY_RESPONSE_CAUSE = 'The page produced no data — its content script could not process it.';

/** The cause of a contract-violating payload (hard-reload fallback). */
const CONTRACT_FAILURE_CAUSE =
  'The page data did not pass its integrity checks, so it cannot be trusted. Reload the inspected page, then retry; if it keeps failing, report the page URL.';

/**
 * Create the store (once per panel run; the shell wires the real edges).
 *
 * @param deps The edge injection — every browser-provided piece is a
 *   function here, which keeps the whole layer runnable in unit tests.
 */
export function createFdtDataStore(deps: FdtDataDeps): FdtDataStore {
  const [state, setState] = createSignal<DataState>({ status: 'idle' });

  /** Receivers' stop handle (armed in `start`). */
  let stopReceivers: (() => void) | null = null;

  /**
   * Where the latest rejected payload broke its contract (field path, never
   * a value) — the context the fallback's logs carry.
   */
  let rejectedAt = '';

  /**
   * Apply one machine event. A transition the table declines (same object
   * back) is a no-op: no state write, no side effect — most importantly the
   * hard-reload fallback cannot re-fire for a settled event the machine
   * ignored. Otherwise the only side effects beyond `setState` are the thin
   * fallback effect honoring the error state's `hardReload` marker — at most
   * once per failure streak, gated by the budget that outlives the reload
   * (the reloaded panel would receive the same payload) — and re-arming that
   * budget once a payload validates.
   */
  const applyEvent = (event: Parameters<typeof transitionDataState>[1]): void => {
    const before = state();
    const next = transitionDataState(before, event, deps.now());
    if (next === before) return;
    setState(next);
    if (next.status === 'ready') {
      deps.hardReloadBudget.reset();
      return;
    }
    if (next.status === 'error' && next.hardReload) {
      if (deps.hardReloadBudget.claim()) {
        log.error('Panel data failed its contract validation — falling back to a full reload.', {
          path: rejectedAt
        });
        deps.reload();
        return;
      }
      // The streak's reload is spent (or unrememberable): the error view with
      // its retry is the terminal state — reloading again would loop.
      log.error(
        'Panel data failed its contract validation again — showing the error state instead of reloading.',
        { path: rejectedAt }
      );
    }
  };

  /** Event-shaped settled outcome for a received response, classified. */
  const outcomeForResponse = (raw: unknown): FetchOutcome => {
    const parsed = parseFdtDataExplained(raw);
    if (parsed.ok) return { ok: true, data: parsed.data };
    if (raw === null) {
      // The content script's documented "nothing was captured/produced" —
      // its processing failed. A retry can recover a later page state, so
      // this is an error branch, never the corrupt-data reload.
      return { ok: false, cause: EMPTY_RESPONSE_CAUSE, hardReload: false };
    }
    // A non-null response that broke the validator: the payload is not the
    // content script's shape — flag the hard-reload fallback instead of
    // trusting it into a corrupt `ready`.
    rejectedAt = parsed.path;
    return { ok: false, cause: CONTRACT_FAILURE_CAUSE, hardReload: true };
  };

  /** Event-shaped settled outcome for a caught request failure. */
  const outcomeForFailure = (cause: unknown): FetchOutcome => {
    if (isNoReceiverError(cause)) {
      // Expected case (content script not injected yet, navigation, reload):
      // no warn needed — the retry affordance is the recovery.
      return { ok: false, cause: NO_RECEIVER_CAUSE, hardReload: false };
    }
    log.warn('Page-data request failed', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return { ok: false, cause: REQUEST_FAILURE_CAUSE, hardReload: false };
  };

  // — Push + relay handlers (registered at start, ahead of any fetch) ——

  /**
   * Tab-scope a push: the sender's tab id must equal the inspected one.
   * A push without a usable sender id is as foreign as a *different* id —
   * both are dropped rather than trusted.
   */
  const foreignPush = (senderTabId: number | null): boolean => {
    const inspected = deps.inspectedTabId();
    if (senderTabId === null || inspected === null || senderTabId !== inspected) {
      log.debug('Push dropped — it came from another tab than the inspected one', {
        senderTabId,
        inspectedTabId: inspected
      });
      return true;
    }
    return false;
  };

  /**
   * The latest push each channel delivered while nothing was loaded (idle /
   * fetching / error): held last-wins and drained onto the store at the next
   * loaded settle. Both push channels carry the channel's full state, so the
   * latest delivery is always the correct one to apply.
   */
  interface BufferedPatches {
    /** Latest `allScriptsLoaded` push (absent = none arrived since the last drain). */
    allScriptsLoaded?: boolean;
    /** Latest `undefinedReferencesUpdated` word list (absent = none arrived). */
    undefinedReferences?: string[];
  }
  let bufferedPatches: BufferedPatches = {};

  /**
   * One validated push delivery: patch it into a loaded state now, or hold
   * it in the per-channel buffer. Pushes stream from one-shot page events
   * (`allScriptsLoaded` from the page's load event, the word list from its
   * error batches), so delivery order vs. the request flight's reply is not
   * guaranteed — a push landing before or during the fetch that carries the
   * same field itself would otherwise be lost for that page load.
   *
   * @param loadingPatch The field patch to apply onto a loaded state.
   * @param buffered The channel's payload as it goes to the buffer.
   */
  const absorbPush = (
    loadingPatch: (data: FdtData) => FdtData,
    buffered: BufferedPatches
  ): void => {
    const current = state();
    if (current.status === 'ready' || current.status === 'refreshing') {
      setState({ ...current, data: loadingPatch(current.data) });
      return;
    }
    bufferedPatches = { ...bufferedPatches, ...buffered };
  };

  /**
   * Drain the push buffer onto whatever loaded state a settle just landed
   * (the boot fetch or a refresh's own settle — both arms drain). Route
   * through the same loaded-state check as live arrivals, so a payload can
   * only ever land on `ready`/`refreshing` data: a settle that errored keeps
   * the buffer armed for the next loaded settle. The buffer resets as the
   * drain applies, so a drained payload is not re-applied at a later settle.
   */
  const drainBufferedPatches = (): void => {
    const current = state();
    if (current.status !== 'ready' && current.status !== 'refreshing') return;
    const pending = bufferedPatches;
    bufferedPatches = {};
    let data = current.data;
    if (pending.allScriptsLoaded !== undefined) {
      data = { ...data, allScriptsLoaded: pending.allScriptsLoaded };
    }
    if (pending.undefinedReferences !== undefined) {
      data = { ...data, undefinedReferencesOnPage: pending.undefinedReferences };
    }
    if (data !== current.data) setState({ ...current, data });
  };

  /**
   * Run one request flight (boot fetch / retry / soft refresh). The trigger
   * applies through the machine's table; an event the machine declines (a
   * state where it does not apply — including a second trigger while one
   * flight runs, whose settle will carry the content script's current data
   * anyway) launches nothing: the driver never outruns its own table. When a
   * settle lands on a loaded state, the push buffer drains onto it (both the
   * first load and every refresh — see the header's buffering note).
   */
  const runFlight = (kind: FlightKind): void => {
    const before = state();
    applyEvent({ type: kind });
    if (state() === before) return;
    const tabId = deps.inspectedTabId() ?? undefined;
    deps
      .request(tabId)
      .then((raw) => {
        applyEvent({ type: 'settled', outcome: outcomeForResponse(raw) });
        drainBufferedPatches();
      })
      .catch((cause: unknown) => {
        applyEvent({ type: 'settled', outcome: outcomeForFailure(cause) });
        drainBufferedPatches();
      });
  };

  /**
   * Tab-scope a relayed search action: its payload carries the relaying
   * devtools page's inspected tab (an extension send has no runtime sender
   * tab to check — the protocol row's documented exception), so a delivery
   * whose id is not this panel's inspected tab belongs to another devtools
   * window and is dropped at warn — as is an id that fails the shared tab-id
   * guard (the boundary re-validated it; a store-delivered payload has not).
   */
  const foreignSearch = (actionTabId: number): boolean => {
    const inspected = deps.inspectedTabId();
    if (numericTabId(actionTabId) === null) {
      log.warn('Search action dropped — its relay tab id is malformed', {
        actionTabId,
        inspectedTabId: inspected
      });
      return true;
    }
    if (inspected === null || actionTabId !== inspected) {
      log.warn('Search action dropped — it came from another devtools window than this panel', {
        actionTabId,
        inspectedTabId: inspected
      });
      return true;
    }
    return false;
  };

  const receivers: PanelReceivers = {
    onPanelSearch(payload: PanelSearchAction): void {
      if (foreignSearch(payload.tabId)) return;
      switch (payload.action) {
        case PANEL_SEARCH_ACTIONS.performSearch:
          deps.search.perform(payload.query);
          return;
        case PANEL_SEARCH_ACTIONS.cancelSearch:
          deps.search.cancel();
          return;
        case PANEL_SEARCH_ACTIONS.nextSearchResult:
          deps.search.advance(1);
          return;
        case PANEL_SEARCH_ACTIONS.previousSearchResult:
          deps.search.advance(-1);
          return;
      }
    },
    onAllScriptsLoaded(loaded: boolean, senderTabId: number | null): void {
      if (foreignPush(senderTabId)) return;
      absorbPush((data) => ({ ...data, allScriptsLoaded: loaded }), { allScriptsLoaded: loaded });
    },
    onUndefinedReferences(words: string[], senderTabId: number | null): void {
      if (foreignPush(senderTabId)) return;
      absorbPush((data) => ({ ...data, undefinedReferencesOnPage: words }), {
        undefinedReferences: words
      });
    },
    onPanelReload(senderTabId: number | null): void {
      if (foreignPush(senderTabId)) return;
      runFlight('refresh');
    }
  };

  return {
    state,
    start() {
      if (stopReceivers !== null) return;
      // The whole receive wiring lands here — the search relay (whose early
      // deliveries must not depend on any fetch) and the three push
      // channels — strictly before the flight below (see the header's mount
      // discipline).
      stopReceivers = deps.receive(receivers);
      runFlight('fetch');
    },
    stop() {
      stopReceivers?.();
      stopReceivers = null;
      // A stopped store holds no pending pushes: its next lifecycle buffers
      // only what its own windows deliver.
      bufferedPatches = {};
    },
    retry() {
      runFlight('fetch');
    },
    reload() {
      runFlight('refresh');
    }
  };
}

/**
 * The data store's context: pages consume the panel's data through
 * `useFdtData()` — the typed store — and never touch messaging themselves.
 * The shell provides; everything below reads.
 */
export const FdtDataContext = createContext<FdtDataStore>();

/**
 * The provisioned data store inside the shell's component tree.
 *
 * @returns The data store the shell created.
 * @throws {@link Error} outside the panel shell (a misuse, never a data
 *   condition — fail loud so the wiring error is found immediately).
 */
export function useFdtData(): FdtDataStore {
  const store = useContext(FdtDataContext);
  if (store === undefined) {
    throw new Error('useFdtData() ran outside the panel shell.');
  }
  return store;
}

/**
 * The search store's context: same rule as the data store's — the shell
 * provides, pages read the streaming query state, nobody else touches
 * messaging.
 */
export const SearchContext = createContext<SearchStore>();

/**
 * The provisioned search store inside the shell's component tree.
 *
 * @returns The search store the shell created.
 * @throws {@link Error} outside the panel shell.
 */
export function useSearch(): SearchStore {
  const store = useContext(SearchContext);
  if (store === undefined) {
    throw new Error('useSearch() ran outside the panel shell.');
  }
  return store;
}
