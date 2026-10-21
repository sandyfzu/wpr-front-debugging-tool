/**
 * The exclusion-builder sessions' background wiring: the session
 * controller over the real stores, pushes and tabs, the selected
 * interception backend, the six session channels, and the cleanup hooks
 * (tab close, extension update, wake re-validation). Lifecycle logic lives
 * in `lib/exclusion-session/`; this module only binds it to `browser.*`.
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
import { INTERCEPTION_BACKENDS } from './interception-backends';

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

/** Whether a tab exists (an id-only read needs no `tabs` permission). */
async function tabExists(tabId: number): Promise<boolean> {
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch (cause) {
    log.debug('Session tab probe found no tab', { tabId, cause });
    return false;
  }
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
    tabExists,
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

  browser.tabs.onRemoved.addListener((tabId) => {
    try {
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
