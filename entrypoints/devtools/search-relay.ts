/**
 * The panel's DevTools search relay: when the user searches inside the WPR
 * FDT panel, Chrome fires `panel.onSearch` on the devtools page, and every
 * action is relayed to the panel page as one typed `panelSearch` message
 * (the shell side consumes it from there — routes/pages never touch the
 * browser API).
 */
import { sendMessage } from '../../lib/messaging/index';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import { createLogger } from '../../lib/logger';
import { PANEL_SEARCH_ACTIONS } from '../../lib/wp-rocket/types';
import type { PanelSearchAction } from '../../lib/wp-rocket/types';

const log = createLogger('devtools');

/**
 * Narrow one raw `onSearch` event to the protocol payload. Chrome reports
 * the action as a bare string and the query only on `performSearch`
 * (still tolerated absent — the query becomes an empty string, which the
 * boundary validator accepts); anything outside the exact four actions is
 * dropped here so an unexpected API value can never reach the panel.
 *
 * @param action The event's action string.
 * @param queryString The event's query string (`performSearch` only).
 * @returns The typed payload, or null for an unknown action.
 */
export function toPanelSearchPayload(
  action: string,
  queryString: string | undefined
): PanelSearchAction | null {
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

/**
 * The part of a created panel the relay wiring touches, narrowed to the
 * search event's registration shape: the dependency seam is what the wiring
 * reads, so tests inject panel doubles without carrying the full API type.
 */
interface SearchEventSource {
  /** The panel's search-action event (fires on perform/cancel/next/prev). */
  onSearch: {
    addListener: (callback: (action: string, queryString?: string) => void) => void;
  };
}

/**
 * Relay all four search actions (`performSearch`, `cancelSearch`,
 * `nextSearchResult`, `previousSearchResult`): DevTools only fires the
 * cancel/navigation events to a listener registered here, so registering
 * for all four and relaying each is what keeps the panel's find-in-page
 * protocol complete.
 *
 * The send is failure-aware: until the panel page mounts its receiver (and
 * whenever it is reloading), the no-receiver rejection is the expected case
 * — logged at debug level so every dropped search is visible without ever
 * becoming an unhandled rejection.
 *
 * @param panel The panel Chrome created (its `onSearch` event).
 */
export function registerSearchRelay(panel: SearchEventSource): void {
  panel.onSearch.addListener((action, queryString) => {
    try {
      const payload = toPanelSearchPayload(action, queryString);
      if (payload === null) {
        log.warn('Ignored an unexpected DevTools search action', { action, queryString });
        return;
      }
      sendMessage('panelSearch', payload).catch((cause: unknown) => {
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
}
