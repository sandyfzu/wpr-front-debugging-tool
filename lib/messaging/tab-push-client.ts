/**
 * The panel side of the tab-push relay (contract: `./tab-pushes`): a
 * DevTools panel without the `tabs` API — Firefox, where a content
 * script's runtime messages never reach DevTools pages — opens one port to
 * the background, subscribes it to the inspected tab, and hands every valid
 * envelope that comes down to its receivers.
 *
 * A panel that has the `tabs` API (Chromium) receives the pushes directly
 * and never connects, so no push is ever delivered to it twice.
 */
import type { Logger } from '../logger';
import { canMessageTabs } from './tab-messaging';
import {
  TAB_PUSH_PORT_NAME,
  parseTabPushEnvelope,
  type TabPushEnvelope,
  type TabPushPort,
  type TabPushSubscription
} from './tab-pushes';

/** Open the push port (production: `runtime.connect` with the contract's name). */
export type ConnectTabPushes = () => TabPushPort;

/** The API slice {@link selectTabPushConnect} probes. */
interface MaybeConnectApi {
  readonly runtime?: {
    readonly connect?: (info: { name: string }) => TabPushPort;
  } | null;
}

/**
 * Decide once whether this context needs the push relay: only when it
 * cannot message tabs (so no push reaches it directly) but can open a
 * runtime port.
 *
 * @param api The extension API object (`browser`), probed structurally.
 * @returns The port opener, or null — always null where `tabs.sendMessage`
 *   exists, so such a context never connects.
 */
export function selectTabPushConnect(api: unknown): ConnectTabPushes | null {
  if (canMessageTabs(api) || typeof api !== 'object' || api === null) return null;
  const runtime = (api as MaybeConnectApi).runtime;
  const connect = runtime?.connect;
  if (typeof connect !== 'function') return null;
  return () => connect.call(runtime, { name: TAB_PUSH_PORT_NAME });
}

/** What one subscription runs against (tests inject doubles). */
export interface TabPushSubscriptionDeps {
  readonly connect: ConnectTabPushes;
  /** The inspected tab to subscribe to. */
  readonly tabId: number;
  /** Receives each envelope that passed the contract (tab scoping is the receiver's). */
  readonly onPush: (envelope: TabPushEnvelope) => void;
  readonly log: Logger;
}

/**
 * Subscribe to the tab's relayed pushes until the returned stop runs.
 *
 * The background's port is persistent for the panel's lifetime (Firefox's
 * MV2 background never suspends); the port closes from that side only on a
 * refused subscription or when the extension itself goes away — so a close
 * is logged and not retried.
 *
 * @param deps See {@link TabPushSubscriptionDeps}.
 * @returns The stop handle (idempotent; closes the port).
 */
export function subscribeTabPushes(deps: TabPushSubscriptionDeps): () => void {
  let port: TabPushPort;
  try {
    port = deps.connect();
  } catch (cause) {
    deps.log.warn('Live page updates unavailable — the push port could not open', cause);
    return () => undefined;
  }
  let open = true;

  const onMessage = (message: unknown): void => {
    const envelope = parseTabPushEnvelope(message);
    if (envelope === null) {
      deps.log.warn('Dropped an invalid relayed push');
      return;
    }
    try {
      deps.onPush(envelope);
    } catch (cause) {
      // One failing receiver must not take the port's listener down.
      deps.log.error('A relayed push handler failed', { push: envelope.push, cause });
    }
  };
  const detach = (): void => {
    open = false;
    port.onMessage.removeListener(onMessage);
    port.onDisconnect.removeListener(onDisconnect);
  };
  const onDisconnect = (): void => {
    detach();
    deps.log.warn('Live page updates stopped — the background closed the push port');
  };

  /** Our side's close: listeners off, then the port (idempotent). */
  const close = (): void => {
    if (!open) return;
    detach();
    try {
      port.disconnect();
    } catch (cause) {
      // Already gone (the context is unloading): nothing left to release.
      deps.log.debug('Push port was already closed', cause);
    }
  };

  port.onMessage.addListener(onMessage);
  port.onDisconnect.addListener(onDisconnect);
  const subscription: TabPushSubscription = { tabId: deps.tabId };
  try {
    port.postMessage(subscription);
  } catch (cause) {
    close();
    deps.log.warn('Live page updates unavailable — the push subscription could not be sent', cause);
  }
  return close;
}
