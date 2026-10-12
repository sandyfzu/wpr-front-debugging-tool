/**
 * The isolated-world half of the simulated-device identity pair: the relay
 * between the extension's state (whose owner is the background session
 * service) and the frame's page-world identity shadow. Registered per frame
 * at document start, it answers the page world's state question from the
 * answer it caches and forwards every later state change as it happens.
 *
 * Why it is its own content script instead of a lift of a sibling: the halves
 * inside a compare overlay can redirect cross-origin, and the identity needs
 * to land inside redirected frames just the same — the relay therefore
 * matches every http/https document, on its own all-frames registration.
 *
 * Trust model: the page's world is untrusted input here. The ask itself can
 * only ever carry no payload — there is nothing to validate on that surface —
 * and everything the extension messaging returns arrives as a plain value,
 * so every state is parsed at this module's boundary before it becomes cache
 * or push.
 */

import type { Logger } from '../../lib/logger';
import type { DeviceSimState } from '../../lib/device-simulation/state';
import { parseDeviceSimState } from '../../lib/device-simulation/state';

/**
 * The cache before the first valid answer arrives, answered to the page
 * world as all-off for the same honesty rule: with nothing known, nothing
 * may be simulated.
 */
const NOT_KNOWN: DeviceSimState = { available: false, enabled: false };

/**
 * The extension seams the relay rides: the one sender-resolved ask off the
 * background protocol and the tab's own live push. Payloads arrive as
 * unknown values — narrowed by this module before use.
 */
export interface UaRelayExtensionChannel {
  /**
   * Ask the background for the sender tab's simulation state (`getDeviceSimulation`).
   * Rejects when the background cannot answer at all — a service worker gone;
   * that failure degrades the cache to all-off, it never throws upward.
   */
  askBackground(): Promise<unknown>;
  /** Subscribe to the tab's `deviceSimulationChanged` stream. Returns the remover. */
  onBackgroundPush(handler: (payload: unknown) => void): () => void;
}

/**
 * The window-bridge seams toward the frame's page world. Registration of the
 * ask handler precedes any announcement (a bridge send with no listener
 * never settles), which is the caller's obligation; the module only forwards.
 */
export interface UaRelayWindowBridge {
  /** Register the page world's ask handler. Returns the remover. */
  onIdentityAsk(handler: () => DeviceSimState): () => void;
  /**
   * Push a state to the page world mid-change. Delivery is best-effort and
   * may stay unsettled (no listener — the page world raced or is gone): the
   * wiring catches rejections and logs them; the module never awaits it.
   */
  announceIdentityState(state: DeviceSimState): void;
}

/** Everything the relay needs from its environment, injectable for tests. */
export interface UaRelayDependencies {
  /** The extension seams (ask + tab push). */
  extension: UaRelayExtensionChannel;
  /** The bridge seams toward the page world (ask handler + announcements). */
  windowBridge: UaRelayWindowBridge;
  /** The surface's logger. */
  log: Logger;
}

/**
 * Start the identity relay for one frame. Boot order matters and holds:
 * the ask handler is registered before the background ask is even sent, so
 * a page world asking at document start is always answered (with the
 * not-yet-known state while the background round trip is in flight), and the
 * first valid answer is announced to the page world as soon as it lands.
 *
 * Unavailable browsers (no session DNR) answer all-off like the background
 * does — the type of the state makes that the refusal, nothing is branched
 * here beyond "the tab's state".
 *
 * @param deps The three seams.
 * @returns The stop handle: removes the ask handler and the push
 *   subscription. Stops cleanly on content-script invalidation.
 */
export function startUaIdentityRelay(deps: UaRelayDependencies): () => void {
  const { extension, windowBridge: bridge, log } = deps;

  /** The tab's state as far as this relay knows (`NOT_KNOWN` until first answered). */
  let cached: DeviceSimState = NOT_KNOWN;

  /** Push a state to the page world, on change only. */
  const announceOnChange = (next: DeviceSimState): void => {
    if (next.available === cached.available && next.enabled === cached.enabled) return;
    cached = next;
    bridge.announceIdentityState(next);
  };

  const removeAskHandler = bridge.onIdentityAsk(() => cached);

  const removePush = extension.onBackgroundPush((payload) => {
    try {
      const state = parseDeviceSimState(payload);
      if (state === null) {
        log.warn('Ignored a malformed simulation state push');
        return;
      }
      announceOnChange(state);
    } catch (cause) {
      // Every listener body is guarded: one poisoned payload can never
      // break the sibling listener or the relay itself.
      log.warn('Simulation state push could not be processed', cause);
    }
  });

  void extension
    .askBackground()
    .then((answer) => {
      const state = parseDeviceSimState(answer);
      if (state === null) {
        log.error('Simulation state ask was refused — cached as unavailable');
        return;
      }
      announceOnChange(state);
    })
    .catch((cause: unknown) => {
      log.error('Simulation state ask failed — cached as unavailable', cause);
    });

  return (): void => {
    removeAskHandler();
    removePush();
  };
}
