/**
 * The consent flow's production wiring: Firefox's permissions API (the
 * grant, the request, the removal and grant events), the answer push to the
 * waiting tool, and the page's own tab.
 */
import type { DataConsentApi } from '../../lib/data-consent/consent';
import type { DataConsentPageQuery } from '../../lib/data-consent/consent-page-url';
import type { Logger } from '../../lib/logger';
import { sendMessage } from '../../lib/messaging';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import type { ConsentFlowDeps } from './consent-flow';

/**
 * The data types in a `permissions.onAdded`/`onRemoved` payload (Firefox's
 * `data_collection` key is missing from the shared API typings).
 *
 * @param changed The event's permissions object.
 */
export function removedDataCollection(changed: object): string[] {
  const list: unknown = Reflect.get(changed, 'data_collection');
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Follow one permissions event's data types.
 *
 * @param event `permissions.onAdded` or `permissions.onRemoved`.
 * @param onChange Called with each change's data types.
 * @returns The unsubscribe.
 */
function watchDataCollection(
  event: typeof browser.permissions.onRemoved,
  onChange: (dataCollection: readonly string[]) => void
): () => void {
  const listener = (changed: object): void => {
    onChange(removedDataCollection(changed));
  };
  event.addListener(listener);
  return () => {
    event.removeListener(listener);
  };
}

/**
 * Build the production deps.
 *
 * @param query What the page was opened for.
 * @param api Firefox's permissions API.
 * @param hasConsent The grant read.
 * @param log The page's logger.
 */
export function realConsentFlowDeps(
  query: DataConsentPageQuery,
  api: DataConsentApi,
  hasConsent: () => Promise<boolean>,
  log: Logger
): ConsentFlowDeps {
  return {
    query,
    hasConsent,
    request: (permissions) => api.request(permissions),
    watchRemoved: (onRemoved) => watchDataCollection(browser.permissions.onRemoved, onRemoved),
    watchAdded: (onAdded) => watchDataCollection(browser.permissions.onAdded, onAdded),
    sendAnswer: async (granted) => {
      try {
        await sendMessage('dataConsentAnswered', { feature: query.feature, granted });
      } catch (cause) {
        // No tool open to hear it is expected (the tool asks again at its next use).
        if (isNoReceiverError(cause)) log.debug('No tool is waiting for the consent answer');
        else log.warn('Telling the tool the consent answer failed', cause);
      }
    },
    closeTab: async () => {
      const tab = await browser.tabs.getCurrent();
      if (tab?.id === undefined) throw new Error('The consent page is not in a tab');
      await browser.tabs.remove(tab.id);
    },
    navigate: (url) => {
      window.location.replace(url);
    },
    log
  };
}
