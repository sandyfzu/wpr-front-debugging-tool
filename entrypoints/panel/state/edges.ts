/**
 * The panel's real messaging edges — the transport boundary between the data
 * layer's logic and `@webext-core/messaging`.
 *
 * Every received payload is untrusted here (any context can send into the
 * runtime): search actions and push batches are narrowed with the boundary
 * validators before any handler runs, senders are resolved to tab ids for
 * the push channels (the data layer leans on the ids for its tab-scoping),
 * and the request edge targets exactly one tab — the devtools-inspected one.
 *
 * The devtools context: extension pages loaded inside a DevTools window (the
 * `devtools_page` and every panel/sidebar page it created) run with the
 * DevTools extension APIs available — `devtools.inspectedWindow.tabId`
 * included, per the API's own documentation. The accessor stays
 * feature-detected so a non-DevTools context degrades to "no inspected tab"
 * (the request then fails as the expected no-receiver case and the panel
 * reports its error state) instead of throwing on a missing namespace.
 */
import { onMessage, sendMessage } from '../../../lib/messaging/index';
import { resolveSenderTabId } from '../../../lib/messaging/sender';
import { parseErrorWords, parsePanelSearchAction } from '../../../lib/messaging/validate';
import { createLogger } from '../../../lib/logger';
import type { PanelSearchAction } from '../../../lib/wp-rocket/types';

const log = createLogger('panel');

/**
 * The handlers the data layer reaches through `MessagingEdges.receive` —
 * already narrowed at the boundary, with sender tab ids resolved for the
 * push channels the tab-scoping checks.
 */
export interface PanelReceivers {
  /** A validated devtools search action (the find stream into the store). */
  onPanelSearch(payload: PanelSearchAction): void;
  /** All the page's scripts are loaded now (`true`). */
  onAllScriptsLoaded(loaded: boolean, senderTabId: number | null): void;
  /** A fresh undefined-references word list (already limit-checked). */
  onUndefinedReferences(words: string[], senderTabId: number | null): void;
  /** The content script just captured a fresh page (the soft-refresh trigger). */
  onPanelReload(senderTabId: number | null): void;
}

/** The transport seams the data layer runs against (tests inject doubles). */
export interface MessagingEdges {
  /**
   * Ask one tab's content script for the full page data. `undefined` targets
   * nothing (the accessor found no inspected tab) — the send then rejects
   * with the expected no-receiver failure and the panel reports its error
   * state.
   */
  request(tabId: number | undefined): Promise<unknown>;
  /** Register every receiver exactly once at mount; returns the stop handle. */
  receive(receivers: PanelReceivers): () => void;
}

/**
 * The `browser.devtools` namespace as this context may or may not have it —
 * typed structurally so the probe never assumes the namespace exists just
 * because the types say so (the panel runs only in DevTools windows, but the
 * access is feature-detected, never trusted).
 */
interface DevtoolsExtensions {
  readonly devtools?: { readonly inspectedWindow?: { readonly tabId?: unknown } };
}

/**
 * The inspected tab id behind the data layer's injectable accessor seam.
 *
 * @returns The id, or null when this context is not a DevTools window (or
 *   the current tab id is junk) — callers treat null as "nothing to ask".
 */
export function devtoolsInspectedTabId(): number | null {
  const api = browser as unknown as DevtoolsExtensions;
  const tabId = api.devtools?.inspectedWindow?.tabId;
  return typeof tabId === 'number' && tabId >= 0 ? tabId : null;
}

/** One warn line naming the invalid delivery (shared prefix, actionable). */
function warnInvalid(action: string, reason: string): void {
  log.warn(`Dropped an invalid ${action} message`, { reason });
}

/**
 * The runtime's real edges: typed messaging over the shared messenger, one
 * listener per protocol channel, payload validation at the receive boundary.
 */
export function realMessagingEdges(): MessagingEdges {
  return {
    request: (tabId) => sendMessage('getFdtData', undefined, tabId),
    receive: (receivers) => {
      const removers: Array<() => void> = [
        onMessage('panelSearch', ({ data }) => {
          // The runtime sender is untrusted: the payload is narrowed (or
          // dropped with a name) before it reaches the shell state.
          const payload = parsePanelSearchAction(data);
          if (payload === null) {
            warnInvalid('panelSearch', 'unknown action or extra keys');
          } else {
            receivers.onPanelSearch(payload);
          }
          return true;
        }),
        onMessage('allScriptsLoaded', ({ data, sender }) => {
          if (typeof data === 'boolean') {
            receivers.onAllScriptsLoaded(data, resolveSenderTabId(sender));
          } else {
            warnInvalid('allScriptsLoaded', 'non-boolean payload');
          }
          return true;
        }),
        onMessage('undefinedReferencesUpdated', ({ data, sender }) => {
          const words = parseErrorWords(data);
          if (words === null) {
            warnInvalid('undefinedReferencesUpdated', 'word list broke its limits');
          } else {
            receivers.onUndefinedReferences(words, resolveSenderTabId(sender));
          }
          return true;
        }),
        onMessage('notifyPanelReload', ({ sender }) => {
          receivers.onPanelReload(resolveSenderTabId(sender));
          return true;
        })
      ];
      return () => {
        for (const remove of removers) remove();
      };
    }
  };
}
