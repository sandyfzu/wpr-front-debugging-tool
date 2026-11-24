/**
 * The What's new page's opening: `runtime.onInstalled` (registered
 * synchronously, so a wake-up event is never missed) and one start check
 * (the catch-up for an update whose event never reached a live listener)
 * both feed the announcer (`lib/release-notes/announcer`), which decides,
 * stores the marker and only then asks this glue to open the tab — in the
 * last-focused normal window, never a private one; with none yet (an update
 * applied at browser start) it waits briefly for the first one before
 * creating a window. The page's address carries the decision's floor, so it
 * expands every release the user has not seen. `tabs.create` with the
 * extension's own page needs no `tabs` permission.
 */
import { createLogger } from '../../lib/logger';
import { createWhatsNewAnnouncer, type WhatsNewAnnouncer } from '../../lib/release-notes/announcer';

import { WHATS_NEW_PAGE_PATH, whatsNewPageUrl } from '../../lib/release-notes/page-path';
import { RELEASES } from '../../lib/release-notes/releases';
import {
  FIRST_WINDOW_WAIT_MS,
  pickTabTarget,
  waitForUsableWindow,
  type TabTarget,
  type WindowFacts
} from '../../lib/release-notes/target-window';
import {
  readWhatsNewMarker,
  readWhatsNewOnUpdate,
  writeWhatsNewMarker
} from '../../lib/storage/whats-new';

const log = createLogger('whats-new');

/** The window calls the opening reads (injected for tests). */
export interface WhatsNewTabApi {
  /** The last-focused normal window; rejects when there is none. */
  getLastFocused(): Promise<WindowFacts>;
  /** Every normal window. */
  getAllNormal(): Promise<readonly WindowFacts[]>;
  /** The first usable window the browser creates within `timeoutMs`, else null. */
  waitForWindow(timeoutMs: number): Promise<WindowFacts | null>;
  /** Open a tab in a window. */
  createTab(url: string, windowId: number): Promise<unknown>;
  /** Open a new normal window on the page. */
  createWindow(url: string): Promise<unknown>;
}

/** The real browser calls. */
function realTabApi(): WhatsNewTabApi {
  return {
    getLastFocused: () => browser.windows.getLastFocused({ windowTypes: ['normal'] }),
    getAllNormal: () => browser.windows.getAll({ windowTypes: ['normal'] }),
    waitForWindow: (timeoutMs) =>
      waitForUsableWindow((listener) => {
        browser.windows.onCreated.addListener(listener);
        return () => {
          browser.windows.onCreated.removeListener(listener);
        };
      }, timeoutMs),
    createTab: (url, windowId) => browser.tabs.create({ url, windowId, active: true }),
    createWindow: (url) => browser.windows.create({ url, focused: true })
  };
}

/**
 * Open the page in the target window.
 *
 * @param url The page URL.
 * @param api The window calls.
 * @throws Whatever the browser's create call rejects with (the announcer logs it).
 */
export async function openWhatsNewTab(url: string, api: WhatsNewTabApi): Promise<void> {
  const lastFocused = await api.getLastFocused().catch((cause: unknown) => {
    // No focused normal window (e.g. at browser start): the full list decides.
    log.debug('No last-focused window for the What’s new page', cause);
    return null;
  });
  const all =
    lastFocused !== null && lastFocused.type === 'normal' && !lastFocused.incognito
      ? []
      : await api.getAllNormal();
  const first = pickTabTarget(lastFocused, all);
  const target = first.kind === 'new-window' ? await awaitFirstWindow(api) : first;
  if (target.kind === 'window') await api.createTab(url, target.windowId);
  else await api.createWindow(url);
}

/**
 * With no usable window yet, wait briefly for the browser's first one (e.g.
 * session restore at browser start), then list once more (a window created
 * between the list and the wait), else a new window.
 *
 * @param api The window calls.
 */
async function awaitFirstWindow(api: WhatsNewTabApi): Promise<TabTarget> {
  const created = await api.waitForWindow(FIRST_WINDOW_WAIT_MS);
  return pickTabTarget(created, created === null ? await api.getAllNormal() : []);
}

/**
 * Register the listener and return the start check.
 *
 * @param api The window calls (default the browser's).
 * @returns The announcer's start check, for the background's boot.
 */
export function registerWhatsNew(api: WhatsNewTabApi = realTabApi()): {
  catchUp: () => Promise<void>;
} {
  const announcer: WhatsNewAnnouncer = createWhatsNewAnnouncer({
    currentVersion: browser.runtime.getManifest().version,
    releases: RELEASES,
    readMarker: readWhatsNewMarker,
    writeMarker: writeWhatsNewMarker,
    readEnabled: readWhatsNewOnUpdate,
    openPage: (opening) =>
      openWhatsNewTab(
        whatsNewPageUrl(browser.runtime.getURL(WHATS_NEW_PAGE_PATH), opening.since),
        api
      ),
    log
  });
  browser.runtime.onInstalled.addListener((details) => {
    void announcer.check({
      kind: 'installed',
      reason: details.reason,
      ...(details.previousVersion === undefined ? {} : { previousVersion: details.previousVersion })
    });
  });
  return {
    catchUp: async () => {
      await announcer.check({ kind: 'startup' });
    }
  };
}
