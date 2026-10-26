/**
 * Sender-shape validation for messages from page-attached contexts.
 *
 * The message protocol carries **no** tab ids inside payloads: tab-targeted
 * state is resolved from the runtime sender instead, which cannot be spoofed
 * from a content script. Any hand-crafted or malformed id (nothing tab
 * shaped, a non-numeric value on the edge of the type) yields `null`, and
 * the receiving handler must ignore the message entirely — trusting a
 * malformed tab reference would serve one context's data to another.
 */

import { isHttpOrigin, parseUrl } from '../../utils/urls';

/** A sender tab reference and page URL as the runtime actually delivers them. */
export interface LooseMessageSender {
  tab?: { id?: unknown } | undefined;
  /** The sending document's URL (extension pages included). */
  url?: unknown;
  /** The sending frame: `0` for a top-level frame; only set when `tab` is. */
  frameId?: unknown;
  /** The sending extension's id. */
  id?: unknown;
}

/**
 * A numeric, non-negative safe-integer tab id — the only usable identity a
 * tab reference can carry. Anything else (strings, fractions, negatives,
 * integers past 2^53 that no longer round-trip, `null`) is junk by the
 * runtime's own id conventions.
 *
 * @param value An unknown tab id as found on a message, a click event, or a
 *   storage revisit.
 */
export function numericTabId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * The tab id carried by a received message's sender, or `null` for senders
 * with no usable tab (extension pages, malformed hand-crafted senders).
 *
 * @param sender Runtime sender as delivered on a received message, or undefined.
 */
export function resolveSenderTabId(sender: LooseMessageSender | undefined): number | null {
  return numericTabId(sender?.tab?.id);
}

/**
 * The page URL of the context that sent the message, parsed. Content-script
 * senders always carry the sending frame's URL (it is not gated behind the
 * `tabs` permission); extension surfaces and malformed senders yield no URL
 * or a junk one — both reject to `null`, so callers decide the fail direction.
 *
 * @param sender Runtime sender as delivered on a received message, or undefined.
 */
export function resolveSenderUrl(sender: LooseMessageSender | undefined): URL | null {
  const raw = sender?.url;
  return typeof raw === 'string' ? parseUrl(raw) : null;
}

/** A content-script sender in a tab's top frame, resolved to its tab and page origin. */
export interface TopFrameSender {
  readonly tabId: number;
  /** The page's canonical http(s) origin. */
  readonly origin: string;
}

/**
 * Resolve a sender that may act for a tab's page as a whole: a content
 * script in the top frame (`frameId` 0) of an http(s) page. A subframe, an
 * extension page, a non-http(s) page or a malformed sender yields `null`,
 * and the handler refuses it — a frame must never act for its embedder.
 *
 * @param sender Runtime sender as delivered on a received message, or undefined.
 */
export function resolveTopFrameSender(
  sender: LooseMessageSender | undefined
): TopFrameSender | null {
  const tabId = resolveSenderTabId(sender);
  if (tabId === null || sender?.frameId !== 0) return null;
  const origin = resolveSenderUrl(sender)?.origin;
  return origin !== undefined && isHttpOrigin(origin) ? { tabId, origin } : null;
}

/**
 * Whether a sender is one of this extension's tab-less pages (e.g. the
 * devtools panel): no runtime tab, and our extension id. Content scripts
 * always carry a tab, so a web page can never pass (nor can an extension
 * page open in a tab — conservative) — the gate for rows that name a tab
 * by payload.
 *
 * @param sender Runtime sender as delivered on a received message, or undefined.
 * @param extensionId This extension's id (`browser.runtime.id`), injected for tests.
 */
export function isExtensionPageSender(
  sender: LooseMessageSender | undefined,
  extensionId: string
): boolean {
  return sender !== undefined && sender.tab === undefined && sender.id === extensionId;
}
