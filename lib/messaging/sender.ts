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

/** A sender timestamp or tab reference as the runtime actually delivers it. */
interface LooselyTypedMessageSender {
  tab?: { id?: unknown } | undefined;
}

/**
 * A numeric, non-negative integer tab id — the only usable identity a tab
 * reference can carry. Anything else (strings, zero-decimal floats,
 * negatives, `null`) is junk by the runtime's own id conventions.
 *
 * @param value An unknown tab id as found on a message, a click event, or a
 *   storage revisit.
 */
export function numericTabId(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The tab id carried by a received message's sender, or `null` for senders
 * with no usable tab (extension pages, malformed hand-crafted senders).
 *
 * @param sender Runtime sender as delivered on a received message, or undefined.
 */
export function resolveSenderTabId(sender: LooselyTypedMessageSender | undefined): number | null {
  return numericTabId(sender?.tab?.id);
}
