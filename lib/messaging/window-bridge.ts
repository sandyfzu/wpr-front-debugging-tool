/**
 * Window messenger bridging the MAIN world to the isolated world.
 *
 * MUST be imported from the `@webext-core/messaging/page` subpath: its
 * `defineWindowMessaging` is a separate export (postMessage-backed) and both
 * sides — the MAIN-world capture script and the isolated-world receiver —
 * must use the identical namespace to hear each other.
 */

import { defineWindowMessaging } from '@webext-core/messaging/page';
import type { DeviceSimState } from '../device-simulation/state';

/**
 * The bridge namespace, single-sourced: the MAIN world sends under it, the
 * isolated world listens under it, and a page script can trivially read it
 * from either bundle — it identifies, not authenticates (the receiving side
 * validates every batch).
 */
export const WINDOW_BRIDGE_NAMESPACE = 'wpr-fdt-undefined-references';

/**
 * The message browsers deliver for script errors whose origin details are
 * withheld cross-origin: the exact string the capture side matches on, so
 * recognition cannot drift from what `ErrorEvent.message` actually carries.
 */
export const CROSS_ORIGIN_ERROR_MESSAGE = 'Script error.';

/**
 * The word representing a cross-origin script error on the wire: the batch
 * carries one fixed token per page instead of the unreadable error, rendered
 * to users as-is by the panel.
 */
export const CROSS_ORIGIN_ERROR_WORD = '__EXTERNAL_ORIGIN_ERROR__';

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

/* The identity pair's bridge.
 *
 * A second namespace, deliberately not shared with the error batches above.
 * The library's root listener answers every same-namespace request it
 * receives — even when it holds no handler for the requested type (it
 * responds `undefined`) — so two same-namespace messenger instances inside
 * one JS context (sibling content-script bundles here) would race their
 * acknowledgements and corrupt each other's round trips. Every cross-world
 * pair on this window therefore gets its own namespace: the page world can
 * only reach the pair that serves it, and sibling pairs cannot answer for
 * one another. */

/**
 * Identity bridge namespace: identifies the simulated-device pair's frames.
 * Greppable from either bundle like any postMessage namespace — it
 * identifies, it does not authenticate; both worlds validate payloads.
 */
export const UA_IDENTITY_BRIDGE_NAMESPACE = 'wpr-fdt-ua-identity';

/**
 * Protocol of the simulated-device identity bridge — the relay (isolated
 * world) answering the page-world identity shadow's questions.
 *
 * The MAIN world is the page's world, so every payload is untrusted at both
 * boundaries; the ask itself carries none (the relay answers from its cached
 * tab state), and the receiving side of each message validates the state
 * itself. Exported so tests build their messengers against the same map
 * instead of re-declaring it.
 */
export interface UaIdentityProtocolMap {
  /**
   * MAIN → isolated: the frame's identity script asks whether the tab's
   * document requests currently carry the simulated device identity. No
   * payload. The answer is the relay's cached state, which the sender
   * validates again on arrival.
   */
  uaIdentityRequest(): DeviceSimState;
  /**
   * Isolated → MAIN: the relay re-announces the state behind a change (the
   * boot answer or a live `deviceSimulationChanged` push). The typed
   * acknowledgement settles the send — postMessage sends with no listener
   * never settle (they hang).
   */
  uaIdentityUpdate(data: DeviceSimState): true;
}

export const uaIdentityMessenger = defineWindowMessaging<UaIdentityProtocolMap>({
  namespace: UA_IDENTITY_BRIDGE_NAMESPACE
});
