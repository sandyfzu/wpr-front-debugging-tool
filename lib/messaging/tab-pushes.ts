/**
 * The tab-push relay contract. Firefox never delivers a content script's
 * runtime messages to DevTools pages, so a panel there misses the page's
 * three pushes (`notifyPanelReload`, `allScriptsLoaded`,
 * `undefinedReferencesUpdated`). Such a panel opens one port named
 * {@link TAB_PUSH_PORT_NAME}, subscribes it to its inspected tab, and the
 * background re-sends each push from that tab's top frame down the port as
 * one {@link TabPushEnvelope}. Both ends hold the port as a {@link TabPushPort}.
 *
 * Closed by construction: only the pushes in {@link TAB_PUSHES} travel,
 * each payload passes the same check the panel's direct receivers apply,
 * and every wire shape is exact-keyed — anything else is refused.
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { numericTabId } from './sender';
import { parseErrorWords } from './validate';

/** The port name a panel subscribes with (the background ignores any other). */
export const TAB_PUSH_PORT_NAME = 'tab-pushes';

/** One port event as both ends touch it (structural: the runtime's `Port` fits). */
export interface PortEvent<Listener> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

/** The runtime port slice the relay uses on either end. */
export interface TabPushPort {
  postMessage(message: unknown): void;
  disconnect(): void;
  readonly onMessage: PortEvent<(message: unknown) => void>;
  readonly onDisconnect: PortEvent<() => void>;
}

/** The payload each relayed push carries (`undefined`: none). */
export interface TabPushPayloads {
  notifyPanelReload: undefined;
  allScriptsLoaded: boolean;
  undefinedReferencesUpdated: string[];
}

/** One relayed push's name. */
export type TabPush = keyof TabPushPayloads;

/** One push for one tab, as it travels down the port. */
export type TabPushEnvelope = {
  [K in TabPush]: TabPushPayloads[K] extends undefined
    ? { readonly tabId: number; readonly push: K }
    : { readonly tabId: number; readonly push: K; readonly data: TabPushPayloads[K] };
}[TabPush];

/** How each push's envelope is built from an untrusted payload (null: refused). */
type EnvelopeBuilders = {
  readonly [K in TabPush]: (
    tabId: number,
    data: unknown
  ) => Extract<TabPushEnvelope, { push: K }> | null;
};

/**
 * The relayed pushes — adding one is one row here plus its payload type.
 * Each row applies the panel's own receive check for that push.
 */
const ENVELOPE_BUILDERS: EnvelopeBuilders = {
  notifyPanelReload: (tabId, data) =>
    data === undefined ? { tabId, push: 'notifyPanelReload' } : null,
  allScriptsLoaded: (tabId, data) =>
    typeof data === 'boolean' ? { tabId, push: 'allScriptsLoaded', data } : null,
  undefinedReferencesUpdated: (tabId, data) => {
    const words = parseErrorWords(data);
    return words === null ? null : { tabId, push: 'undefinedReferencesUpdated', data: words };
  }
};

/** Every relayed push's name, in registry order. */
export const TAB_PUSHES = Object.keys(ENVELOPE_BUILDERS) as readonly TabPush[];

/** Whether a value names a relayed push (own keys only — never `toString` & co.). */
export function isTabPush(value: unknown): value is TabPush {
  return typeof value === 'string' && Object.hasOwn(ENVELOPE_BUILDERS, value);
}

/**
 * Build the envelope for one received push.
 *
 * @param push The push's name.
 * @param tabId The tab it came from (resolved from the runtime sender).
 * @param data The push's payload, untrusted.
 * @returns The envelope, or null when the payload breaks the push's check.
 */
export function tabPushEnvelope(
  push: TabPush,
  tabId: number,
  data: unknown
): TabPushEnvelope | null {
  return ENVELOPE_BUILDERS[push](tabId, data);
}

/** The envelope's permitted keys. */
const ENVELOPE_KEYS = ['tabId', 'push', 'data'] as const;

/**
 * Validate an untrusted envelope (the panel's side of the port).
 *
 * @param input The port message.
 * @returns The envelope rebuilt from known fields, or null for a
 *   non-record, an extra key, a junk tab id, an unknown push, or a payload
 *   its push refuses.
 */
export function parseTabPushEnvelope(input: unknown): TabPushEnvelope | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ENVELOPE_KEYS)) return null;
  const tabId = numericTabId(ownValue(input, 'tabId'));
  const push = ownValue(input, 'push');
  if (tabId === null || !isTabPush(push)) return null;
  return tabPushEnvelope(push, tabId, ownValue(input, 'data'));
}

/** The one message a panel sends on its port: the tab it inspects. */
export interface TabPushSubscription {
  readonly tabId: number;
}

/**
 * Validate an untrusted subscription (the background's side of the port).
 *
 * @param input The port message.
 * @returns The subscribed tab id, or null on any violation.
 */
export function parseTabPushSubscription(input: unknown): number | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['tabId'])) return null;
  return numericTabId(ownValue(input, 'tabId'));
}
