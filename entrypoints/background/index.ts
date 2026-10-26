/**
 * The background service worker entrypoint: listener wiring only.
 *
 * Responsibilities live in sibling subsystem modules and every one of them is
 * registered here directly, not by shared bootstrap code, so a failure in one
 * subsystem's registration or boot can never blank the others:
 *
 * - header capture (`./headers`) — the per-tab response-header cache,
 * - the Known Conflicts database service (`./known-conflicts`) — freshness,
 *   availability, and the two protocol requests it serves,
 * - the context menus (`./context-menus`) — the entries and their one click
 *   router,
 * - the toolbar badge (`./badge`) — the per-tab action badge state machine
 *   and its option gate,
 * - the simulated-device sessions (`./device-simulation`) — the compare
 *   overlay's tab-scoped UA rules and their lifecycle,
 * - the exclusion-builder sessions (`./exclusion-sessions`) — the session
 *   channels, the interception backend (`./interception-backends`) and the
 *   session cleanup paths,
 * - the tab relay (`./tab-relay`) — tab asks forwarded for extension pages
 *   without the `tabs` API.
 *
 * Every subsystem registration happens inside `main()` (nothing at import
 * time beyond constants), the global error handlers are attached first, and
 * no event is registered after an await so no wake-up event can be missed
 * while a boot step is still pending.
 */

import { createLogger } from '../../lib/logger';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { onUnhandledRejection, onUncaughtError } from '../../lib/uncaught-errors';
import { createDisabledBadgeRuntime, initBadge, watchBadgeGate, type BadgeRuntime } from './badge';
import { initHeaderCapture } from './headers';
import { registerKnownConflictsService } from './known-conflicts';
import { registerContextMenus } from './context-menus';
import {
  createDisabledDeviceSimSessions,
  initDeviceSimSessions,
  type DeviceSimSessions
} from './device-simulation';
import { initExclusionSessions } from './exclusion-sessions';
import { registerTabRelay } from './tab-relay';

const log = createLogger('background');

export default defineBackground(() => {
  initGlobalErrorReporting();
  void main().catch((cause: unknown) => {
    log.error('Background wiring failed', cause);
  });
});

/**
 * Install the process-wide error reporting first: any subsystem error that
 * escapes its own guard surfaces as one console line below the shared
 * prefix — the service worker stays alive for its sibling listeners.
 */
function initGlobalErrorReporting(): void {
  // Everything in a worker scope is ours — no attribution filter needed, so
  // no runtime prefix is passed and every escaping error lands here with its
  // real message, source location, throw-site stack and the error object
  // itself.
  self.addEventListener('error', onUncaughtError({ log }));
  self.addEventListener('unhandledrejection', onUnhandledRejection({ log }));
}

/**
 * Boot the badge subsystem with a degrade path: if the badge itself cannot
 * start, the rest of the session keeps working with a never-rendering
 * runtime instead of losing its header capture.
 *
 * @returns The live runtime, or a disabled one when init failed.
 */
function bootBadge(): BadgeRuntime {
  try {
    return initBadge();
  } catch (cause) {
    log.error('Badge init failed — toolbar badge disabled', cause);
    return createDisabledBadgeRuntime();
  }
}

/**
 * Boot the database service with a degrade path: if its listeners cannot
 * register, refresh triggers resolve as a no-result branch instead of
 * throwing out of unrelated wiring.
 *
 * @returns The service's two entry points `main()` drives.
 */
function bootDatabaseService(): {
  prime: () => Promise<void>;
  refreshNow: () => Promise<DbUpdateResult | null>;
} {
  try {
    const service = registerKnownConflictsService();
    return {
      prime: () => service.prime(),
      refreshNow: () => service.refreshNow()
    };
  } catch (cause) {
    log.error('Database service init failed — refresh triggers disabled', cause);
    return {
      prime: () => Promise.resolve(),
      refreshNow: () => Promise.resolve(null)
    };
  }
}

/**
 * Boot the simulated-device sessions with a degrade path: if their wiring
 * cannot start, asks resolve unavailable and the hooks remove nothing —
 * a session without wiring never spoofs a request.
 *
 * @returns The session model the header capture and the boot sweep drive.
 */
function bootDeviceSimSessions(): DeviceSimSessions {
  try {
    return initDeviceSimSessions();
  } catch (cause) {
    log.error('Device simulation init failed — simulated sessions disabled', cause);
    return createDisabledDeviceSimSessions();
  }
}

/**
 * Boot the exclusion-builder sessions with a degrade path: if their wiring
 * cannot start, their channels stay unregistered (the overlay's asks see
 * no receiver and render that state) — no page is ever rewritten.
 */
function bootExclusionSessions(): void {
  try {
    initExclusionSessions();
  } catch (cause) {
    log.error('Exclusion sessions init failed — builder sessions disabled', cause);
  }
}

/**
 * Boot all subsystems. Every registration is synchronous (it can never fall
 * behind an incoming event); the remaining bootstrap steps resolve and
 * branch independently, and a subsystem whose boot fails degrades to a
 * disabled runtime instead of blanking its siblings.
 */
async function main(): Promise<void> {
  const badge = bootBadge();
  const simSessions = bootDeviceSimSessions();
  bootExclusionSessions();

  try {
    registerTabRelay();
  } catch (cause) {
    // Only contexts without the `tabs` API ask through the relay; they then
    // see no receiver and their panel reports it.
    log.error('Tab relay init failed — tab-less pages cannot reach tabs', cause);
  }

  try {
    initHeaderCapture(badge, simSessions);
  } catch (cause) {
    log.error('Header capture init failed — no page headers this session', cause);
  }

  // The boot sweep is the sessions' own convergence step at wake-up: rules
  // without a live simulated session never survive a restart. It is
  // fire-and-forget on purpose — no boot step depends on it, the per-rule
  // work contains its own failures, and a slow probe must not hold the badge
  // gate or the database prime hostage behind it.
  void simSessions.sweep();

  const database = bootDatabaseService();

  try {
    registerContextMenus(database.refreshNow);
  } catch (cause) {
    log.error('Context menus init failed — no menu entries', cause);
  }

  // `prime` already guards its own boot steps; this outer guard exists so
  // even an unexpected failure can never sink the wiring after it.
  try {
    await database.prime();
  } catch (cause) {
    log.error('Database prime failed', cause);
  }

  try {
    await watchBadgeGate(badge);
  } catch (cause) {
    // The gate stays unresolved → recorded summaries render no badge; the
    // worst case is a never-shown badge until the next boot, never a wrong
    // one on an opted-out session.
    log.error('Badge option gate unresolved — badges unrendered', cause);
  }
}
