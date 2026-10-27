/**
 * The menu registry's two pure surfaces: the routing contract (every
 * registered id maps to exactly one action) and — pinned exactly — the
 * creation rows the browser receives, plus the click dispatch's per-entry
 * decision tree over injected effects (the real `browser.*` calls stay glue
 * and are never reached by these tests).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { CONTEXT_MENU_IDS, URL_PATTERNS } from '../../lib/wp-rocket/constants';
import type { DbUpdateResult } from '../../lib/messaging/validate';
import {
  dispatchMenuClickEvent,
  menuActionFor,
  menuBypassUrl,
  menuClickOrigin,
  createMenuRows,
  menuCreateParams,
  menuTabPlacement,
  platformMenuCreateParams,
  reportMenuCreateFailure,
  resolveMenuClickInfo,
  type MenuClickDeps,
  type MenuTabPlacement,
  type PlatformMenuCreateParams
} from './context-menus';

/** The dockerized site's origin (the e2e site's URL host form in unit tests). */
const SITE = 'http://127.0.0.1:8493';

/**
 * Chromium's action-menu cap on top-level rows (it drops the rest). Not
 * reachable at runtime here (no extension context), so it is typed by the
 * installed declaration's literal: a changed cap fails compilation.
 */
const ACTION_MENU_TOP_LEVEL_LIMIT: typeof Browser.contextMenus.ACTION_MENU_TOP_LEVEL_LIMIT = 6;

describe('resolveMenuClickInfo', () => {
  it("keeps the event's own pageUrl over the tab URL", () => {
    expect(
      resolveMenuClickInfo(
        { menuItemId: 1, pageUrl: `${SITE}/page/` },
        { id: 4, url: `${SITE}/other/` }
      )
    ).toEqual({ menuItemId: 1, pageUrl: `${SITE}/page/` });
  });

  it("falls back to the tab URL when the event has none (Firefox's action menu)", () => {
    expect(resolveMenuClickInfo({ menuItemId: 1 }, { id: 4, url: `${SITE}/tab/` })).toEqual({
      menuItemId: 1,
      pageUrl: `${SITE}/tab/`
    });
  });

  it('leaves pageUrl absent when neither carries one, and drops link/frame URLs', () => {
    expect(resolveMenuClickInfo({ menuItemId: 1 }, { id: 4 })).toEqual({ menuItemId: 1 });
    expect(resolveMenuClickInfo({ menuItemId: 1 }, undefined)).toEqual({ menuItemId: 1 });
    const info = { menuItemId: 1, linkUrl: `${SITE}/link/`, frameUrl: `${SITE}/frame/` };
    expect(resolveMenuClickInfo(info, { id: 4 })).toEqual({ menuItemId: 1 });
  });
});

describe('menuTabPlacement', () => {
  it('opens right after the source tab, in its window, with it as opener', () => {
    expect(menuTabPlacement(4, { id: 4, windowId: 12, index: 2 })).toEqual({
      windowId: 12,
      index: 3,
      openerTabId: 4
    });
    // The first slot's neighbor is index 1, not a falsy-skipped 0.
    expect(menuTabPlacement(4, { id: 4, windowId: 0, index: 0 })).toEqual({
      windowId: 0,
      index: 1,
      openerTabId: 4
    });
  });

  it('omits unknown keys so the browser decides them', () => {
    const placement = menuTabPlacement(4, { id: 4 });
    expect(placement).toEqual({ openerTabId: 4 });
    expect(Object.keys(placement)).toEqual(['openerTabId']);
    expect(Object.keys(menuTabPlacement(4, undefined))).toEqual(['openerTabId']);
  });
});

describe('menuClickOrigin', () => {
  it('derives the origin from the click document URL, without the path', () => {
    expect(
      menuClickOrigin({
        menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget,
        pageUrl: `${SITE}/fdt/`
      })
    ).toBe(SITE);
  });

  it('answers null for an absent or unparseable document URL', () => {
    expect(menuClickOrigin({ menuItemId: 42 })).toBeNull();
    expect(menuClickOrigin({ menuItemId: 42, pageUrl: 'not a url ?%' })).toBeNull();
  });

  it('answers null for non-http(s) documents (their origin serializes as "null")', () => {
    for (const pageUrl of ['chrome://extensions/', 'about:blank', 'moz-extension://abc/p.html']) {
      expect(menuClickOrigin({ menuItemId: 42, pageUrl })).toBeNull();
    }
  });
});

describe('menuBypassUrl', () => {
  it('adds the bypass to the click document URL, query and fragment kept', () => {
    expect(menuBypassUrl(`${SITE}/fdt/`)).toBe(`${SITE}/fdt/?nowprocket`);
    expect(menuBypassUrl(`${SITE}/fdt/?a=b#h`)).toBe(`${SITE}/fdt/?a=b&nowprocket#h`);
    expect(menuBypassUrl('https://example.test/?q=a%20b')).toBe(
      'https://example.test/?q=a%20b&nowprocket'
    );
  });

  it('appends the bypass when only a look-alike parameter is present', () => {
    // Parameter names are case-sensitive and matched whole.
    expect(menuBypassUrl(`${SITE}/?NOWPROCKET=1`)).toBe(`${SITE}/?NOWPROCKET=1&nowprocket`);
    expect(menuBypassUrl(`${SITE}/?xnowprocket=1`)).toBe(`${SITE}/?xnowprocket=1&nowprocket`);
  });

  it('opens an already-bypassed document unchanged (=0 and array forms included)', () => {
    for (const href of [
      `${SITE}/?nowprocket`,
      `${SITE}/?nowprocket=1#h`,
      `${SITE}/?nowprocket=0`,
      `${SITE}/?a=1&nowprocket[]=1`
    ]) {
      expect(menuBypassUrl(href), href).toBe(href);
    }
  });

  it('answers null for absent, relative, malformed or non-http(s) document URLs', () => {
    for (const pageUrl of [
      undefined,
      '',
      '/relative?a=1',
      'not a url ?%',
      'chrome://extensions/',
      'file:///tmp/page.html',
      'javascript:alert(1)',
      'data:text/html,hi'
    ]) {
      expect(menuBypassUrl(pageUrl), String(pageUrl)).toBeNull();
    }
  });
});

describe('menuActionFor', () => {
  it('routes each registered entry to its action and its action only', () => {
    expect(menuActionFor(CONTEXT_MENU_IDS.wprSideBySide)).toBe('side-by-side');
    expect(menuActionFor(CONTEXT_MENU_IDS.psiSideBySide)).toBe('psi-side-by-side');
    expect(menuActionFor(CONTEXT_MENU_IDS.exclusionBuilder)).toBe('exclusion-builder');
    expect(menuActionFor(CONTEXT_MENU_IDS.updateKnownConflictsDB)).toBe('refresh-database');
    expect(menuActionFor(CONTEXT_MENU_IDS.toggleDetectionWidget)).toBe('toggle-detection-widget');
    expect(menuActionFor(CONTEXT_MENU_IDS.openNowProcket)).toBe('open-nowprocket');
  });

  it('leaves foreign or numeric ids unrouted', () => {
    expect(menuActionFor('something-else')).toBeNull();
    expect(menuActionFor(42)).toBeNull();
  });
});

describe('reportMenuCreateFailure', () => {
  it('stays silent on both success spellings (Chromium undefined, Firefox null)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(reportMenuCreateFailure('entry', {})).toBeNull();
      expect(reportMenuCreateFailure('entry', { lastError: undefined })).toBeNull();
      // Firefox's success value: a dereference here used to throw.
      expect(reportMenuCreateFailure('entry', { lastError: null })).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('logs and answers a failed create with its entry id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(reportMenuCreateFailure('entry', { lastError: { message: 'Duplicate id' } })).toBe(
        'Duplicate id'
      );
      expect(warn).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu entry creation skipped', {
        id: 'entry',
        message: 'Duplicate id'
      });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('menuCreateParams', () => {
  it('hands the browser exactly one row per entry, with the page-scoped restriction', () => {
    // Every property pinned: id, title, contexts, and the document pattern
    // restriction that keeps page entries off browser-internal pages (the
    // action-only refresh entry carries none).
    expect(menuCreateParams()).toEqual([
      {
        id: CONTEXT_MENU_IDS.wprSideBySide,
        title: 'Open Side By Side',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.psiSideBySide,
        title: 'Open Side By Side Performance',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.exclusionBuilder,
        title: 'Exclusion Builder',
        contexts: ['action'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.updateKnownConflictsDB,
        title: 'Update Known Conflicts Database',
        contexts: ['action']
      },
      {
        id: CONTEXT_MENU_IDS.toggleDetectionWidget,
        title: 'Toggle the detection widget on this site',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.openNowProcket,
        title: 'Open ?nowprocket',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      }
    ]);
  });

  it("keeps the action menu's top-level rows within Chromium's cap", () => {
    // Every row reaches it: the registry admits only 'all' (which includes
    // the action menu) and 'action' contexts, all top-level.
    expect(menuCreateParams().length).toBeLessThanOrEqual(ACTION_MENU_TOP_LEVEL_LIMIT);
  });
});

describe('platformMenuCreateParams', () => {
  it('hands a Manifest V3 browser exactly the registry rows (Chromium unchanged)', () => {
    // Pinned literally, not derived: ids, titles, contexts, patterns, order
    // and key order are what the Chromium build has always created.
    const rows = platformMenuCreateParams(3);
    expect(rows).toEqual([
      {
        id: CONTEXT_MENU_IDS.wprSideBySide,
        title: 'Open Side By Side',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.psiSideBySide,
        title: 'Open Side By Side Performance',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.exclusionBuilder,
        title: 'Exclusion Builder',
        contexts: ['action'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.updateKnownConflictsDB,
        title: 'Update Known Conflicts Database',
        contexts: ['action']
      },
      {
        id: CONTEXT_MENU_IDS.toggleDetectionWidget,
        title: 'Toggle the detection widget on this site',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      },
      {
        id: CONTEXT_MENU_IDS.openNowProcket,
        title: 'Open ?nowprocket',
        contexts: ['all'],
        documentUrlPatterns: [...URL_PATTERNS]
      }
    ]);
    expect(rows).toEqual(menuCreateParams());
    expect(rows.map((row) => Object.keys(row))).toEqual(
      menuCreateParams().map((row) => Object.keys(row))
    );
    expect(JSON.stringify(rows)).not.toContain('browser_action');
  });

  it("names the toolbar rows 'browser_action' on Manifest V2, all else unchanged", () => {
    const rows = platformMenuCreateParams(2);
    const expected = menuCreateParams().map((row) => ({
      ...row,
      contexts: row.contexts.map((context) => (context === 'action' ? 'browser_action' : context))
    }));
    expect(rows).toEqual(expected);
    expect(
      rows.filter((row) => row.contexts.includes('browser_action')).map((row) => row.id)
    ).toEqual([CONTEXT_MENU_IDS.exclusionBuilder, CONTEXT_MENU_IDS.updateKnownConflictsDB]);
    expect(JSON.stringify(rows)).not.toContain('"action"');
  });

  it('refuses an unsupported manifest version', () => {
    expect(() => platformMenuCreateParams(1)).toThrow(RangeError);
  });
});

describe('createMenuRows', () => {
  /** A create stub recording each call; `throwFor` ids throw synchronously. */
  function stubCreate(throwFor: readonly string[] = []): {
    create: (params: PlatformMenuCreateParams, callback: () => void) => void;
    created: string[];
    callbacks: Array<() => void>;
  } {
    const created: string[] = [];
    const callbacks: Array<() => void> = [];
    return {
      created,
      callbacks,
      create: (params, callback) => {
        if (throwFor.includes(params.id)) throw new Error(`Bad context for ${params.id}`);
        created.push(params.id);
        callbacks.push(callback);
      }
    };
  }

  it('creates every row in order and reports nothing refused', () => {
    const stub = stubCreate();
    const rows = platformMenuCreateParams(3);
    expect(createMenuRows(rows, stub.create, {})).toEqual([]);
    expect(stub.created).toEqual(rows.map((row) => row.id));
  });

  it('keeps creating the rows after one that throws, logging its id and cause', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const rows = platformMenuCreateParams(3);
      const stub = stubCreate([CONTEXT_MENU_IDS.exclusionBuilder]);
      expect(createMenuRows(rows, stub.create, {})).toEqual([CONTEXT_MENU_IDS.exclusionBuilder]);
      expect(stub.created).toEqual(
        rows.map((row) => row.id).filter((id) => id !== CONTEXT_MENU_IDS.exclusionBuilder)
      );
      expect(error).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu entry creation refused', {
        id: CONTEXT_MENU_IDS.exclusionBuilder,
        cause: new Error(`Bad context for ${CONTEXT_MENU_IDS.exclusionBuilder}`)
      });
    } finally {
      error.mockRestore();
    }
  });

  it("reads each row's lastError in its own callback, with that row's id", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const runtime: { lastError?: { message: string } | null } = {};
      const stub = stubCreate();
      const rows = platformMenuCreateParams(2);
      createMenuRows(rows, stub.create, runtime);
      // Success on Firefox's spelling stays silent.
      runtime.lastError = null;
      stub.callbacks[0]?.();
      expect(warn).not.toHaveBeenCalled();
      runtime.lastError = { message: 'Duplicate id' };
      stub.callbacks[3]?.();
      expect(warn).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu entry creation skipped', {
        id: rows[3]?.id,
        message: 'Duplicate id'
      });
    } finally {
      warn.mockRestore();
    }
  });
});

/** The recording deps: every glue effect lands in one of these observables. */
interface Recorded {
  sent: Array<{ type: string; target: { tabId: number } }>;
  /** Tabs the exclusion builder overlay was opened on. */
  opened: number[];
  refreshes: number;
  toggles: string[];
  /** The rejection the next toggle inside throws (undefined: it resolves). */
  toggleFailure?: Error;
  /** URLs opened in a new tab, with the window they targeted. */
  openedUrls: Array<{ url: string; windowId: number | undefined }>;
  /** Each opened tab's full placement, in open order. */
  placements: MenuTabPlacement[];
}

function recordingDeps(): { deps: MenuClickDeps; recorded: Recorded } {
  const recorded: Recorded = {
    sent: [],
    opened: [],
    refreshes: 0,
    toggles: [],
    openedUrls: [],
    placements: []
  };
  const deps: MenuClickDeps = {
    sendToTab: (type, data, target) => {
      recorded.sent.push({ type, target });
      return Promise.resolve(true);
    },
    openExclusionBuilder: (tabId) => {
      recorded.opened.push(tabId);
      return Promise.resolve('injected');
    },
    refreshDatabase: (): Promise<DbUpdateResult | null> => {
      recorded.refreshes += 1;
      return Promise.resolve({ updatedAt: 1 });
    },
    toggleDetectionWidget: (origin) => {
      recorded.toggles.push(origin);
      if (recorded.toggleFailure !== undefined) {
        return Promise.reject(recorded.toggleFailure);
      }
      // The storage module owns the flip; the recording answers its
      // regression shape: an unknown origin's first flip enables.
      return Promise.resolve(true);
    },
    openUrl: (url, placement) => {
      recorded.openedUrls.push({ url, windowId: placement.windowId });
      recorded.placements.push(placement);
      return Promise.resolve({ id: 100 });
    }
  };
  return { deps, recorded };
}

/** The click's warning half is console output (the shared logger) — silenced. */
function spyMenuWarnings(): { sawWarning(fragment: string): boolean; restore(): void } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  return {
    sawWarning: (fragment) => spy.mock.calls.some((call) => String(call[0]).includes(fragment)),
    restore: () => {
      spy.mockRestore();
    }
  };
}

describe('dispatchMenuClickEvent', () => {
  it('routes the side-by-side entry to its channel, on the clicked tab', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.wprSideBySide },
      { id: 9, incognito: false },
      deps
    );
    expect(recorded.sent).toEqual([{ type: 'openSideBySide', target: { tabId: 9 } }]);
    expect(recorded.opened).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('the PSI entry targets its own channel and tab, not the plain one', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.psiSideBySide }, { id: 9 }, deps);
    expect(recorded.sent).toEqual([{ type: 'openSideBySidePerformance', target: { tabId: 9 } }]);
    expect(recorded.opened).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('a missing content script (browser-internal page) logs visibly and resolves', async () => {
    const { deps, recorded } = recordingDeps();
    deps.sendToTab = (): Promise<never> =>
      Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
    const warnings = spyMenuWarnings();
    try {
      // The expected, visible failure branch — never an escaping rejection.
      await expect(
        dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.wprSideBySide }, { id: 3 }, deps)
      ).resolves.toBeUndefined();
      expect(warnings.sawWarning('Side-by-side send failed')).toBe(true);
      expect(recorded.opened).toHaveLength(0);
      expect(recorded.refreshes).toBe(0);
    } finally {
      warnings.restore();
    }
  });

  it('the exclusion builder entry opens the overlay on the clicked tab', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.exclusionBuilder },
      { id: 7 },
      deps
    );
    expect(recorded.opened).toEqual([7]);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('a page the browser refuses to script resolves quietly (no overlay, no throw)', async () => {
    const { deps, recorded } = recordingDeps();
    deps.openExclusionBuilder = (tabId) => {
      recorded.opened.push(tabId);
      return Promise.resolve('unsupported-page');
    };
    await expect(
      dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.exclusionBuilder }, { id: 4 }, deps)
    ).resolves.toBeUndefined();
    expect(recorded.opened).toEqual([4]);
  });

  it('the exclusion builder opens from private windows too (owner ditched the skip)', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.exclusionBuilder },
      { id: 7, incognito: true },
      deps
    );
    // An owner decision (2026-10-08) ditched the parity skip for private
    // windows — the overlay opens on a private window's page like any other.
    expect(recorded.opened).toEqual([7]);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('the refresh entry triggers the shared database hook once', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.updateKnownConflictsDB },
      { id: 2 },
      deps
    );
    expect(recorded.refreshes).toBe(1);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.opened).toHaveLength(0);
  });

  it('a tabless click is a logged no-op: nothing to target, nothing called', async () => {
    const { deps, recorded } = recordingDeps();
    const warnings = spyMenuWarnings();
    try {
      await dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.psiSideBySide }, undefined, deps);
      expect(recorded.sent).toHaveLength(0);
      expect(recorded.opened).toHaveLength(0);
      expect(recorded.refreshes).toBe(0);
      expect(warnings.sawWarning('Menu click ignored')).toBe(true);
    } finally {
      warnings.restore();
    }
  });

  it('an unusable tab reference (not a tab id) takes the same ignored path', async () => {
    const { deps, recorded } = recordingDeps();
    const warnings = spyMenuWarnings();
    try {
      await dispatchMenuClickEvent(
        { menuItemId: CONTEXT_MENU_IDS.updateKnownConflictsDB },
        { id: -1 },
        deps
      );
      expect(recorded.refreshes).toBe(0);
      expect(recorded.sent).toHaveLength(0);
      expect(recorded.opened).toHaveLength(0);
    } finally {
      warnings.restore();
    }
  });

  it('foreign menu ids dispatch nothing at all', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent({ menuItemId: 'foreign-ext:menu' }, { id: 5 }, deps);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.opened).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
    expect(recorded.toggles).toHaveLength(0);
  });

  it('the detection-widget toggle writes the click document origin', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget, pageUrl: `${SITE}/fdt/` },
      { id: 4 },
      deps
    );
    expect(recorded.toggles).toEqual([SITE]);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('a toggle click whose document origin is unresolvable is a logged no-op', async () => {
    const warnings = spyMenuWarnings();
    const { deps, recorded } = recordingDeps();
    try {
      // No pageUrl (an action-scoped forgery) and a malformed pageUrl both
      // must not guess a site.
      await dispatchMenuClickEvent(
        { menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget },
        { id: 4 },
        deps
      );
      await dispatchMenuClickEvent(
        { menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget, pageUrl: '%' },
        { id: 4 },
        deps
      );
      expect(recorded.toggles).toHaveLength(0);
      expect(warnings.sawWarning('could not resolve the page origin')).toBe(true);
    } finally {
      warnings.restore();
    }
  });

  it('a rejected toggle is an error-level branch, never an escaping rejection', async () => {
    const { deps, recorded } = recordingDeps();
    recorded.toggleFailure = new Error('storage write failed');
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(String(args[0]));
    });
    try {
      await expect(
        dispatchMenuClickEvent(
          { menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget, pageUrl: `${SITE}/fdt/` },
          { id: 4 },
          deps
        )
      ).resolves.toBeUndefined();
      expect(errors.some((line) => line.includes('Toggling the detection widget failed'))).toBe(
        true
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('the nowprocket entry opens the bypassed document in the click window', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.openNowProcket, pageUrl: `${SITE}/fdt/?a=b#h` },
      { id: 4, windowId: 12 },
      deps
    );
    expect(recorded.openedUrls).toEqual([{ url: `${SITE}/fdt/?a=b&nowprocket#h`, windowId: 12 }]);
    expect(recorded.sent).toHaveLength(0);
    expect(recorded.opened).toHaveLength(0);
    expect(recorded.toggles).toHaveLength(0);
    expect(recorded.refreshes).toBe(0);
  });

  it('an already-bypassed document opens unchanged; a windowless tab defers to the browser', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.openNowProcket, pageUrl: `${SITE}/?nowprocket=0` },
      { id: 4 },
      deps
    );
    expect(recorded.openedUrls).toEqual([{ url: `${SITE}/?nowprocket=0`, windowId: undefined }]);
  });

  it('a nowprocket click without a usable page URL opens nothing and never logs a URL', async () => {
    const { deps, recorded } = recordingDeps();
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const pageUrl of [undefined, 'chrome://settings/?token=secret', '%']) {
        await dispatchMenuClickEvent(
          {
            menuItemId: CONTEXT_MENU_IDS.openNowProcket,
            ...(pageUrl === undefined ? {} : { pageUrl })
          },
          { id: 4, windowId: 1 },
          deps
        );
      }
      expect(recorded.openedUrls).toHaveLength(0);
      expect(spy).toHaveBeenCalledTimes(3);
      for (const call of spy.mock.calls) {
        expect(String(call[0])).toContain('Open ?nowprocket ignored');
        expect(call[1]).toEqual({ action: 'open-nowprocket', tabId: 4 });
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('a rejected tab create is an error-level branch without the page URL', async () => {
    const { deps } = recordingDeps();
    const failure = new Error('No window with id: 12.');
    deps.openUrl = (): Promise<never> => Promise.reject(failure);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(
        dispatchMenuClickEvent(
          { menuItemId: CONTEXT_MENU_IDS.openNowProcket, pageUrl: `${SITE}/?token=secret` },
          { id: 4, windowId: 12 },
          deps
        )
      ).resolves.toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0]?.[0])).toContain('Opening the cache-bypassed page failed');
      expect(spy.mock.calls[0]?.[1]).toEqual({
        action: 'open-nowprocket',
        tabId: 4,
        cause: failure
      });
    } finally {
      spy.mockRestore();
    }
  });
  it('the nowprocket copy opens right after its source tab, which is its opener', async () => {
    const { deps, recorded } = recordingDeps();
    await dispatchMenuClickEvent(
      { menuItemId: CONTEXT_MENU_IDS.openNowProcket, pageUrl: `${SITE}/fdt/` },
      { id: 4, windowId: 12, index: 2 },
      deps
    );
    expect(recorded.placements).toEqual([{ windowId: 12, index: 3, openerTabId: 4 }]);
  });

  it('only the page URL opens: link and frame URLs under the pointer are ignored', async () => {
    const { deps, recorded } = recordingDeps();
    const info = {
      menuItemId: CONTEXT_MENU_IDS.openNowProcket,
      pageUrl: `${SITE}/page/`,
      linkUrl: `${SITE}/link/`,
      frameUrl: `${SITE}/frame/`
    };
    await dispatchMenuClickEvent(info, { id: 4, windowId: 12, url: `${SITE}/tab/` }, deps);
    expect(recorded.openedUrls).toEqual([{ url: `${SITE}/page/?nowprocket`, windowId: 12 }]);
  });

  it("an action-menu click (no pageUrl, Firefox) uses the tab's URL for both page arms", async () => {
    const { deps, recorded } = recordingDeps();
    const tab = { id: 4, windowId: 12, index: 0, url: `${SITE}/fdt/?a=b` };
    await dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.openNowProcket }, tab, deps);
    await dispatchMenuClickEvent({ menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget }, tab, deps);
    expect(recorded.openedUrls).toEqual([{ url: `${SITE}/fdt/?a=b&nowprocket`, windowId: 12 }]);
    expect(recorded.toggles).toEqual([SITE]);
  });

  it('an action-menu toggle on a non-http(s) tab stores nothing and warns without the URL', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { deps, recorded } = recordingDeps();
    const urls = ['chrome://settings/?tok=s3cr3t', 'about:blank', 'moz-extension://abc/p.html'];
    try {
      for (const url of urls) {
        await dispatchMenuClickEvent(
          { menuItemId: CONTEXT_MENU_IDS.toggleDetectionWidget },
          { id: 4, url },
          deps
        );
      }
      expect(recorded.toggles).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(urls.length);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain('could not resolve the page origin');
      for (const url of urls) expect(logged).not.toContain(url);
      expect(logged).not.toContain('s3cr3t');
    } finally {
      warn.mockRestore();
    }
  });

  it('no nowprocket log line ever carries the page URL (it can hold secrets)', async () => {
    const SECRET = 'tok-5ecr3t';
    const { deps } = recordingDeps();
    deps.openUrl = (): Promise<never> => Promise.reject(new Error('refused'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // Rejected create (error branch) and non-http page (warn branch), with
      // the secret in the event URL and in the tab fallback URL.
      await dispatchMenuClickEvent(
        { menuItemId: CONTEXT_MENU_IDS.openNowProcket, pageUrl: `${SITE}/?token=${SECRET}` },
        { id: 4 },
        deps
      );
      await dispatchMenuClickEvent(
        { menuItemId: CONTEXT_MENU_IDS.openNowProcket },
        { id: 4, url: `chrome://settings/?token=${SECRET}` },
        deps
      );
      expect(error).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain(SECRET);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
