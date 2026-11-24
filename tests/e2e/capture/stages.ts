/**
 * The capture run's stages: each one puts a real shipped surface on screen,
 * on the docker site, in the target's palette and viewport, and hands back
 * the page to shoot. One stage per {@link StageId} (the table's type makes a
 * missing one a compile error); the plan of which images use which stage is
 * `scripts/release-shots.ts`.
 *
 * Every page is emulated (palette, reduced motion) before its first
 * navigation, so it renders in its final look with no transition to wait
 * out. Two things are pinned so a re-run with an unchanged UI writes the
 * same bytes: extension pages read a frozen clock, and the site pages whose
 * cache stamp a shot shows serve it frozen (only the stamp's digits change).
 * The one remote answer a local site cannot get is the only staged data: the
 * RUCSS service's (routed, answering the page's own matching rules) — the
 * beacon runs locally.
 *
 * Harness-only: no shipped module imports this file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page, Route } from '@playwright/test';

import {
  BEACON_TEST_SETTINGS_KEY,
  DEFAULT_BEACON_TEST_SETTINGS,
  type BeaconTestSettings
} from '../../../lib/beacon-test/settings';
import { RUCSS_ENDPOINT } from '../../../lib/rucss-tester/endpoint';
import type { ScreenshotPalette } from '../../../lib/release-notes/screenshots';
import {
  FROZEN_CACHE_AGE_MS,
  FROZEN_NOW_MS,
  SHOWCASE_PAGE,
  freezeCacheStamp,
  toolbarMockHtml,
  type StageId,
  type ToolbarState,
  type Viewport
} from '../../../scripts/release-shots';
import { APPLIED, DELAY, clearDrafts, injectOverlay } from '../helpers/exclusion-overlay';
import {
  EXTENSION_PATH,
  expect,
  type DriverPage,
  type ExtensionDriver
} from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_ORIGIN, SITE_URL } from '../helpers/site';
import { STRIP_HOST } from '../helpers/strip-pill';

/** What a stage is given. */
export interface StageInput {
  readonly extension: ExtensionDriver;
  readonly palette: ScreenshotPalette;
  readonly viewport: Viewport;
}

/** A staged surface: the page to shoot, and what to close afterwards. */
export interface Staged {
  readonly page: Page;
  readonly dispose: () => Promise<void>;
}

/** One stage. */
type Stage = (input: StageInput) => Promise<Staged>;

/** The site page most stages show: WP Rocket's cached copy of the run's showcase page. */
export const SITE_PAGE = `/${SHOWCASE_PAGE.slug}/`;

/** The fixture hub: its scenario flags serve the toolbar's three states. */
const HUB_PAGE = '/fdt/';

/** The page the beacon runs on (an LCP image and lazy-render candidates). */
const BEACON_PAGE = '/fdt-beacon/';

/**
 * The site pages a run shows as cached copies (the toolbar's cached state
 * included): each must be in WP Rocket's cache before its stage, or the
 * first visit shows a live render.
 */
export const CACHED_PAGES: readonly string[] = [SITE_PAGE, HUB_PAGE, BEACON_PAGE];

/** WXT's prefix of a `chrome.storage.local` key. */
const LOCAL_AREA = 'local:';

/**
 * `chrome.storage.local` key of the Beacon Tester's settings: its owner's
 * WXT key without the area prefix.
 *
 * @throws {Error} At load, when the owner's key is not a `local:` one.
 */
const BEACON_SETTINGS_KEY = ((): string => {
  if (!BEACON_TEST_SETTINGS_KEY.startsWith(LOCAL_AREA)) {
    throw new Error(`The beacon settings key left the local area: ${BEACON_TEST_SETTINGS_KEY}`);
  }
  return BEACON_TEST_SETTINGS_KEY.slice(LOCAL_AREA.length);
})();

/** Both beacon features picked (none is by default); WP Rocket's desktop defaults otherwise. */
const BEACON_SETTINGS: BeaconTestSettings = {
  ...DEFAULT_BEACON_TEST_SETTINGS,
  aboveTheFold: true,
  lazyRender: true
};

/** The beaconed tab's window: above the desktop thresholds, as a real desktop visit. */
const BEACON_WINDOW: Viewport = { width: 1600, height: 900 };

/** The Delay JavaScript row the builder applies (a delayed module script on the hub). */
const DELAY_ROW = 'block-library/navigation/view';

/** Bounded waits. */
const READY = { timeout: 20_000 };
const RUN = { timeout: 40_000 };

/** The panel's error views: a shot showing one is a failed stage. */
const ERROR_VIEWS = '[data-fdt="error-state"], [data-fdt="data-unavailable"]';

/**
 * Emulate the target's look on a page before it navigates.
 *
 * @param page A fresh page.
 * @param input The stage input.
 */
async function emulate(page: Page, input: StageInput): Promise<void> {
  await page.emulateMedia({ colorScheme: input.palette, reducedMotion: 'reduce' });
  await page.setViewportSize({ width: input.viewport.width, height: input.viewport.height });
}

/**
 * Pin an extension page's clock at {@link FROZEN_NOW_MS} (timers keep
 * running), so its relative ages read the same on every run.
 *
 * @param page A fresh extension page, before its navigation.
 */
async function freezeClock(page: Page): Promise<void> {
  await page.clock.setFixedTime(FROZEN_NOW_MS);
}

/** The cache stamp the frozen pages serve: {@link FROZEN_CACHE_AGE_MS} before the frozen now. */
const FROZEN_STAMP_SECONDS = (FROZEN_NOW_MS - FROZEN_CACHE_AGE_MS) / 1000;

/**
 * Serve a page's site documents with WP Rocket's cache stamp frozen; every
 * other request goes through untouched.
 *
 * @param page A fresh site page, before its navigation.
 */
async function freezeCacheStamps(page: Page): Promise<void> {
  await page.route(
    (url) => url.origin === SITE_ORIGIN,
    async (route) => {
      if (route.request().resourceType() !== 'document') {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: freezeCacheStamp(await response.text(), FROZEN_STAMP_SECONDS)
      });
    }
  );
}

/** How a site page is opened. */
interface SiteOptions {
  /** The tab's viewport (default the target's). */
  readonly viewport?: Viewport;
  /**
   * Serve the cache stamp frozen (default true). Off where a shot shows no
   * stamp and the extension intercepts the tab itself (the Exclusion
   * Builder's session), or where the toolbar's states are read.
   */
  readonly freezeStamp?: boolean;
}

/**
 * Open a site page in the target's look.
 *
 * @param input The stage input.
 * @param sitePath The site path.
 * @param options How the page is opened.
 * @returns The page and its tab id.
 */
async function openSite(
  input: StageInput,
  sitePath: string,
  options: SiteOptions = {}
): Promise<DriverPage> {
  return await openSitePage(input.extension, `${SITE_URL}${sitePath}`, async (page) => {
    await emulate(page, { ...input, viewport: options.viewport ?? input.viewport });
    if (options.freezeStamp !== false) await freezeCacheStamps(page);
  });
}

/**
 * Close pages, the last-opened first, for a stage that failed before handing them over.
 *
 * @param pages The pages opened so far.
 */
async function closeAll(pages: readonly Page[]): Promise<void> {
  for (const page of [...pages].reverse()) await page.close();
}

/**
 * A page staged on its own: closing it ends everything it started.
 *
 * @param page The page.
 * @returns The staged page.
 */
function own(page: Page): Staged {
  return { page, dispose: () => page.close() };
}

/**
 * Let a page settle: no skeleton, fonts loaded, animations done, two frames painted.
 *
 * @param page The page.
 */
export async function settle(page: Page): Promise<void> {
  await expect(page.locator('[data-fdt="skeleton"]')).toHaveCount(0, READY);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const deadline = performance.now() + 2_000;
    while (
      document.getAnimations().some((animation) => animation.playState === 'running') &&
      performance.now() < deadline
    ) {
      await new Promise((done) => setTimeout(done, 50));
    }
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

/**
 * Open the panel on a route, inspecting a site page through the devtools
 * seam (the panel's own boot then reads the tab's real data).
 *
 * @param input The stage input.
 * @param route The panel route id.
 * @param sitePath The inspected site page.
 * @param siteViewport The inspected tab's viewport (default the panel's).
 * @returns The panel page and the inspected site tab.
 * @throws {Error} When the route never renders or shows an error view.
 */
async function openPanel(
  input: StageInput,
  route: string,
  sitePath: string,
  siteViewport: Viewport = input.viewport
): Promise<{ panel: Page; site: DriverPage }> {
  const site = await openSite(input, sitePath, { viewport: siteViewport });
  const panel = await input.extension.browserContext.newPage();
  try {
    await emulate(panel, input);
    await freezeClock(panel);
    await panel.addInitScript(devtoolsShim(site.tabId));
    await panel.goto(`${await panelPageUrl(input.extension)}#/${route}`, { waitUntil: 'load' });
    await expect(
      panel.locator(`[data-fdt-page="${route}"]:not(:has([data-fdt-page-chunk-loading]))`)
    ).toBeVisible(READY);
    await expect(panel.locator(ERROR_VIEWS)).toHaveCount(0);
  } catch (error) {
    await closeAll([site.page, panel]);
    throw error;
  }
  return { panel, site };
}

/**
 * A panel page staged with the site tab it inspects (both closed afterwards).
 *
 * @param panel The panel page.
 * @param site The inspected tab.
 * @returns The staged page.
 */
function panelStaged(panel: Page, site: DriverPage): Staged {
  return {
    page: panel,
    dispose: async () => {
      await panel.close();
      await site.page.close();
    }
  };
}

/**
 * The page's used CSS, computed in the page: every same-origin style rule
 * whose selector matches an element (media blocks kept around their
 * matching rules). The RUCSS service's own answer cannot reach a local site;
 * this stands in for it with the page's real rules.
 *
 * @param page The site page.
 * @returns The CSS text.
 */
async function usedCss(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const matches = (rule: CSSStyleRule): boolean => {
      try {
        return document.querySelector(rule.selectorText) !== null;
      } catch {
        // A selector this browser cannot query (vendor pseudo) is dropped, as unused.
        return false;
      }
    };
    const keep = (rules: CSSRuleList): string[] =>
      [...rules].flatMap((rule) => {
        if (rule instanceof CSSStyleRule) return matches(rule) ? [rule.cssText] : [];
        if (rule instanceof CSSMediaRule) {
          const inner = keep(rule.cssRules);
          return inner.length > 0 ? [`@media ${rule.conditionText}{${inner.join('')}}`] : [];
        }
        return [];
      });
    return [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return keep(sheet.cssRules);
        } catch {
          // A cross-origin sheet's rules are unreadable: nothing of it is kept.
          return [];
        }
      })
      .join('');
  });
}

/**
 * Answer the background's RUCSS requests with a success carrying `css`.
 *
 * @param input The stage input.
 * @param css The used CSS the answer carries.
 * @returns Removes the route.
 */
async function routeRucss(input: StageInput, css: string): Promise<() => Promise<void>> {
  const context = input.extension.browserContext;
  const matcher = (url: URL): boolean => url.href.startsWith(`${RUCSS_ENDPOINT}?`);
  const handler = async (route: Route): Promise<void> => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        code: 200,
        status: 'completed',
        message: 'Treeshaked successfully!',
        contents: { success: true, shakedCSS: css }
      })
    });
  };
  await context.route(matcher, handler);
  return () => context.unroute(matcher, handler);
}

/**
 * Read a tab's toolbar state once the badge is set.
 *
 * @param extension The driver.
 * @param tabId The tab.
 * @returns Its badge text, color and tooltip.
 */
async function toolbarState(extension: ExtensionDriver, tabId: number): Promise<ToolbarState> {
  let state: ToolbarState = { text: '', color: [], title: '' };
  await expect
    .poll(async () => {
      state = await extension.evaluateInWorker(
        async (tab: number) => ({
          text: await chrome.action.getBadgeText({ tabId: tab }),
          color: await chrome.action.getBadgeTextColor({ tabId: tab }),
          title: await chrome.action.getTitle({ tabId: tab })
        }),
        tabId
      );
      return state.text;
    }, READY)
    .not.toBe('');
  return state;
}

/** The three toolbar states, as the site serves them: cached, live render, bypassed. */
const TOOLBAR_PAGES = [HUB_PAGE, `${HUB_PAGE}?fdt-no-store=1`, `${HUB_PAGE}?nowprocket=1`];

/**
 * Remove the Beacon Tester's stored settings (the fresh-install state: none stored).
 *
 * @param extension The driver.
 */
export async function removeBeaconSettings(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(
    (key: string) => chrome.storage.local.remove(key),
    BEACON_SETTINGS_KEY
  );
}

/** Every stage, by id. */
export const STAGES: Readonly<Record<StageId, Stage>> = {
  detections: async (input) => {
    const { panel, site } = await openPanel(input, 'detections', SITE_PAGE);
    await expect(panel.locator('[data-fdt-summary-headline]')).toBeVisible(READY);
    return panelStaged(panel, site);
  },

  'exclusion-builder': async (input) => {
    await clearDrafts(input.extension);
    // The builder's session intercepts this tab itself; its shot shows no cache stamp.
    const site = await openSite(input, SITE_PAGE, { freezeStamp: false });
    const page = site.page;
    await injectOverlay(input.extension, site);
    await page
      .getByRole('region', { name: DELAY })
      .getByRole('button', { name: 'Add row' })
      .click();
    await page.keyboard.type(DELAY_ROW);
    await page.keyboard.press('Tab');
    // Apply reloads the tab through the session; the overlay reopens on the rewritten page.
    const reloaded = page.waitForEvent('load', APPLIED);
    await page.getByRole('button', { name: /^Apply$/ }).click();
    await reloaded;
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible(APPLIED);
    // The draft is per origin: leave none behind for the next stage.
    return {
      page,
      dispose: async () => {
        await page.close();
        await clearDrafts(input.extension);
      }
    };
  },

  'detection-widget': async (input) => {
    const site = await openSite(input, SITE_PAGE);
    await site.page.locator(`${STRIP_HOST} .dw-pill`).click();
    await expect(site.page.locator(`${STRIP_HOST} .dw-card`)).toBeVisible(READY);
    return own(site.page);
  },

  'command-palette': async (input) => {
    const site = await openSite(input, SITE_PAGE);
    await expect(site.page.locator(`${STRIP_HOST} .dw-pill`)).toBeVisible(READY);
    expect(await input.extension.sendToTab<boolean>(site.tabId, 'openCommandPalette')).toBe(true);
    await expect(
      site.page.locator('wpr-fdt-command-palette [data-fdt="palette-input"]')
    ).toBeFocused(READY);
    return own(site.page);
  },

  'rucss-tester': async (input) => {
    const { panel, site } = await openPanel(input, 'rucss-tester', SITE_PAGE);
    const unroute = await routeRucss(input, await usedCss(site.page));
    try {
      await panel.locator('[data-fdt-rucss-run]').click();
      await expect(panel.locator('[data-fdt="rucss-outcome"]')).toBeVisible(RUN);
      await expect(panel.locator('[data-fdt-rucss-run]')).not.toHaveAttribute('aria-busy', 'true');
      await expect(panel.locator('[data-fdt="rucss-outcome"]')).toHaveAttribute(
        'data-fdt-rucss-outcome',
        'applied'
      );
    } finally {
      await unroute();
    }
    return panelStaged(panel, site);
  },

  'beacon-tester': async (input) => {
    await input.extension.evaluateInWorker(
      (entry: { key: string; value: object }) =>
        chrome.storage.local.set({ [entry.key]: entry.value }),
      { key: BEACON_SETTINGS_KEY, value: BEACON_SETTINGS }
    );
    let staged: Staged | undefined;
    try {
      const { panel, site } = await openPanel(input, 'beacon-tester', BEACON_PAGE, BEACON_WINDOW);
      const opened = panelStaged(panel, site);
      try {
        await panel.locator('[data-fdt-beacon-run]').click();
        await expect(panel.locator('[data-fdt-beacon-run]')).toBeEnabled(RUN);
        await expect(panel.locator('[data-fdt="beacon-outcome"]')).toHaveAttribute(
          'data-fdt-beacon-outcome',
          'completed',
          RUN
        );
      } catch (error) {
        await opened.dispose();
        throw error;
      }
      staged = {
        page: panel,
        dispose: async () => {
          try {
            await opened.dispose();
          } finally {
            await removeBeaconSettings(input.extension);
          }
        }
      };
      return staged;
    } finally {
      // A stage that failed hands nothing over: its settings go now, not at a dispose.
      if (staged === undefined) await removeBeaconSettings(input.extension);
    }
  },

  'toolbar-dot': async (input) => {
    const states: ToolbarState[] = [];
    for (const sitePath of TOOLBAR_PAGES) {
      const site = await openSite(input, sitePath, { freezeStamp: false });
      try {
        states.push(await toolbarState(input.extension, site.tabId));
      } finally {
        await site.page.close();
      }
    }
    // Three pages, three states: a drifted site must fail, never show two alike.
    expect(new Set(states.map((state) => state.title)).size).toBe(TOOLBAR_PAGES.length);
    const icon = readFileSync(path.join(EXTENSION_PATH, 'icon', '32.png')).toString('base64');
    const page = await input.extension.browserContext.newPage();
    await emulate(page, input);
    await page.setContent(
      toolbarMockHtml(
        states,
        input.palette,
        `data:image/png;base64,${icon}`,
        new URL(SITE_URL).host
      )
    );
    await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
    return own(page);
  },

  options: async (input) => {
    const page = await input.extension.browserContext.newPage();
    await emulate(page, input);
    await freezeClock(page);
    await page.goto(`chrome-extension://${await input.extension.extensionId()}/options.html`, {
      waitUntil: 'load'
    });
    await expect(page.locator('[data-fdt="option-row"]').first()).toBeVisible(READY);
    return own(page);
  }
};
