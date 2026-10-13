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
 * devtools window cannot act on this panel's state (or reload it).
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import { parseFdtData } from '../../../lib/messaging/validate';
import { isNoReceiverError } from '../../../lib/messaging/no-receiver';
import { createLogger } from '../../../lib/logger';
import type { FdtData, PanelSearchAction } from '../../../lib/wp-rocket/types';
import { PANEL_SEARCH_ACTIONS } from '../../../lib/wp-rocket/types';
import type { PanelReceivers } from './edges';
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
  /** The wall clock for the freshness stamps. */
  now: () => number;
}

/** What the shell and the pages read once this store exists. */
export interface FdtDataStore {
  /** The machine state (fetching / ready / refreshing / error / idle). */
  readonly state: Accessor<DataState>;
  /**
   * Boot: register every receiver, then run the first fetch — in that
   * order, and the fetch never gates the receivers (#32). Idempotent.
   */
  start(): void;
  /** Stop: unregister the receivers (the shell's unload / tests). */
  stop(): void;
  /** The error view's retry control: a fresh 'fetch' flight. */
  retry(): void;
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
  'The page data did not pass its integrity checks, so it cannot be trusted.';

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
   * Apply one machine event. The transition table owns the shape; the only
   * side effect beyond `setState` is the hard-reload fallback — the thin
   * effect honoring the error state's `hardReload` marker.
   */
  const applyEvent = (event: Parameters<typeof transitionDataState>[1]): void => {
    const next = transitionDataState(state(), event, deps.now());
    setState(next);
    if (next.status === 'error' && next.hardReload) {
      log.error('Panel data failed its contract validation — falling back to a full reload.');
      deps.reload();
    }
  };

  /** Event-shaped settled outcome for a received response, classified. */
  const outcomeForResponse = (raw: unknown): FetchOutcome => {
    const parsed = parseFdtData(raw);
    if (parsed !== null) return { ok: true, data: parsed };
    if (raw === null) {
      // The content script's documented "nothing was captured/produced" —
      // its processing failed. A retry can recover a later page state, so
      // this is an error branch, never the corrupt-data reload.
      return { ok: false, cause: EMPTY_RESPONSE_CAUSE, hardReload: false };
    }
    // A non-null response that broke the validator: the payload is not the
    // content script's shape — flag the hard-reload fallback instead of
    // trusting it into a corrupt `ready`.
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
   * Granular push apply: swap exactly one field of the carried data. A push
   * never refetches; it reaches the loaded states only (`ready`, and the
   * `refreshing` state whose carried data the in-flight batch will replace).
   * The word list rides the protocol's own wholesale semantics — every
   * `undefinedReferencesUpdated` push carries the content script's complete
   * accumulated list, so a plain replace cannot lose entries.
   */
  const applyDataPatch = (patch: (data: FdtData) => FdtData): void => {
    setState((current) =>
      current.status === 'ready' || current.status === 'refreshing'
        ? { ...current, data: patch(current.data) }
        : current
    );
  };

  /**
   * Run one request flight (boot fetch / retry / soft refresh). The trigger
   * applies through the machine's table; an event the machine declines (a
   * state where it does not apply — including a second trigger while one
   * flight runs, whose settle will carry the content script's current data
   * anyway) launches nothing: the driver never outruns its own table.
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
      })
      .catch((cause: unknown) => {
        applyEvent({ type: 'settled', outcome: outcomeForFailure(cause) });
      });
  };

  const receivers: PanelReceivers = {
    onPanelSearch(payload: PanelSearchAction): void {
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
      applyDataPatch((data) => ({ ...data, allScriptsLoaded: loaded }));
    },
    onUndefinedReferences(words: string[], senderTabId: number | null): void {
      if (foreignPush(senderTabId)) return;
      applyDataPatch((data) => ({ ...data, undefinedReferencesOnPage: words }));
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
    },
    retry() {
      runFlight('fetch');
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
