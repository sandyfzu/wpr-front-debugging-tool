/**
 * The background's tab-push relay: re-sends a tab's three content-script
 * pushes down the `tab-pushes` ports of the DevTools panels subscribed to
 * that tab — the panels that never receive them directly (Firefox). The
 * contract lives in `lib/messaging/tab-pushes`.
 *
 * Lazy by design: the three push listeners exist only while at least one
 * port is subscribed. A context that never subscribes (every Chromium
 * panel) therefore leaves the pushes exactly as they were — no background
 * receiver, so a push with no panel open still fails as "no receiver", and
 * no push ever wakes the service worker.
 */
import { createLogger, type Logger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import {
  isOwnExtensionPageSender,
  resolveTopFrameSender,
  type LooseMessageSender
} from '../../lib/messaging/sender';
import type { TabPushPort } from '../../lib/messaging/tab-push-client';
import {
  TAB_PUSH_PORT_NAME,
  parseTabPushSubscription,
  tabPushEnvelope,
  type TabPush
} from '../../lib/messaging/tab-pushes';

const log = createLogger('tab-push-relay');

/** A connecting port as the runtime hands it over (name and sender untrusted). */
export interface IncomingPushPort extends TabPushPort {
  readonly name: string;
  readonly sender?: LooseMessageSender | undefined;
}

/** Forward one received push (its untrusted sender and payload). */
export type PushForward = (
  push: TabPush,
  sender: LooseMessageSender | undefined,
  data: unknown
) => void;

/** What the relay runs against (tests inject doubles). */
export interface TabPushRelayDeps {
  /** This extension's id (`runtime.id`). */
  readonly extensionId: string;
  /** This extension's root URL (`runtime.getURL('/')`) — the port-sender page check. */
  readonly extensionRootUrl: string;
  /** Start receiving the three pushes; returns the stop handle. */
  readonly listen: (forward: PushForward) => () => void;
  readonly log: Logger;
}

/** The relay's handle (one per background start). */
export interface TabPushRelay {
  /** Take one connecting port (ports of any other name are left alone). */
  accept(port: IncomingPushPort): void;
  /** Subscribed ports across all tabs (the leak check). */
  subscriberCount(): number;
  /** Whether the push listeners are registered right now. */
  isListening(): boolean;
}

/**
 * Build the relay.
 *
 * @param deps See {@link TabPushRelayDeps}.
 */
export function createTabPushRelay(deps: TabPushRelayDeps): TabPushRelay {
  /** Subscribed ports per inspected tab; a tab key exists only while it has ports. */
  const subscribers = new Map<number, Set<IncomingPushPort>>();
  let stopListening: (() => void) | null = null;

  const subscriberCount = (): number => {
    let count = 0;
    for (const ports of subscribers.values()) count += ports.size;
    return count;
  };

  const subscribe = (tabId: number, port: IncomingPushPort): void => {
    const ports = subscribers.get(tabId) ?? new Set<IncomingPushPort>();
    ports.add(port);
    subscribers.set(tabId, ports);
    stopListening ??= deps.listen(forward);
  };

  const unsubscribe = (tabId: number, port: IncomingPushPort): void => {
    const ports = subscribers.get(tabId);
    if (ports === undefined) return;
    ports.delete(port);
    if (ports.size === 0) subscribers.delete(tabId);
    if (subscribers.size === 0 && stopListening !== null) {
      stopListening();
      stopListening = null;
    }
  };

  /** Re-send one push to its tab's subscribers. */
  function forward(push: TabPush, sender: LooseMessageSender | undefined, data: unknown): void {
    // Only a tab's top-frame content script speaks for the page.
    const top = resolveTopFrameSender(sender);
    if (top === null) {
      deps.log.debug('Push not relayed — not from a tab’s top-frame content script', { push });
      return;
    }
    const ports = subscribers.get(top.tabId);
    if (ports === undefined) return;
    const envelope = tabPushEnvelope(push, top.tabId, data);
    if (envelope === null) {
      deps.log.warn('Push not relayed — its payload broke the contract', {
        push,
        tabId: top.tabId
      });
      return;
    }
    for (const port of [...ports]) {
      try {
        port.postMessage(envelope);
      } catch (cause) {
        // The panel went away between its disconnect and our send.
        deps.log.debug('Push port already closed — dropping it', { tabId: top.tabId, cause });
        unsubscribe(top.tabId, port);
      }
    }
  }

  const accept = (port: IncomingPushPort): void => {
    if (port.name !== TAB_PUSH_PORT_NAME) return;
    if (!isOwnExtensionPageSender(port.sender, deps.extensionId, deps.extensionRootUrl)) {
      deps.log.warn('Push port refused — only this extension’s tab-less pages may subscribe');
      port.disconnect();
      return;
    }
    let tabId: number | null = null;

    const release = (): void => {
      port.onMessage.removeListener(onMessage);
      port.onDisconnect.removeListener(onDisconnect);
      if (tabId !== null) unsubscribe(tabId, port);
    };
    /** Our side's close for a contract break (`onDisconnect` does not fire for it). */
    const refuse = (reason: string): void => {
      deps.log.warn(`Push port refused — ${reason}`);
      release();
      port.disconnect();
    };
    function onMessage(message: unknown): void {
      try {
        if (tabId !== null) {
          refuse('a port subscribes once');
          return;
        }
        const subscribed = parseTabPushSubscription(message);
        if (subscribed === null) {
          refuse('malformed subscription');
          return;
        }
        tabId = subscribed;
        subscribe(subscribed, port);
      } catch (cause) {
        deps.log.error('Push subscription failed', cause);
      }
    }
    function onDisconnect(): void {
      release();
    }

    port.onMessage.addListener(onMessage);
    port.onDisconnect.addListener(onDisconnect);
  };

  return { accept, subscriberCount, isListening: () => stopListening !== null };
}

/**
 * The production push listeners: one receiver per relayed push on the
 * shared messenger, each answering the protocol's `true`.
 *
 * @param forward Where each received push goes.
 * @returns The stop handle (unregisters all three).
 */
function listenForTabPushes(forward: PushForward): () => void {
  const removers = [
    onMessage('notifyPanelReload', ({ sender, data }) => {
      forward('notifyPanelReload', sender, data);
      return true;
    }),
    onMessage('allScriptsLoaded', ({ sender, data }) => {
      forward('allScriptsLoaded', sender, data);
      return true;
    }),
    onMessage('undefinedReferencesUpdated', ({ sender, data }) => {
      forward('undefinedReferencesUpdated', sender, data);
      return true;
    })
  ];
  return () => {
    for (const remove of removers) remove();
  };
}

/** Register the relay's port listener (once per background start). */
export function registerTabPushRelay(): void {
  const relay = createTabPushRelay({
    extensionId: browser.runtime.id,
    extensionRootUrl: browser.runtime.getURL('/'),
    listen: listenForTabPushes,
    log
  });
  browser.runtime.onConnect.addListener((port) => {
    try {
      relay.accept(port);
    } catch (cause) {
      log.error('Push port handling failed', cause);
    }
  });
}
