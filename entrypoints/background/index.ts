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
 * - the toolbar badge (`./badge`) — the per-tab action badge + tooltip state
 *   machine and its option gate,
 * - the toolbar click (`./toolbar-click`) — the button opens the on-page
 *   command palette, else the options page,
 * - the simulated-device sessions (`./device-simulation`) — the compare
 *   overlay's tab-scoped UA rules and their lifecycle,
 * - the exclusion-builder sessions (`./exclusion-sessions`) — the session
 *   channels, the interception backend (`./interception-backends`) and the
 *   session cleanup paths,
 * - the tab relay (`./tab-relay`) — tab asks forwarded for extension pages
 *   without the `tabs` API,
 * - the chord platform (`./chord-platform`) — the OS keyboard convention
 *   content scripts cannot read themselves,
 * - the command palette (`./command-palette`) — the on-page palette's view
 *   injection and its builder open for the asking tab,
 * - the latest exclusion list (`./latest-exclusion-list`) — the simulation's
 *   fetched Delay JS list, refreshed when due,
 * - the RUCSS service requests (`./rucss-fetch`) — the RUCSS test's one
 *   request, sent for the asking page only,
 * - the beacon runner load (`./beacon-runner-load`) — the beacon test's
 *   runner, injected into the asking page's top frame on its first run,
 * - the data-sharing consent (`./data-consent`, Firefox build only) — the
 *   grant check before a tool sends a page address, its consent tabs, and
 *   the RUCSS request's own check,
 * - the What's new page (`./whats-new`) — opened once per announced version
 *   after an update, from `onInstalled` or the start check that catches a
 *   missed event.
 *
 * Every subsystem registration happens inside `main()` (nothing at import
 * time beyond constants), the global error handlers are attached first, and
 * no browser event listener is registered after an await so no wake-up event
 * can be missed while a boot step is still pending. The one late registration,
 * the badge option's storage watch, loses nothing: it is armed before its
 * first read of the option, which already sees any earlier change.
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
import { registerTabPushRelay } from './tab-push-relay';
import { registerTabRelay } from './tab-relay';
import { registerChordPlatform } from './chord-platform';
import { registerCommandPalette } from './command-palette';
import { registerToolbarClick } from './toolbar-click';
import { registerLatestExclusionList } from './latest-exclusion-list';
import { registerRucssFetch } from './rucss-fetch';
import { registerBeaconRunnerLoad } from './beacon-runner-load';
import { backgroundConsentCheck, registerDataConsent } from './data-consent';
import { registerWhatsNew } from './whats-new';

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
    registerTabPushRelay();
  } catch (cause) {
    // Only panels that never receive the page's pushes directly subscribe;
    // they then keep loading data but stop refreshing on their own.
    log.error('Tab-push relay init failed — tab-less panels get no live page updates', cause);
  }

  try {
    registerChordPlatform();
  } catch (cause) {
    // The palette's ask then sees no receiver and keeps its fallback notation.
    log.error('Chord platform init failed — on-page chords use the Ctrl convention', cause);
  }

  try {
    registerCommandPalette();
  } catch (cause) {
    // The palette module's asks then see no receiver and report the open failure.
    log.error('Command palette init failed — the on-page palette cannot open', cause);
  }

  try {
    registerToolbarClick();
  } catch (cause) {
    // The button keeps its badge and menu; a left click then does nothing.
    log.error('Toolbar click init failed — a toolbar click opens nothing', cause);
  }

  try {
    // Firefox checks its data consent again before every request (build-time
    // branch: the Chromium bundle has no consent code).
    registerRucssFetch(
      import.meta.env.BROWSER === 'firefox' ? backgroundConsentCheck() : undefined
    );
  } catch (cause) {
    // The page's ask then sees no receiver and the test reports it.
    log.error('RUCSS request init failed — RUCSS tests cannot run', cause);
  }

  try {
    registerBeaconRunnerLoad();
  } catch (cause) {
    // The page's ask then sees no receiver and the test reports the runner unavailable.
    log.error('Beacon runner load init failed — beacon tests cannot run', cause);
  }

  try {
    // Fire-and-forget: the check contains its own failures, and nothing
    // else at boot depends on it.
    void registerWhatsNew().catchUp();
  } catch (cause) {
    // Updates then open no What's new page this session; options still links it.
    log.error('What’s new init failed — no page after updates this session', cause);
  }

  // Firefox only (build-time branch: the Chromium bundle has no consent code).
  if (import.meta.env.BROWSER === 'firefox') {
    try {
      registerDataConsent();
    } catch (cause) {
      // The tools' asks then see no receiver and send nothing.
      log.error('Data-sharing consent init failed — address-sending tools cannot run', cause);
    }
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

  // Fire-and-forget: its due refresh resolves every failure itself, and a
  // slow endpoint must not hold the database prime or the badge gate.
  try {
    void registerLatestExclusionList().prime();
  } catch (cause) {
    // Simulations then run the kept copy (if any) or the bundled list.
    log.error('Latest exclusion list init failed — no refreshes this session', cause);
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
