/**
 * The page-world half of the simulated device: when the tab's document
 * requests carry the simulated identity, site code inside the frame reads
 * `navigator.userAgent` instead of the emitter it arrived through — UA-sniffing
 * sites would otherwise render desktop inside a phone-shaped frame. The
 * DNR rule covers the network hop; this module shadows the page hop by
 * defining one own property on the frame's navigator and deleting it again.
 *
 * Scope, recorded honestly: the shadow covers exactly the `userAgent`
 * property — the one surface the design shadows. Device shape, client hints,
 * pixel ratio and touch inputs are deliberately out of scope. The shadow reads
 * only from the paired message it subscribes to; a spoofed bridge message is
 * page-world self-inflicted (it can only change the page's own view of its own
 * navigator — no path back to the server's decision), and every arriving
 * payload is parsed before use.
 *
 * Timing, recorded honestly: the shadow is defined as soon as the frame's
 * relay answers — a task or few after document start. A page whose first
 * parsed script reads `navigator.userAgent` synchronously can observe the
 * real UA in that parse tick; the server decision never depends on this (the
 * request header is rewritten for the whole document request), and the
 * state's testable bound is that the shadow lands before the page's first
 * animation frame. The bounded boot-ask retry is what makes that bound hold
 * across the one real race: the relay possibly installing its answer listener
 * after the ask is posted.
 */

import { createLogger } from '../logger';
import type { DeviceSimState } from './state';
import { parseDeviceSimState } from './state';

/** Silenceable diagnostics under the shared tool prefix. */
const log = createLogger('ua-identity');

/**
 * Total boot-ask attempts: one immediately, re-asked once per frame tick
 * while unanswered. Three covers the relay's answer listener installing just
 * after the first ask (the only race the timing analysis leaves open) without
 * ever becoming a retry loop: each attempt posts a fresh message; ones that
 * outran the listener are gone.
 */
const MAX_BOOT_ASK_ATTEMPTS = 3;

/**
 * One boot-ask attempt's wait: a frame tick in production — the same
 * document-start era the ask outruns — injectable so tests pin the retry
 * pacing without a real animation loop.
 */
const DEFAULT_FRAME_TICK = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/**
 * The identity driver's view of the frame's relay bridge. Payloads and
 * answers are unknown until parsed — the page's world is untrusted input on
 * this boundary, so the driver narrows both surfaces itself.
 */
export interface UaIdentityBridge {
  /**
   * Ask the frame's relay for the tab's simulation state. No payload. May
   * never settle when the relay has not installed its answer listener yet —
   * the driver's bounded retry is the recovery; a settled wrong-shaped
   * answer is parsed, then refused.
   */
  askRelay(): Promise<unknown>;
  /**
   * Subscribe to the relay's state re-announcements (boot answer or live
   * change). Payloads are unknown until parsed. Returns the remover.
   */
  onRelayAnnouncement(handler: (payload: unknown) => void): () => void;
}

/** Everything the page-world identity driver needs from the environment. */
export interface UaIdentityDependencies {
  /** The bridge to the frame's relay (the pair's per-frame window bridge). */
  bridge: UaIdentityBridge;
  /**
   * Where the shadow lands: the frame's navigator. An object — page world in
   * production, a stub in tests.
   */
  navigatorLike: object;
  /** The identity presented while simulation is enabled: the bundled one-device profile's UA. */
  simulatedUserAgent: string;
  /** The wait between boot-ask attempts; defaults to one animation frame. */
  frameTick?: () => Promise<void>;
}

/**
 * Define the simulated identity over the target: an own non-writable
 * `userAgent` property shadowing the prototype's real one. Shape:
 * configurable (so restore can delete it), enumerable (matching the real
 * property's visibility).
 *
 * @param target The navigator (or stub) to define on.
 * @param simulatedUserAgent The string `userAgent` reads while simulated.
 * @returns The restore handle — `true` when the deletion landed — or `null`
 *   when the target resisted: an own property already present (ours is not,
 *   and taking the page's over could break its own scripting), or an
 *   unwriteable target (freezing, hostile accessors). Never throws.
 */
export function defineUserAgentShadow(
  target: object,
  simulatedUserAgent: string
): (() => boolean) | null {
  let existing: PropertyDescriptor | undefined;
  try {
    existing = Object.getOwnPropertyDescriptor(target, 'userAgent');
  } catch (cause) {
    log.warn('Identity shadow refused: the target rejects descriptor reads', cause);
    return null;
  }
  if (existing !== undefined) {
    log.warn(
      'Identity shadow refused: an own userAgent property is already present (not overriding it)'
    );
    return null;
  }
  try {
    Object.defineProperty(target, 'userAgent', {
      value: simulatedUserAgent,
      writable: false,
      enumerable: true,
      configurable: true
    });
  } catch (cause) {
    log.warn('Identity shadow refused: the target rejects the define', cause);
    return null;
  }
  return (): boolean => {
    try {
      // Only our own handiwork gets deleted: `defineUserAgentShadow` refuses
      // a preexisting own property outright, so this delete can only remove
      // what the shadow itself defined.
      return delete (target as { userAgent?: string }).userAgent;
    } catch (cause) {
      log.warn('Identity restore failed; the property stays until the page reloads', cause);
      return false;
    }
  };
}

/**
 * Start the page-world identity on the given navigator: subscribe to the
 * relay's announcements first, then issue the bounded boot ask — the
 * listener-before-ask order is what makes a relay already running answer
 * reliably, and the bounded retries what makes a relay racing us answer at
 * all. Each valid piece of state (ask answer or announcement) drives the
 * shadow: define on enabled, delete again on disabled, and nothing at all
 * while the state stays what it was (idempotent — both channels converge on
 * the same value).
 *
 * Lifetime: the page's. The MAIN world has no invalidation handshake (the
 * entrypoint wrapper provides no context there), so the returned stop handle
 * is the only manual seam — production keeps the shadow until the frame
 * navigates, exactly as long as the DNR rule covers the requests behind it.
 *
 * @param deps The bridge, the navigator to shadow, the simulated identity.
 * @returns The stop handle: removes the announcement listener and drops any
 *   pending retry — it does not restore (page navigation resets everything).
 */
export function startUaIdentity(deps: UaIdentityDependencies): () => void {
  const frameTick = deps.frameTick ?? DEFAULT_FRAME_TICK;

  /** The shadow while it is defined; the only thing restore may ever drop. */
  let activeRestore: (() => boolean) | null = null;
  /** The last applied state; null until the first valid answer arrives. */
  let current: boolean | null = null;
  /** Whether the driver was stopped — retry work after this is dead work. */
  let stopped = false;

  /**
   * Apply a valid state: define on a transition to enabled, restore on a
   * transition to disabled, nothing when the state repeats. A refused
   * shadow (hostile target) logs and stands refused — repeated identifiers
   * do not re-define; only a later off→on transition retries the define.
   * The DNR rule still covers the server's decision in the meantime.
   */
  const applyState = (state: DeviceSimState): void => {
    if (current === state.enabled) return;
    current = state.enabled;
    if (state.enabled) {
      if (activeRestore !== null) return;
      activeRestore = defineUserAgentShadow(deps.navigatorLike, deps.simulatedUserAgent);
      return;
    }
    if (activeRestore !== null) {
      if (!activeRestore()) return;
      activeRestore = null;
    }
  };

  /**
   * Narrow an announcement (the relay's live stream). It always applies: an
   * announcement is the change itself, never a stale snapshot of the past.
   */
  const ingestAnnouncement = (payload: unknown): void => {
    const state = parseDeviceSimState(payload);
    if (state === null) {
      log.warn('Ignored a malformed simulation state announcement');
      return;
    }
    applyState(state);
  };

  /**
   * Narrow a boot-ask answer — a snapshot of the relay's cache at answer
   * time. It applies only while nothing is known yet: once any valid state
   * has landed (this channel or the push one), a later-arriving snapshot is
   * dead information — a retry answer resolving after a push has moved the
   * state would re-introduce what the push just replaced.
   */
  const ingestAskAnswer = (payload: unknown): void => {
    const state = parseDeviceSimState(payload);
    if (state === null) {
      log.warn('Ignored a malformed simulation state answer');
      return;
    }
    if (current !== null) {
      log.debug('Dropped a stale boot-ask answer: the state is already known');
      return;
    }
    applyState(state);
  };

  /** One boot-ask attempt: send, narrow the answer when one settles. */
  const askOnce = (): void => {
    // A settled-but-stale answer still arrives through this promise; a
    // relay-less send may never settle — the retry schedule's target case.
    void deps.bridge
      .askRelay()
      .then(ingestAskAnswer)
      .catch((cause: unknown) => {
        log.debug('Boot ask for the simulation state was refused', cause);
      });
  };

  /**
   * The bounded retry: one new ask per frame tick while the ask stays
   * unanswered (no valid state has landed yet), up to
   * {@link MAX_BOOT_ASK_ATTEMPTS} total. Every stage re-checks the stop flag
   * and the settle condition so a finished driver never posts dead asks.
   */
  const retryAsk = async (): Promise<void> => {
    for (let left = MAX_BOOT_ASK_ATTEMPTS - 1; left > 0; left--) {
      await frameTick();
      if (stopped || current !== null) return;
      askOnce();
    }
  };

  // Listener before ask: a relay already present answers the first send.
  // The guard is deliberate even though ingest never throws today: an
  // exception escaping a message listener surfaces in the page's own console
  // (the page shares this world) — a listener failure logs and continues.
  const removeAnnouncement = deps.bridge.onRelayAnnouncement((payload) => {
    try {
      ingestAnnouncement(payload);
    } catch (cause) {
      log.warn('Announcement could not be applied', cause);
    }
  });
  askOnce();
  void retryAsk().catch((cause: unknown) => {
    log.debug('Boot ask retry schedule failed', cause);
  });

  return (): void => {
    stopped = true;
    removeAnnouncement();
  };
}
