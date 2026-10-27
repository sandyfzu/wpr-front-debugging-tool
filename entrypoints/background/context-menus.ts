/**
 * The context-menu feature: six entries, one click router, and the
 * create-recreate lifecycle that keeps the menus existing across installs,
 * updates, and browser restarts.
 *
 * Owned details other values depend on:
 * - the five page-scoped entries restrict themselves to http/https
 *   documents with the single-sourced URL patterns, so the menus never
 *   surface on browser-internal pages (where the panel features would only
 *   fail anyway);
 * - the click router must know exactly one place per entry — including the
 *   database refresh (whose trigger used to live in two places);
 * - the click event's own `tab` is the target — NOT a re-query of the
 *   active tab, which describes the service worker's current window, not
 *   the window the user was pointing at;
 * - `'all'` includes the toolbar action's own menu, where Firefox sends no
 *   `pageUrl`: page-reading arms fall back to the click tab's `url` (host
 *   permissions expose it), so the action-menu click is never a dead end.
 *
 * The mapping and dispatch are injected-deps functions: the registry's
 * creation rows (`menuCreateParams`) and a click's branch tree
 * (`dispatchMenuClickEvent`) are testable without the extension runtime,
 * and the real `browser.*` calls (send, the overlay opener, the `lastError`
 * acknowledgment) stay a few lines of glue.
 */

import { createLogger } from '../../lib/logger';
import { sendMessage } from '../../lib/messaging';
import { numericTabId } from '../../lib/messaging/sender';
import { CONTEXT_MENU_IDS, URL_PATTERNS, withCacheBypass } from '../../lib/wp-rocket/constants';
import { parseHttpUrl } from '../../utils/urls';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { toggleInspectorOrigin } from '../../lib/storage/inspector-origins';
import { readLastError, type LastErrorSlot } from '../../utils/last-error';
import type { ExclusionOverlayOpenOutcome } from '../../lib/messaging/exclusion-panel';
import { openExclusionOverlay } from './exclusion-overlay';

const log = createLogger('context-menus');

/** What a click on one entry must trigger (pure mapping target). */
export type MenuAction =
  | 'side-by-side'
  | 'psi-side-by-side'
  | 'exclusion-builder'
  | 'refresh-database'
  | 'toggle-detection-widget'
  | 'open-nowprocket';

/** One registered entry: id, label, and where the browser may show it. */
interface MenuEntry {
  action: MenuAction;
  id: string;
  title: string;
  /** Contexts, nonempty as the API requires (all pages or the action icon only). */
  contexts: readonly ['all' | 'action', ...('all' | 'action')[]];
  /** Document URL restriction, required for everything page-scoped. */
  documentUrlPatterns?: readonly string[];
}

/**
 * The complete menu registry — adding an entry is one row here plus its
 * action arm, nothing else. Chromium shows at most 6 top-level rows in the
 * action menu (`ACTION_MENU_TOP_LEVEL_LIMIT`) and drops the rest; the rows
 * reaching it (`'all'` + `'action'`) are exactly 6 — test-pinned.
 */
const MENU_ENTRIES: readonly MenuEntry[] = [
  {
    action: 'side-by-side',
    id: CONTEXT_MENU_IDS.wprSideBySide,
    title: 'Open Side By Side',
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS
  },
  {
    action: 'psi-side-by-side',
    id: CONTEXT_MENU_IDS.psiSideBySide,
    title: 'Open Side By Side Performance',
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS
  },
  {
    action: 'exclusion-builder',
    id: CONTEXT_MENU_IDS.exclusionBuilder,
    title: 'Exclusion Builder',
    // Only from the action's own menu: it opens the builder overlay on the
    // tab's page (a tool for the page as a whole, not for what was clicked).
    contexts: ['action'],
    documentUrlPatterns: URL_PATTERNS
  },
  {
    action: 'refresh-database',
    id: CONTEXT_MENU_IDS.updateKnownConflictsDB,
    title: 'Update Known Conflicts Database',
    contexts: ['action']
  },
  {
    // The per-origin override of the on-page detection widget's global
    // default (default-on; the entry wins) — the same store item the
    // full phase's popup/Detections/options rows will write, so the
    // page-level toggle exists on the pages themselves before those
    // surfaces do. Flipping recomputes from the site's effective state,
    // so every right-click changes the site's visible state.
    action: 'toggle-detection-widget',
    id: CONTEXT_MENU_IDS.toggleDetectionWidget,
    title: 'Toggle the detection widget on this site',
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS
  },
  {
    // Page-scoped: the click's document is what opens bypassed, never the
    // link or image under the pointer.
    action: 'open-nowprocket',
    id: CONTEXT_MENU_IDS.openNowProcket,
    title: 'Open ?nowprocket',
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS
  }
];

/** The exact creation row one registry entry makes into the browser API. */
export interface MenuCreateParams {
  id: string;
  title: string;
  /** Fresh arrays: the browser keeps its own copy of every list. */
  contexts: ['all' | 'action', ...Array<'all' | 'action'>];
  documentUrlPatterns?: string[];
}

/**
 * All creation rows in registry order — the pure half of menu creation, so
 * the id/title/context/document restriction shape is pinned by test, not by
 * reading the glue.
 */
export function menuCreateParams(): MenuCreateParams[] {
  return MENU_ENTRIES.map((entry) => ({
    id: entry.id,
    title: entry.title,
    contexts: [...entry.contexts],
    ...(entry.documentUrlPatterns !== undefined
      ? { documentUrlPatterns: [...entry.documentUrlPatterns] }
      : {})
  }));
}

/**
 * Resolve a click's menu id to the action it triggers. Unknown ids (e.g. a
 * foreign entry row) are simply not ours — null, not an error.
 *
 * @returns The action behind the id, or null for unknown ids.
 */
export function menuActionFor(menuItemId: string | number): MenuAction | null {
  return MENU_ENTRIES.find((entry) => entry.id === menuItemId)?.action ?? null;
}

/**
 * The browser effects a click dispatch performs, injectable so the
 * dispatch's decision surface is unit-testable without the extension
 * runtime; the production binding in `registerContextMenus` keeps the calls
 * themselves a line each.
 */
export interface MenuClickDeps {
  /**
   * Deliver an open-the-panel request to the target tab's content script;
   * rejects when the script is absent (browser-internal pages, cold loads).
   */
  sendToTab(
    type: 'openSideBySide' | 'openSideBySidePerformance',
    /** The two panel channels carry no payload (protocol contract). */
    data: undefined,
    target: { tabId: number }
  ): Promise<unknown>;
  /**
   * Open the exclusion builder overlay on a tab's page; never rejects (the
   * opener logs its own failures).
   */
  openExclusionBuilder(tabId: number): Promise<ExclusionOverlayOpenOutcome>;
  /** The database service's manual-refresh hook (the refresh entry routes here). */
  refreshDatabase(): Promise<DbUpdateResult | null>;
  /**
   * Flip the on-page detection widget's opt-in for one origin (the one
   * toggling semantics the storage module owns); the new state is the
   * persisted truth.
   */
  toggleDetectionWidget(origin: string): Promise<boolean>;
  /**
   * Open a URL in a new, active tab at the given placement (the browser
   * decides each absent key); rejects when the browser refuses.
   */
  openUrl(url: string, placement: MenuTabPlacement): Promise<unknown>;
}

/** The click information the dispatch reads (the page-scoped part only). */
export interface MenuClickInfo {
  menuItemId: string | number;
  /** The clicked document's URL; absent in the action's own menu on Firefox. */
  pageUrl?: string;
}

/** The click event's tab, as far as the dispatch reads it. */
export interface MenuClickTab {
  id?: number;
  incognito?: boolean;
  windowId?: number;
  /** The tab's position in its window (new tabs open right after it). */
  index?: number;
  /** The tab's top-level URL (present with host permissions on the page). */
  url?: string;
}

/**
 * The click information with its document URL resolved: the event's own
 * `pageUrl`, else the click tab's `url` — the action-menu click on Firefox
 * carries no `pageUrl`, while the tab's top-level URL is the same document a
 * page click reports. Link/frame URLs are never consulted.
 *
 * @param info The click's menu information.
 * @param tab The click event's own tab.
 * @returns The same information, `pageUrl` filled from the tab when absent.
 */
export function resolveMenuClickInfo(
  info: MenuClickInfo,
  tab: MenuClickTab | undefined
): MenuClickInfo {
  const pageUrl = info.pageUrl ?? tab?.url;
  return { menuItemId: info.menuItemId, ...(pageUrl === undefined ? {} : { pageUrl }) };
}

/** Where a menu-opened tab is created: beside its source, in its window. */
export interface MenuTabPlacement {
  windowId?: number;
  index?: number;
  /** The source tab; always known (the dispatch has validated its id). */
  openerTabId: number;
}

/**
 * The new tab's placement from the click tab: its window, the slot right
 * after it, and the tab as its opener (same window by construction, as
 * `tabs.create` requires). Absent values are omitted so the browser decides.
 *
 * @param tabId The click tab's validated id.
 * @param tab The click event's own tab.
 * @returns The `tabs.create` placement keys that are known.
 */
export function menuTabPlacement(tabId: number, tab: MenuClickTab | undefined): MenuTabPlacement {
  return {
    ...(tab?.windowId === undefined ? {} : { windowId: tab.windowId }),
    ...(tab?.index === undefined ? {} : { index: tab.index + 1 }),
    openerTabId: tabId
  };
}

/**
 * The origin a click targets, from the click's own document URL (page-scoped
 * menus carry it; the tab-URL fallback can be any scheme). Only http(s)
 * qualifies: other schemes serialize an opaque origin as the string "null",
 * which must never become a stored site key. Unresolvable (absent, malformed,
 * not http(s)) is null — the caller answers visibly instead of guessing a site.
 *
 * @param info The click's menu information.
 * @returns The page's http(s) origin, or null.
 */
export function menuClickOrigin(info: {
  menuItemId: string | number;
  pageUrl?: string;
}): string | null {
  const url = info.pageUrl === undefined ? null : parseHttpUrl(info.pageUrl);
  return url === null ? null : url.origin;
}

/**
 * The cache-bypassed URL a click opens, from the click's own document URL.
 * Only http(s) documents qualify (the menu's URL patterns already restrict
 * it; this gate keeps the decision honest on its own).
 *
 * @param pageUrl The click's document URL, when the event carries one.
 * @returns The URL to open (unchanged when already bypassed), or null when
 *   the document URL is absent, malformed, or not http(s).
 */
export function menuBypassUrl(pageUrl: string | undefined): string | null {
  const url = pageUrl === undefined ? null : parseHttpUrl(pageUrl);
  return url === null ? null : withCacheBypass(url);
}

/**
 * One click handler for every entry: the per-entry branch tree, awaiting the
 * content-script pushes so a missing or not-yet-injected script reports as
 * a real, contextual log line — never a swallowed rejection on the floor.
 *
 * @param action The click's resolved action.
 * @param info The click's menu information, document URL resolved.
 * @param tabId The click event's own tab (validated by the dispatcher).
 * @param tab The same tab object, for properties beyond the id.
 * @param deps The injected browser effects.
 */
async function dispatchMenuClick(
  action: MenuAction,
  info: MenuClickInfo,
  tabId: number,
  tab: MenuClickTab | undefined,
  deps: MenuClickDeps
): Promise<void> {
  switch (action) {
    case 'side-by-side':
    case 'psi-side-by-side': {
      try {
        // A page whose content script is not there (browser-internal pages,
        // error pages) rejects — the expected case, logged visibly.
        await deps.sendToTab(
          action === 'side-by-side' ? 'openSideBySide' : 'openSideBySidePerformance',
          undefined,
          { tabId }
        );
      } catch (cause) {
        log.warn('Side-by-side send failed — content script absent on this page', {
          action,
          tabId,
          cause
        });
      }
      return;
    }
    case 'exclusion-builder': {
      // The opener answers every outcome (and logs the unexpected ones):
      // a page the browser refuses to script simply gets no overlay.
      await deps.openExclusionBuilder(tabId);
      return;
    }
    case 'refresh-database': {
      const result = await deps.refreshDatabase();
      if (result === null) {
        log.warn('Manual database refresh ended without an update');
      }
      return;
    }
    case 'toggle-detection-widget': {
      const origin = menuClickOrigin(info);
      if (origin === null) {
        log.warn('Detection-widget toggle could not resolve the page origin', { tabId });
        return;
      }
      try {
        const enabled = await deps.toggleDetectionWidget(origin);
        log.debug(`The detection widget is ${String(enabled)} for ${origin}`);
      } catch (cause) {
        // A rejected toggle is abnormal (the context is alive): the user's
        // click produced no effect, so it must not vanish at debug level.
        log.error('Toggling the detection widget failed', { origin, cause });
      }
      return;
    }
    case 'open-nowprocket': {
      // The page URL can carry secrets (tokens in the query): logs name the
      // action and tab only.
      const url = menuBypassUrl(info.pageUrl);
      if (url === null) {
        log.warn('Open ?nowprocket ignored: no usable page URL', { action, tabId });
        return;
      }
      try {
        // The click's own window (not the service worker's current one),
        // right after the source tab.
        await deps.openUrl(url, menuTabPlacement(tabId, tab));
      } catch (cause) {
        log.error('Opening the cache-bypassed page failed', { action, tabId, cause });
      }
      return;
    }
  }
}

/**
 * The click event's decision surface: resolve the action, determine the
 * target, and dispatch — with every uninstructable click (foreign ids,
 * tabless events) answered here instead of falling into the dispatch.
 *
 * @param info The click's menu information: its id routes; its `pageUrl`
 *   (resolved against the tab, see {@link resolveMenuClickInfo}) feeds the
 *   page-reading arms.
 * @param tab The click event's own tab.
 * @param deps The injected browser effects.
 */
export async function dispatchMenuClickEvent(
  info: MenuClickInfo,
  tab: MenuClickTab | undefined,
  deps: MenuClickDeps
): Promise<void> {
  const action = menuActionFor(info.menuItemId);
  if (action === null) return;
  const tabId = numericTabId(tab?.id);
  if (tabId === null) {
    // Untracked tabless click (a browser-internal surface): nothing to target.
    log.warn('Menu click ignored: no tab', { action });
    return;
  }
  await dispatchMenuClick(action, resolveMenuClickInfo(info, tab), tabId, tab, deps);
}

/**
 * The create callback's body: the callback is the only place the browser
 * reports a failed or duplicate create, so reading `lastError` here clears
 * it and logs it (success — `undefined` or Firefox's `null` — stays silent).
 *
 * @param id The entry's creation id (log context).
 * @param runtime The runtime whose `lastError` is read.
 * @returns The failure message, or null when the entry was created.
 */
export function reportMenuCreateFailure(id: string, runtime: LastErrorSlot): string | null {
  const failure = readLastError(runtime);
  if (failure !== null) log.warn('Menu entry creation skipped', { id, message: failure });
  return failure;
}

/**
 * Create all registered entries, after clearing whatever exists.
 *
 * Recreating from scratch (instead of upserting) is what keeps extension
 * reloads from failing on duplicate ids: entries persist across the update
 * cycle while the creation id is the same.
 */
async function createMenuEntries(): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
  } catch (cause) {
    log.warn('Clearing existing menu entries failed', cause);
  }
  for (const params of menuCreateParams()) {
    browser.contextMenus.create(params, () => {
      reportMenuCreateFailure(params.id, browser.runtime);
    });
  }
}

/**
 * Register the menu runtime. Runs once: entries are (re)created on the
 * install/update and browser-start lifecycle events, and one click listener
 * routes clicks for the whole registry through the injectable dispatch.
 *
 * @param refreshDatabase The database service's manual-refresh hook (the
 *   update entry routes through it; the service owns the actual update).
 */
export function registerContextMenus(refreshDatabase: () => Promise<DbUpdateResult | null>): void {
  browser.runtime.onInstalled.addListener(() => {
    void createMenuEntries();
  });
  browser.runtime.onStartup.addListener(() => {
    void createMenuEntries();
  });

  const deps: MenuClickDeps = {
    sendToTab: (type, data, target) => sendMessage(type, data, target),
    openExclusionBuilder: (tabId) => openExclusionOverlay(tabId),
    refreshDatabase,
    // The on-page widget's per-origin override writes through the storage
    // module's one toggle — the menu row is the page-context writer; the
    // popup and the options row write the same item later.
    toggleDetectionWidget: toggleInspectorOrigin,
    openUrl: (url, placement) => browser.tabs.create({ url, ...placement })
  };

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void dispatchMenuClickEvent(info, tab, deps).catch((cause: unknown) => {
      log.error('Menu click dispatch failed', { action: info.menuItemId, cause });
    });
  });
}
