/**
 * The exclusion-builder sessions' background wiring: the session
 * controller over the real stores, pushes and tabs, the selected
 * interception backend, the six session channels, the overlay's opener
 * channels (the panel's open, the overlay's presentation) with the overlay
 * re-open on a session tab's loaded pages, and the cleanup hooks (tab
 * close, extension update, wake re-validation). Lifecycle logic lives in
 * `lib/exclusion-session/`; this module only binds it to `browser.*`.
 */
import { createLogger } from '../../lib/logger';
import { onMessage, sendMessage } from '../../lib/messaging';
import {
  selectInterceptionBackend,
  type InterceptionBackendRow
} from '../../lib/exclusion-session/backend';
import {
  createExclusionSessionController,
  type ExclusionSessionController
} from '../../lib/exclusion-session/controller';
import {
  getExclusionSessionRecords,
  getExclusionSessionStatus,
  putExclusionSessionRecord,
  removeExclusionSessionRecord
} from '../../lib/storage/exclusion-sessions';
import { getSavedExclusionSet, saveExclusionSet } from '../../lib/storage/exclusion-sets';
import {
  createOverlayReopener,
  type OverlayReopener
} from '../../lib/exclusion-session/overlay-reopen';
import {
  getOverlayPresentation,
  removeOverlayPresentation,
  setOverlayPresentation
} from '../../lib/storage/overlay-presentations';
import {
  parseExclusionOverlayPresentation,
  parseExclusionSessionTabQuery
} from '../../lib/messaging/exclusion-session';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import {
  isExtensionPageSender,
  resolveTopFrameSender,
  type LooseMessageSender
} from '../../lib/messaging/sender';
import { INTERCEPTION_BACKENDS } from './interception-backends';
import { openExclusionOverlay, reopenExclusionOverlay } from './exclusion-overlay';
import { tabExists } from './tab-exists';

const log = createLogger('exclusion-session');

/**
 * Pass an answer through, logging a refusal before it reaches the sender
 * (where it surfaces as the ask's `failed` outcome).
 *
 * @param row The channel, for the log line.
 * @param answer The controller's answer.
 */
function answered<T>(row: string, answer: Promise<T>): Promise<T> {
  return answer.catch((cause: unknown) => {
    log.warn('Session ask refused', { row, cause });
    throw cause;
  });
}

/**
 * Reload a tab after the current task (so the apply answer is sent
 * first), bypassing the cache so the reload is a real network document
 * the backend intercepts.
 */
function scheduleReload(tabId: number): void {
  setTimeout(() => {
    browser.tabs.reload(tabId, { bypassCache: true }).catch((cause: unknown) => {
      log.error('Applied-session reload failed', { tabId, cause });
    });
  }, 0);
}

/**
 * Create the selected backend for the host, or null when this browser has
 * none (logged once).
 *
 * @param rows The registry (injectable for tests).
 */
function backendFactory(rows: readonly InterceptionBackendRow[]) {
  const row = selectInterceptionBackend(rows);
  if (row === null)
    log.info('No interception backend for this browser — applies answer unavailable');
  return row === null ? () => null : row.create.bind(row);
}

/**
 * Answer the panel's open: only this extension's tab-less pages may name a
 * tab by payload (a content script must never open the overlay elsewhere).
 *
 * @param sender The runtime sender.
 * @param data The untrusted payload.
 * @param open The opener.
 * @throws {@link Error} for a refused sender or a malformed payload (the
 *   sender's ask sees `failed`).
 */
export function answerOverlayOpen(
  sender: LooseMessageSender | undefined,
  data: unknown,
  open: (tabId: number) => Promise<ExclusionOverlayOpenOutcome>
): Promise<ExclusionOverlayOpenOutcome> {
  if (!isExtensionPageSender(sender, browser.runtime.id)) {
    return Promise.reject(new Error('openExclusionOverlay: only extension pages may name a tab'));
  }
  const query = parseExclusionSessionTabQuery(data);
  if (query === null) {
    return Promise.reject(new Error('openExclusionOverlay: malformed query refused'));
  }
  return open(query.tabId);
}

/**
 * Take the overlay's presentation push: only a top-frame page sender's
 * well-formed push is recorded (for its own tab).
 *
 * @param sender The runtime sender.
 * @param data The untrusted payload.
 * @param reopener Where the presentation is recorded.
 * @returns Whether it was recorded (false: dropped, logged).
 */
export function answerOverlayPresented(
  sender: LooseMessageSender | undefined,
  data: unknown,
  reopener: Pick<OverlayReopener, 'presented'>
): boolean {
  const page = resolveTopFrameSender(sender);
  const presentation = parseExclusionOverlayPresentation(data);
  if (page === null || presentation === null) {
    log.warn('Dropped an invalid overlay presentation push');
    return false;
  }
  void reopener.presented(page.tabId, presentation.open);
  return true;
}

/**
 * Register the sessions. Runs once per background start: the channels and
 * listeners register synchronously (no wake event can be missed), and the
 * wake re-validation starts at once — every ask and document waits for it.
 *
 * @param rows The backend registry; defaults to {@link INTERCEPTION_BACKENDS}.
 * @returns The controller.
 */
export function initExclusionSessions(
  rows: readonly InterceptionBackendRow[] = INTERCEPTION_BACKENDS
): ExclusionSessionController {
  const controller = createExclusionSessionController({
    createBackend: backendFactory(rows),
    sessions: {
      read: getExclusionSessionStatus,
      readAll: getExclusionSessionRecords,
      put: putExclusionSessionRecord,
      remove: removeExclusionSessionRecord
    },
    savedSets: { get: getSavedExclusionSet, save: (origin, set) => saveExclusionSet(origin, set) },
    pushToTab: (tabId, status) =>
      sendMessage('exclusionSessionChanged', status, { tabId, frameId: 0 }),
    pushToPanels: (tabId, status) => sendMessage('exclusionSessionUpdated', { tabId, status }),
    reload: scheduleReload,
    tabExists: (tabId) => tabExists(tabId, log),
    now: () => Date.now(),
    extensionId: browser.runtime.id,
    log
  });

  onMessage('applyExclusionSession', ({ sender, data }) =>
    answered('applyExclusionSession', controller.apply(sender, data))
  );
  onMessage('stopExclusionSession', ({ sender }) =>
    answered('stopExclusionSession', controller.stop(sender))
  );
  onMessage('getExclusionSession', ({ sender }) =>
    answered('getExclusionSession', controller.status(sender))
  );
  onMessage('getSavedExclusionSet', ({ sender }) =>
    answered('getSavedExclusionSet', controller.savedSet(sender))
  );
  onMessage('saveExclusionSet', ({ sender, data }) =>
    answered('saveExclusionSet', controller.save(sender, data))
  );
  onMessage('getExclusionSessionForTab', ({ sender, data }) =>
    answered('getExclusionSessionForTab', controller.statusForTab(sender, data))
  );

  const reopener = createOverlayReopener({
    status: (tabId) => controller.tabStatus(tabId),
    reopen: (tabId, presentation, origin) => reopenExclusionOverlay(tabId, presentation, origin),
    presentations: {
      get: getOverlayPresentation,
      set: setOverlayPresentation,
      remove: removeOverlayPresentation
    },
    log
  });
  onMessage('openExclusionOverlay', ({ sender, data }) =>
    answered('openExclusionOverlay', answerOverlayOpen(sender, data, openExclusionOverlay))
  );
  onMessage('exclusionOverlayPresented', ({ sender, data }) => {
    answerOverlayPresented(sender, data, reopener);
    return true;
  });

  // A session tab's page finished loading: bring the overlay back (once
  // per document — the page's overlay slot is claimed before any injection).
  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    try {
      if (change.status === 'complete') void reopener.pageLoaded(tabId, tab.url);
    } catch (cause) {
      log.error('Overlay re-open failed', { tabId, cause });
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    try {
      void reopener.tabClosed(tabId);
      void controller.tabClosed(tabId);
    } catch (cause) {
      log.error('Closed-tab session cleanup failed', { tabId, cause });
    }
  });

  // An extension update/reload restores unmodified rendering whatever the
  // `session:` area kept across it.
  browser.runtime.onInstalled.addListener((details) => {
    try {
      if (details.reason === 'update') void controller.resetAll();
    } catch (cause) {
      log.error('Session reset on update failed', cause);
    }
  });

  void controller.revalidate();
  return controller;
}
