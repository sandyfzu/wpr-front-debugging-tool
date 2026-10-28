/**
 * The panel's DevTools search relay: when the user searches inside the WPR
 * FDT panel, Chrome fires `panel.onSearch` on the devtools page, and every
 * action is relayed to the panel page as one typed `panelSearch` message
 * (the shell side consumes it from there — routes/pages never touch the
 * browser API). Feature-detected: a panel without `onSearch` gets no relay.
 */
import { sendMessage } from '../../lib/messaging/index';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import { numericTabId } from '../../lib/messaging/sender';
import { createLogger } from '../../lib/logger';
import { PANEL_SEARCH_ACTIONS } from '../../lib/wp-rocket/types';
import type { PanelSearchEventPayload } from '../../lib/wp-rocket/types';

const log = createLogger('devtools');

/**
 * Narrow one raw `onSearch` event to the protocol payload. Chrome reports
 * the action as a bare string and the query only on `performSearch`
 * (still tolerated absent — the query becomes an empty string, which the
 * boundary validator accepts); anything outside the exact four actions is
 * dropped here so an unexpected API value can never reach the panel. Pure
 * action mapping — the relay attaches the payload's tab id at send time.
 *
 * @param action The event's action string.
 * @param queryString The event's query string (`performSearch` only).
 * @returns The typed payload, or null for an unknown action.
 */
export function toPanelSearchPayload(
  action: string,
  queryString: string | undefined
): PanelSearchEventPayload | null {
  if (action === PANEL_SEARCH_ACTIONS.performSearch) {
    return { action, query: queryString ?? '' };
  }
  if (
    action === PANEL_SEARCH_ACTIONS.cancelSearch ||
    action === PANEL_SEARCH_ACTIONS.nextSearchResult ||
    action === PANEL_SEARCH_ACTIONS.previousSearchResult
  ) {
    return { action };
  }
  return null;
}

/** The registration shape of the panel's search-action event. */
interface SearchEvent {
  /** Registers the callback fired on perform/cancel/next/prev. */
  addListener: (callback: (action: string, queryString?: string) => void) => void;
}

/**
 * The part of a created panel the relay wiring touches: the dependency seam
 * is what the wiring reads, so tests inject panel doubles without carrying
 * the full API type. `onSearch` is `unknown` because not every browser's
 * DevTools panel has it (Firefox's `ExtensionPanel` lacks it) — it is
 * narrowed by {@link hasSearchEvent} before use.
 */
interface SearchEventSource {
  /** The panel's search-action event, when this browser provides one. */
  readonly onSearch?: unknown;
}

/** What {@link registerSearchRelay} came to. */
export type SearchRelayRegistration = 'registered' | 'unsupported';

/**
 * Whether the panel exposes a usable search event (an object with an
 * `addListener` function) — feature detection, never browser sniffing.
 *
 * @param panel The created panel.
 * @returns True when `panel.onSearch.addListener` is callable.
 */
function hasSearchEvent(
  panel: SearchEventSource
): panel is SearchEventSource & { readonly onSearch: SearchEvent } {
  const event = panel.onSearch;
  return (
    typeof event === 'object' &&
    event !== null &&
    typeof (event as { addListener?: unknown }).addListener === 'function'
  );
}

/**
 * The devtools page's inspected tab id, as the relay attaches it to every
 * `panelSearch` send. An extension send has no runtime sender tab, so this
 * payload field is the only scope the panel can check — without it two open
 * DevTools windows would drive each other's search stores. Reads
 * `browser.devtools` through a structurally narrowed namespace, feature-
 * detected like the runtime sender ids (the shared `numericTabId` guard), so
 * a non-DevTools registration yields null and the send is refused below
 * instead of broadcasting an unscoped action.
 */
function detectedRelayTabId(): number | null {
  const api = browser as unknown as {
    readonly devtools?: { readonly inspectedWindow?: { readonly tabId?: unknown } };
  };
  return numericTabId(api.devtools?.inspectedWindow?.tabId);
}

/**
 * Relay all four search actions (`performSearch`, `cancelSearch`,
 * `nextSearchResult`, `previousSearchResult`): DevTools only fires the
 * cancel/navigation events to a listener registered here, so registering
 * for all four and relaying each is what keeps the panel's find-in-page
 * protocol complete. Every send carries the relaying devtools page's
 * inspected tab id, so the receiving panel can scope deliveries to its own
 * window (the protocol row's documented tabId-payload exception).
 *
 * The send is failure-aware: until the panel page mounts its receiver (and
 * whenever it is reloading), the no-receiver rejection is the expected case
 * — logged at debug level so every dropped search is visible without ever
 * becoming an unhandled rejection. With no usable inspected tab the send is
 * refused entirely: an unscoped search can never be validated on arrival.
 *
 * Browsers whose panel has no search event (Firefox) get no relay: DevTools'
 * own search shortcut then never reaches the panel, whose in-page search
 * fields keep working. That is an expected capability gap, so it logs one
 * debug line per registration instead of throwing out of the devtools page.
 *
 * @param panel The created panel (its `onSearch` event, when present).
 * @param inspectedTabId The inspected-tab accessor the sends carry
 *   (tests inject; production reads the devtools context, feature-detected).
 * @returns `'registered'` when the listener was added, `'unsupported'` when
 *   the panel has no search event.
 */
export function registerSearchRelay(
  panel: SearchEventSource,
  inspectedTabId: () => number | null = detectedRelayTabId
): SearchRelayRegistration {
  if (!hasSearchEvent(panel)) {
    log.debug('DevTools panel search relay skipped — this browser has no panel onSearch event');
    return 'unsupported';
  }
  panel.onSearch.addListener((action, queryString) => {
    try {
      const payload = toPanelSearchPayload(action, queryString);
      if (payload === null) {
        log.warn('Ignored an unexpected DevTools search action', { action, queryString });
        return;
      }
      const tabId = inspectedTabId();
      if (tabId === null) {
        log.warn('Search relay has no inspected tab — action refused, it cannot be scoped', {
          action: payload.action
        });
        return;
      }
      sendMessage('panelSearch', { ...payload, tabId }).catch((cause: unknown) => {
        if (isNoReceiverError(cause)) {
          // Expected until the panel mounts its receiver (and while it
          // reloads): the search is dropped with a debug line, never unhandled.
          log.debug('Search relay had no receiver — action dropped', {
            action: payload.action,
            cause: cause instanceof Error ? cause.message : cause
          });
          return;
        }
        // Reached a receiver but something failed there or in transit —
        // that is not expected, so it logs at warn level.
        log.warn('Search relay send failed', {
          action: payload.action,
          cause: cause instanceof Error ? { message: cause.message } : cause
        });
      });
    } catch (cause) {
      log.error('Search relay failed', { action, queryString, cause });
    }
  });
  return 'registered';
}
