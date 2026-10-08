/**
 * Window messenger bridging the MAIN world to the isolated world.
 *
 * MUST be imported from the `@webext-core/messaging/page` subpath: its
 * `defineWindowMessaging` is a separate export (postMessage-backed) and both
 * sides — the MAIN-world capture script and the isolated-world receiver —
 * must use the identical namespace to hear each other.
 */

import { defineWindowMessaging } from '@webext-core/messaging/page';

/**
 * The bridge namespace, single-sourced: the MAIN world sends under it, the
 * isolated world listens under it, and a page script can trivially read it
 * from either bundle — it identifies, not authenticates (the receiving side
 * validates every batch).
 */
export const WINDOW_BRIDGE_NAMESPACE = 'wpr-fdt-undefined-references';

/**
 * Protocol of the MAIN ↔ isolated window bridge. Error batches arrive as one
 * debounced push per burst; the isolated side validates with
 * `parseErrorWords` before merging (the MAIN world is the page's world).
 * Exported so tests (and future consumers) build their messengers against the
 * same map instead of re-declaring it.
 */
export interface WindowProtocolMap {
  /**
   * Batch of undefined-reference words, validated on the receiving side.
   * The receiver's handler returns `true` to settle the sender's promise —
   * postMessage sends with no listener never settle (they hang).
   */
  undefinedReferenceBatch(data: string[]): true;
}

export const windowMessenger = defineWindowMessaging<WindowProtocolMap>({
  namespace: WINDOW_BRIDGE_NAMESPACE
});
