/**
 * The context-menu feature: four entries, one click router, and the
 * create-recreate lifecycle that keeps the menus existing across installs,
 * updates, and browser restarts.
 *
 * Owned details other values depend on:
 * - the three page-scoped entries restrict themselves to http/https
 *   documents with the single-sourced URL patterns, so the menus never
 *   surface on browser-internal pages (where the panel features would only
 *   fail anyway);
 * - the click router must know exactly one place per entry — including the
 *   database refresh (whose trigger used to live in two places);
 * - the click event's own `tab` is the target — NOT a re-query of the
 *   active tab, which describes the service worker's current window, not
 *   the window the user was pointing at.
 *
 * The mapping and dispatch are injected-deps functions: the registry's
 * creation rows (`menuCreateParams`) and a click's branch tree
 * (`dispatchMenuClickEvent`) are testable without the extension runtime,
 * and the real `browser.*` calls (send, `tabs.create`, the `lastError`
 * acknowledgment) stay a few lines of glue.
 */

import { createLogger } from '../../lib/logger';
import { sendMessage } from '../../lib/messaging';
import { numericTabId } from '../../lib/messaging/sender';
import {
  CONTEXT_MENU_IDS,
  EXCLUSION_BUILDER_PAGE,
  URL_PATTERNS
} from '../../lib/wp-rocket/constants';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import { toggleInspectorOrigin } from '../../lib/storage/inspector-origins';

const log = createLogger('context-menus');

/** What a click on one entry must trigger (pure mapping target). */
export type MenuAction =
  | 'side-by-side'
  | 'psi-side-by-side'
  | 'exclusion-builder'
  | 'refresh-database'
  | 'toggle-detection-widget';

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
 * action arm, nothing else.
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
    id: CONTEXT_MENU_IDS.exclusionBuilderPage,
    title: 'Exclusion Builder',
    // Only from the action's own menu: the builder page is standalone, it
    // does not belong on arbitrary right-clicks.
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
  /** Open one of this extension's standalone pages, by its packaged path. */
  openTab(pagePath: typeof EXCLUSION_BUILDER_PAGE): Promise<unknown>;
  /** The database service's manual-refresh hook (the refresh entry routes here). */
  refreshDatabase(): Promise<DbUpdateResult | null>;
  /**
   * Flip the on-page detection widget's opt-in for one origin (the one
   * toggling semantics the storage module owns); the new state is the
   * persisted truth.
   */
  toggleDetectionWidget(origin: string): Promise<boolean>;
}

/**
 * The origin a click targets, from the click's own document URL (page-scoped
 * menus carry it). Unresolvable (absent, malformed) is null — the caller
 * answers visibly instead of guessing a site.
 *
 * @param info The click's menu information.
 */
export function menuClickOrigin(info: {
  menuItemId: string | number;
  pageUrl?: string;
}): string | null {
  if (info.pageUrl === undefined) return null;
  try {
    return new URL(info.pageUrl).origin;
  } catch {
    return null;
  }
}

/**
 * One click handler for every entry: the per-entry branch tree, awaiting the
 * content-script pushes so a missing or not-yet-injected script reports as
 * a real, contextual log line — never a swallowed rejection on the floor.
 *
 * @param action The click's resolved action.
 * @param origin The click's document origin, when page-scoped and usable.
 * @param tabId The click event's own tab (validated by the dispatcher).
 * @param tab The same tab object, for properties beyond the id.
 * @param deps The injected browser effects.
 */
async function dispatchMenuClick(
  action: MenuAction,
  origin: string | null,
  tabId: number,
  tab: { incognito?: boolean } | undefined,
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
      try {
        // `tabs.create` requires no permission — opening a tab is a shared
        // browser affordance; failures are runtime defects and get logged.
        await deps.openTab(EXCLUSION_BUILDER_PAGE);
      } catch (cause) {
        log.error('Opening the exclusion builder failed', { tabId, cause });
      }
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
  }
}

/**
 * The click event's decision surface: resolve the action, determine the
 * target, and dispatch — with every uninstructable click (foreign ids,
 * tabless events) answered here instead of falling into the dispatch.
 *
 * @param info The click's menu information (only the id matters here).
 * @param tab The click event's own tab.
 * @param deps The injected browser effects.
 */
export async function dispatchMenuClickEvent(
  info: { menuItemId: string | number; pageUrl?: string },
  tab: { id?: number; incognito?: boolean } | undefined,
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
  await dispatchMenuClick(action, menuClickOrigin(info), tabId, tab, deps);
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
      // The create callback is the only place the browser reports a failed
      // or duplicate create; reading lastError here clears it and logs it.
      if (browser.runtime.lastError !== undefined) {
        log.warn('Menu entry creation skipped', {
          id: params.id,
          message: browser.runtime.lastError.message
        });
      }
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
    openTab: async (pagePath) => {
      await browser.tabs.create({ url: browser.runtime.getURL(pagePath) });
    },
    refreshDatabase,
    // The on-page widget's per-origin override writes through the storage
    // module's one toggle — the menu row is the page-context writer; the
    // popup and the options row write the same item later.
    toggleDetectionWidget: toggleInspectorOrigin
  };

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void dispatchMenuClickEvent(info, tab, deps).catch((cause: unknown) => {
      log.error('Menu click dispatch failed', { action: info.menuItemId, cause });
    });
  });
}
