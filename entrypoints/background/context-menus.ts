/**
 * The context-menu feature: eight entries, one click router, the
 * create-recreate lifecycle that keeps the menus existing across installs,
 * updates, and browser restarts, and the on-page UI gate's reflection in
 * them (see `./menu-gate`).
 *
 * Owned details other values depend on:
 * - every entry except the database refresh restricts itself to http/https
 *   documents with the single-sourced URL patterns, so the menus never
 *   surface on browser-internal pages (where the panel features would only
 *   fail anyway);
 * - while on-page UI is off, the entries that would open or change on-page
 *   UI are disabled and the gate entry turns into the rescue ("Turn on all
 *   on-page UI") — the menu lives in browser chrome, outside the gate, so it
 *   is the way back on;
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
import {
  PAGE_CONTENT_CONTEXTS,
  platformMenuContexts,
  type MenuContext,
  type NonEmpty,
  type PlatformMenuContext
} from './menu-contexts';
import { PAGE_UI_GATE_RESCUE_LABEL, pageCommandLabel } from '../../lib/page-commands/commands';
import {
  PAGE_UI_GATE_DEFAULT,
  readPageUiEnabled,
  setPageUiGate,
  watchPageUiGate
} from '../../lib/storage/page-ui-gate';
import { createMenuGateFollower, type MenuRowUpdate } from './menu-gate';

const log = createLogger('context-menus');

/** What a click on one entry must trigger (pure mapping target). */
export type MenuAction =
  | 'side-by-side'
  | 'psi-side-by-side'
  | 'exclusion-builder'
  | 'refresh-database'
  | 'toggle-detection-widget'
  | 'open-nowprocket'
  | 'open-command-palette'
  | 'page-ui-gate';

/**
 * What an entry does while on-page UI is off: stays as is (it opens or
 * changes no on-page UI), turns disabled (its effect would be on-page UI the
 * gate hides), or keeps working under another title (the gate entry's
 * rescue direction).
 */
export type WhileUiOff = 'keep' | 'disable' | { readonly retitle: string };

/**
 * One registered entry: id, label, and where the browser may show it. The
 * on-page commands' labels come from their one declaring site
 * (`lib/page-commands`); the menu-native fields stay here.
 */
interface MenuEntry {
  action: MenuAction;
  id: string;
  title: string;
  /**
   * Contexts, nonempty as the API requires (all pages or the action icon
   * only) — browser-agnostic names, translated at creation.
   */
  contexts: readonly [MenuContext, ...MenuContext[]];
  /** Document URL restriction, required for everything page-scoped. */
  documentUrlPatterns?: readonly string[];
  /** The entry's state while on-page UI is off (it is created in that state too). */
  whileUiOff: WhileUiOff;
}

/**
 * The complete menu registry — adding an entry is one row here plus its
 * action arm, nothing else. Chromium and Firefox both show at most 6
 * top-level rows in the action menu (`ACTION_MENU_TOP_LEVEL_LIMIT`) and drop
 * the rest; the rows reaching it (`'all'` + `'action'`) are exactly 6 —
 * test-pinned — so new page-only rows name {@link PAGE_CONTENT_CONTEXTS}
 * (which never include that menu) instead of `'all'`.
 */
const MENU_ENTRIES: readonly MenuEntry[] = [
  {
    action: 'side-by-side',
    id: CONTEXT_MENU_IDS.wprSideBySide,
    title: pageCommandLabel('side-by-side'),
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS,
    whileUiOff: 'disable'
  },
  {
    action: 'psi-side-by-side',
    id: CONTEXT_MENU_IDS.psiSideBySide,
    title: pageCommandLabel('psi-side-by-side'),
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS,
    whileUiOff: 'disable'
  },
  {
    action: 'exclusion-builder',
    id: CONTEXT_MENU_IDS.exclusionBuilder,
    title: pageCommandLabel('exclusion-builder'),
    // Only from the action's own menu: it opens the builder overlay on the
    // tab's page (a tool for the page as a whole, not for what was clicked).
    contexts: ['action'],
    documentUrlPatterns: URL_PATTERNS,
    whileUiOff: 'disable'
  },
  {
    action: 'refresh-database',
    id: CONTEXT_MENU_IDS.updateKnownConflictsDB,
    title: 'Update Known Conflicts Database',
    contexts: ['action'],
    whileUiOff: 'keep'
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
    title: pageCommandLabel('toggle-detection-widget'),
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS,
    // The widget it shows or hides is on-page UI: a flip would change nothing visible.
    whileUiOff: 'disable'
  },
  {
    // Page-scoped: the click's document is what opens bypassed, never the
    // link or image under the pointer.
    action: 'open-nowprocket',
    id: CONTEXT_MENU_IDS.openNowProcket,
    title: pageCommandLabel('open-nowprocket'),
    contexts: ['all'],
    documentUrlPatterns: URL_PATTERNS,
    // A new browser tab, not on-page UI: the gate does not reach it.
    whileUiOff: 'keep'
  },
  {
    // Page-only: the palette opens over the page that was right-clicked.
    action: 'open-command-palette',
    id: CONTEXT_MENU_IDS.openCommandPalette,
    title: pageCommandLabel('open-command-palette'),
    contexts: PAGE_CONTENT_CONTEXTS,
    documentUrlPatterns: URL_PATTERNS,
    whileUiOff: 'disable'
  },
  {
    // The master switch; while off it is the rescue — the one way back on
    // from the page itself, so it is never disabled.
    action: 'page-ui-gate',
    id: CONTEXT_MENU_IDS.pageUiGate,
    title: pageCommandLabel('page-ui-gate'),
    contexts: PAGE_CONTENT_CONTEXTS,
    documentUrlPatterns: URL_PATTERNS,
    whileUiOff: { retitle: PAGE_UI_GATE_RESCUE_LABEL }
  }
];

/** The exact creation row one registry entry makes into the browser API. */
export interface MenuCreateParams {
  id: string;
  title: string;
  /** Fresh arrays: the browser keeps its own copy of every list. */
  contexts: NonEmpty<MenuContext>;
  documentUrlPatterns?: string[];
  /** Present (false) only for an entry created disabled — absent means enabled. */
  enabled?: false;
}

/** A creation row with its contexts named as the running platform expects. */
export interface PlatformMenuCreateParams extends Omit<MenuCreateParams, 'contexts'> {
  contexts: NonEmpty<PlatformMenuContext>;
}

/** An entry's title and enabled state for a gate value. */
interface MenuEntryState {
  title: string;
  enabled: boolean;
}

/**
 * Resolve one entry under the on-page UI gate: on, every entry is itself;
 * off, its {@link WhileUiOff} decides.
 *
 * @param entry The registry entry.
 * @param uiEnabled The on-page UI gate.
 */
function entryState(entry: MenuEntry, uiEnabled: boolean): MenuEntryState {
  if (uiEnabled || entry.whileUiOff === 'keep') return { title: entry.title, enabled: true };
  if (entry.whileUiOff === 'disable') return { title: entry.title, enabled: false };
  return { title: entry.whileUiOff.retitle, enabled: true };
}

/**
 * All creation rows in registry order — the pure half of menu creation, so
 * the id/title/context/document restriction shape is pinned by test, not by
 * reading the glue. Rows are created in the gate's state, so a recreation
 * never shows a stale title or a live entry the gate has turned off.
 *
 * @param uiEnabled The on-page UI gate (on by default — the rows then carry
 *   no `enabled` key: enabled is the API's default).
 */
export function menuCreateParams(uiEnabled: boolean = PAGE_UI_GATE_DEFAULT): MenuCreateParams[] {
  return MENU_ENTRIES.map((entry) => {
    const state = entryState(entry, uiEnabled);
    return {
      id: entry.id,
      title: state.title,
      contexts: [...entry.contexts],
      ...(entry.documentUrlPatterns !== undefined
        ? { documentUrlPatterns: [...entry.documentUrlPatterns] }
        : {}),
      ...(state.enabled ? {} : { enabled: false as const })
    };
  });
}

/**
 * The live edits that bring created rows to a gate value: one per entry the
 * gate reaches (its title or its enabled state), registry order; entries
 * that stay as they are produce none.
 *
 * @param uiEnabled The on-page UI gate to reflect.
 * @returns The `contextMenus.update` calls to make.
 */
export function menuGateUpdates(uiEnabled: boolean): MenuRowUpdate[] {
  return MENU_ENTRIES.flatMap((entry): MenuRowUpdate[] => {
    if (entry.whileUiOff === 'keep') return [];
    const state = entryState(entry, uiEnabled);
    return [
      {
        id: entry.id,
        props: entry.whileUiOff === 'disable' ? { enabled: state.enabled } : { title: state.title }
      }
    ];
  });
}

/**
 * The creation rows translated for a manifest version: registry order and
 * shape, contexts renamed per {@link platformMenuContexts} (identity on
 * Manifest V3 — those rows equal {@link menuCreateParams}). Pure; the
 * runtime calls it only from Manifest V2 builds (see
 * {@link buildMenuCreateParams}).
 *
 * @param manifestVersion The target manifest's `manifest_version`.
 * @param uiEnabled The on-page UI gate (see {@link menuCreateParams}).
 * @returns One row per registry entry.
 * @throws {@link RangeError} For an unsupported manifest version.
 */
export function platformMenuCreateParams(
  manifestVersion: number,
  uiEnabled: boolean = PAGE_UI_GATE_DEFAULT
): PlatformMenuCreateParams[] {
  return menuCreateParams(uiEnabled).map((params) => ({
    ...params,
    contexts: platformMenuContexts(params.contexts, manifestVersion)
  }));
}

/**
 * The creation rows this build hands the browser. The manifest version is a
 * build-time constant equal to the shipped manifest's, so the Manifest V2
 * translation (and its context table) exists only in Manifest V2 bundles;
 * Manifest V3 bundles create the registry rows untouched.
 *
 * @param uiEnabled The on-page UI gate (see {@link menuCreateParams}).
 * @returns One row per registry entry, contexts named for this build.
 */
export function buildMenuCreateParams(
  uiEnabled: boolean = PAGE_UI_GATE_DEFAULT
): PlatformMenuCreateParams[] {
  return import.meta.env.MANIFEST_VERSION === 2
    ? platformMenuCreateParams(2, uiEnabled)
    : menuCreateParams(uiEnabled);
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
    type: TabRequestChannel,
    /** The tab-request channels carry no payload (protocol contract). */
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
  /**
   * Flip the on-page UI gate to the direction the gate entry's title offers;
   * resolves with the written value, rejects when the write fails.
   */
  togglePageUiGate(): Promise<boolean>;
}

/** The tab-targeted, payload-less channels a menu click may send. */
export type TabRequestChannel =
  'openSideBySide' | 'openSideBySidePerformance' | 'openCommandPalette';

/** The entries whose click is one request to the clicked tab's content script. */
type TabRequestAction = 'side-by-side' | 'psi-side-by-side' | 'open-command-palette';

/**
 * Each tab-request entry's channel and the warning a refused send logs (no
 * receiver: browser-internal or error pages, a not-yet-injected script; for
 * the palette also a page whose on-page UI is off — its receiver is gone).
 */
const TAB_REQUESTS: Readonly<
  Record<TabRequestAction, { channel: TabRequestChannel; failure: string }>
> = {
  'side-by-side': {
    channel: 'openSideBySide',
    failure: 'Side-by-side send failed — content script absent on this page'
  },
  'psi-side-by-side': {
    channel: 'openSideBySidePerformance',
    failure: 'Side-by-side send failed — content script absent on this page'
  },
  'open-command-palette': {
    channel: 'openCommandPalette',
    failure: 'Command palette send failed — content script absent or on-page UI off on this page'
  }
};

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
    case 'psi-side-by-side':
    case 'open-command-palette': {
      const request = TAB_REQUESTS[action];
      try {
        // A page without a receiver rejects — the expected case, logged visibly.
        await deps.sendToTab(request.channel, undefined, { tabId });
      } catch (cause) {
        log.warn(request.failure, { action, tabId, cause });
      }
      return;
    }
    case 'page-ui-gate': {
      try {
        const enabled = await deps.togglePageUiGate();
        log.debug(`On-page UI is ${enabled ? 'on' : 'off'}`);
      } catch (cause) {
        // The click produced no effect: error level, like the widget toggle.
        log.error('Switching on-page UI failed', { action, tabId, cause });
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

/** The browser's `contextMenus.create`, as far as row creation calls it. */
export type MenuCreateFn = (params: PlatformMenuCreateParams, callback: () => void) => unknown;

/**
 * Create each row independently: a row the browser refuses synchronously
 * (e.g. a context name it rejects) is logged with its id and cause and never
 * stops the rows after it; asynchronous failures arrive through the create
 * callback's `lastError`, read by {@link reportMenuCreateFailure}.
 *
 * @param rows The creation rows, in registry order.
 * @param create The browser's create call.
 * @param runtime The runtime whose `lastError` each callback reads.
 * @returns The ids of the rows whose create threw (empty when none did).
 */
export function createMenuRows(
  rows: readonly PlatformMenuCreateParams[],
  create: MenuCreateFn,
  runtime: LastErrorSlot
): string[] {
  const refused: string[] = [];
  for (const params of rows) {
    try {
      create(params, () => {
        reportMenuCreateFailure(params.id, runtime);
      });
    } catch (cause) {
      refused.push(params.id);
      log.error('Menu entry creation refused', { id: params.id, cause });
    }
  }
  return refused;
}

/**
 * Create all registered entries in the gate's state, after clearing whatever
 * exists.
 *
 * Recreating from scratch (instead of upserting) is what keeps extension
 * reloads from failing on duplicate ids: entries persist across the update
 * cycle while the creation id is the same.
 *
 * @param uiEnabled The on-page UI gate the rows are created for.
 */
async function createMenuEntries(uiEnabled: boolean): Promise<void> {
  try {
    await browser.contextMenus.removeAll();
  } catch (cause) {
    log.warn('Clearing existing menu entries failed', cause);
  }
  createMenuRows(
    buildMenuCreateParams(uiEnabled),
    (params, callback) => browser.contextMenus.create(params, callback),
    browser.runtime
  );
}

/**
 * Register the menu runtime. Runs once: entries are (re)created on the
 * install/update and browser-start lifecycle events in the on-page UI gate's
 * state, the gate is followed live (watch armed before the boot read), and
 * one click listener routes clicks for the whole registry through the
 * injectable dispatch.
 *
 * @param refreshDatabase The database service's manual-refresh hook (the
 *   update entry routes through it; the service owns the actual update).
 */
export function registerContextMenus(refreshDatabase: () => Promise<DbUpdateResult | null>): void {
  const gate = createMenuGateFollower({
    readGate: readPageUiEnabled,
    watchGate: watchPageUiGate,
    writeGate: setPageUiGate,
    recreate: createMenuEntries,
    updatesFor: menuGateUpdates,
    // Promise form on both browsers: a missing id rejects (the follower
    // recreates rows not yet known to exist, else warns per row).
    update: (id, props) => browser.contextMenus.update(id, props)
  });
  const recreate = (): void => {
    gate.recreate();
  };
  browser.runtime.onInstalled.addListener(recreate);
  browser.runtime.onStartup.addListener(recreate);

  const deps: MenuClickDeps = {
    sendToTab: (type, data, target) => sendMessage(type, data, target),
    openExclusionBuilder: (tabId) => openExclusionOverlay(tabId),
    refreshDatabase,
    // The on-page widget's per-origin override writes through the storage
    // module's one toggle — the menu row is the page-context writer; the
    // popup and the options row write the same item later.
    toggleDetectionWidget: toggleInspectorOrigin,
    openUrl: (url, placement) => browser.tabs.create({ url, ...placement }),
    togglePageUiGate: () => gate.toggle()
  };

  browser.contextMenus.onClicked.addListener((info, tab) => {
    void dispatchMenuClickEvent(info, tab, deps).catch((cause: unknown) => {
      log.error('Menu click dispatch failed', { action: info.menuItemId, cause });
    });
  });

  // Never rejects: a failed boot read is logged and the menus keep their state.
  void gate.start();
}
