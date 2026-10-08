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
 *   and its option gate.
 *
 * Every subsystem registration happens inside `main()` (nothing at import
 * time beyond constants), the global error handlers are attached first, and
 * no event is registered after an await so no wake-up event can be missed
 * while a boot step is still pending.
 */

import { createLogger } from '../../lib/logger';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { createDisabledBadgeRuntime, initBadge, watchBadgeGate, type BadgeRuntime } from './badge';
import { initHeaderCapture } from './headers';
import { registerKnownConflictsService } from './known-conflicts';
import { registerContextMenus } from './context-menus';

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
  // A service worker's uncaught error surfaces here as an ErrorEvent; the
  // rejection event carries its reason. Logging the object itself keeps both
  // cases on one line without losing their content.
  self.addEventListener('error', (event) => {
    log.error('Uncaught error', event);
  });
  self.addEventListener('unhandledrejection', (event) => {
    log.error('Unhandled promise rejection', event);
  });
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
 * Boot all subsystems. Every registration is synchronous (it can never fall
 * behind an incoming event); the remaining bootstrap steps resolve and
 * branch independently, and a subsystem whose boot fails degrades to a
 * disabled runtime instead of blanking its siblings.
 */
async function main(): Promise<void> {
  const badge = bootBadge();

  try {
    initHeaderCapture(badge);
  } catch (cause) {
    log.error('Header capture init failed — no page headers this session', cause);
  }

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
