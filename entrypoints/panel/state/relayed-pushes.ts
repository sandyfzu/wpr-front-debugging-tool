/**
 * The panel's relayed-push edge: where this panel never receives the
 * page's pushes directly (no `tabs` API — Firefox), the same receivers are
 * also fed from the background's tab-push port, each envelope already
 * through the contract's checks (the ones the direct receivers apply) and
 * carrying the tab the background resolved from the push's sender — so the
 * data layer's tab scoping applies unchanged.
 *
 * Where no relay is needed (Chromium) the direct edges come back untouched.
 */
import { createLogger, type Logger } from '../../../lib/logger';
import { subscribeTabPushes, type ConnectTabPushes } from '../../../lib/messaging/tab-push-client';
import type { TabPushEnvelope } from '../../../lib/messaging/tab-pushes';
import type { MessagingEdges, PanelReceivers } from './edges';

const log = createLogger('panel');

/**
 * Hand one relayed push to the receiver its direct channel would reach.
 *
 * @param envelope A contract-checked envelope.
 * @param receivers The data layer's receivers.
 */
export function dispatchTabPush(envelope: TabPushEnvelope, receivers: PanelReceivers): void {
  switch (envelope.push) {
    case 'notifyPanelReload':
      receivers.onPanelReload(envelope.tabId);
      return;
    case 'allScriptsLoaded':
      receivers.onAllScriptsLoaded(envelope.data, envelope.tabId);
      return;
    case 'undefinedReferencesUpdated':
      receivers.onUndefinedReferences(envelope.data, envelope.tabId);
      return;
  }
}

/** What {@link withRelayedPushes} wires (tests inject doubles). */
export interface RelayedPushDeps {
  /** The push port opener (`selectTabPushConnect`), or null when no relay is needed. */
  readonly connect: ConnectTabPushes | null;
  /** The inspected tab to subscribe to (read once, at registration). */
  readonly inspectedTabId: () => number | null;
  readonly log?: Logger;
}

/**
 * Add the relayed pushes to the direct edges.
 *
 * @param edges The direct messaging edges (always registered).
 * @param deps See {@link RelayedPushDeps}.
 * @returns `edges` itself when no relay is needed; otherwise edges whose
 *   `receive` also subscribes to the inspected tab's relayed pushes and
 *   whose stop handle releases both.
 */
export function withRelayedPushes(edges: MessagingEdges, deps: RelayedPushDeps): MessagingEdges {
  const { connect } = deps;
  if (connect === null) return edges;
  const logger = deps.log ?? log;
  return {
    receive: (receivers) => {
      const stopDirect = edges.receive(receivers);
      const tabId = deps.inspectedTabId();
      if (tabId === null) {
        logger.debug('Relayed pushes skipped — no inspected tab');
        return stopDirect;
      }
      const stopRelayed = subscribeTabPushes({
        connect,
        tabId,
        onPush: (envelope) => {
          dispatchTabPush(envelope, receivers);
        },
        log: logger
      });
      return () => {
        stopRelayed();
        stopDirect();
      };
    }
  };
}
