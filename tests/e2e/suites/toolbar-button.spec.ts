/**
 * The toolbar button: its per-tab tooltip names the badge dot's state, and
 * a click opens the on-page command palette — else the options page.
 *
 * - Tooltip: read back in the service worker (`chrome.action.getTitle`, the
 *   same seam as the badge reads in helpers/badge.ts) — cached, present not
 *   cached and absent fixtures, a navigation to another state, and the
 *   toolbar-badge option off (manifest tooltip) / on (restored from the kept
 *   summary, no page reprocess).
 * - Click: a real toolbar click is not Playwright-reachable; CDP
 *   `Extensions.triggerAction` runs the button's default action for a tab
 *   (needs `--enable-unsafe-extension-debugging`, so the leg rides the
 *   late-install browser). A tab loaded after install opens the palette
 *   (a second click keeps it open as it is, a click on a closed one opens a
 *   fresh one); a tab loaded before install (no content script) and a page
 *   with on-page UI off open the options page. Every click is settled on
 *   real signals, never on states already true: the worker is instrumented
 *   from the test (no production hook) to record the page's palette arming
 *   and each click's finished send and options opens (see
 *   {@link instrumentClicks}).
 */
import type { BrowserContext, CDPSession, Page, Worker } from '@playwright/test';

import { POLLED_BADGE_OPTIONS } from '../helpers/badge';
import {
  ORIGIN_A,
  expect,
  launchForLateInstall,
  openFixturePage,
  test,
  type ExtensionDriver,
  type LateInstallBrowser
} from '../helpers/extension';
import { resetStoredOptions } from '../helpers/options';

/** The pinned state words (the tooltip is the only place the dot is explained). */
const CAPTIONS = {
  cached: 'WP Rocket active, page served from cache',
  uncached: 'WP Rocket active, page not served from cache',
  absent: 'WP Rocket not detected'
} as const;

/** The palette view's shadow host and its field (as page-command-palette.spec pins them). */
const PALETTE_FIELD = 'wpr-fdt-command-palette [data-fdt="palette-input"]';
/** The palette module's page notice (shown when on-page UI turns off). */
const GATE_OFF_NOTICE = 'wpr-fdt-page-notice [data-fdt="page-notice"]';
/** Generous mount wait (the palette view is injected on demand). */
const MOUNT = { timeout: 10_000 };

/**
 * The extension's name and default tooltip, from its own manifest.
 *
 * @param driver The extension driver.
 */
async function manifestTitles(
  driver: ExtensionDriver
): Promise<{ name: string; defaultTitle: string }> {
  return await driver.evaluateInWorker(() => {
    // The Chromium build is Manifest V3: its button key is `action`.
    const manifest = chrome.runtime.getManifest() as chrome.runtime.ManifestV3;
    const declared: string | undefined = manifest.action?.default_title;
    return { name: manifest.name, defaultTitle: declared ?? manifest.name };
  }, undefined);
}

/**
 * One tab's tooltip, read in the service worker.
 *
 * @param driver The extension driver.
 * @param tabId The tab.
 */
async function readTitle(driver: ExtensionDriver, tabId: number): Promise<string> {
  return await driver.evaluateInWorker(
    async (tab: number) => await chrome.action.getTitle({ tabId: tab }),
    tabId
  );
}

/**
 * Write the toolbar-badge feature flag straight to the synced options (the
 * options-page drive is pinned by options-toolbar-badge.spec).
 *
 * @param driver The extension driver.
 * @param enabled The flag to store.
 */
async function setBadgeFeature(driver: ExtensionDriver, enabled: boolean): Promise<void> {
  await driver.evaluateInWorker(async (on: boolean) => {
    const stored = (await chrome.storage.sync.get('options')).options as
      { features?: Record<string, unknown> } | undefined;
    await chrome.storage.sync.set({
      options: { ...stored, features: { ...stored?.features, toolbarBadge: on } }
    });
  }, enabled);
}

test.describe('toolbar tooltip', () => {
  test('names the dot per tab, follows navigation and the badge option', async ({ extension }) => {
    await resetStoredOptions(extension);
    const { name, defaultTitle } = await manifestTitles(extension);
    const cached = await openFixturePage(extension, '/pipeline/markers.html');
    const uncached = await openFixturePage(extension, '/pipeline/bypass-footprints.html');
    const absent = await openFixturePage(extension, '/pipeline/plain.html');
    try {
      await expect
        .poll(() => readTitle(extension, cached.tabId), POLLED_BADGE_OPTIONS)
        .toBe(`${name} · ${CAPTIONS.cached}`);
      await expect
        .poll(() => readTitle(extension, uncached.tabId), POLLED_BADGE_OPTIONS)
        .toBe(`${name} · ${CAPTIONS.uncached}`);
      await expect
        .poll(() => readTitle(extension, absent.tabId), POLLED_BADGE_OPTIONS)
        .toBe(`${name} · ${CAPTIONS.absent}`);

      // A navigation re-states the tab: the old page's words never survive it.
      await cached.page.goto(`${ORIGIN_A}/pipeline/plain.html?e2e-nav=1`, { waitUntil: 'load' });
      await expect
        .poll(() => readTitle(extension, cached.tabId), POLLED_BADGE_OPTIONS)
        .toBe(`${name} · ${CAPTIONS.absent}`);

      // Option off: every tab is back to the manifest tooltip; on: the kept
      // summaries restore each tab's words without a page reprocess.
      await setBadgeFeature(extension, false);
      for (const tab of [cached, uncached, absent]) {
        await expect
          .poll(() => readTitle(extension, tab.tabId), POLLED_BADGE_OPTIONS)
          .toBe(defaultTitle);
      }
      await setBadgeFeature(extension, true);
      await expect
        .poll(() => readTitle(extension, uncached.tabId), POLLED_BADGE_OPTIONS)
        .toBe(`${name} · ${CAPTIONS.uncached}`);
    } finally {
      await resetStoredOptions(extension);
      for (const tab of [cached, uncached, absent]) await tab.page.close();
    }
  });
});

/**
 * Run the button's default action for a page's tab, as a click does. The
 * command takes the page's `tab` target (not its `page` target), found by
 * the page's unique URL — and acts on its window's active tab (verified
 * live: a background tab's target still delivered the active tab), so the
 * page is brought to the front first, as a real click needs it to be.
 *
 * @param browserSession A browser-level CDP session.
 * @param extensionId The installed extension's id.
 * @param page The page whose tab is "clicked" (its URL must be unique).
 */
async function clickToolbar(
  browserSession: CDPSession,
  extensionId: string,
  page: Page
): Promise<void> {
  await page.bringToFront();
  // Tab targets are filtered out of the default listing: ask for them.
  const { targetInfos } = await browserSession.send('Target.getTargets', {
    filter: [{ type: 'tab' }]
  });
  const tabs = targetInfos.filter((info) => info.type === 'tab' && info.url === page.url());
  if (tabs.length !== 1) {
    throw new Error(`Expected one tab target at ${page.url()}, found ${String(tabs.length)}`);
  }
  await browserSession.send('Extensions.triggerAction', {
    id: extensionId,
    targetId: tabs[0]?.targetId ?? ''
  });
}

/**
 * Wait for the options page to open (a click's fallback), then close it.
 *
 * @param context The browser context.
 * @param extensionId The installed extension's id.
 * @param click The action that should open it.
 */
async function expectOptionsOpened(
  context: BrowserContext,
  extensionId: string,
  click: () => Promise<void>
): Promise<void> {
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  const opened = context.waitForEvent('page', {
    predicate: (page) => page.url().startsWith(optionsUrl),
    timeout: 10_000
  });
  await click();
  const options = await opened;
  await options.close();
}

/** What the instrumented worker saw (see {@link instrumentClicks}). */
interface ClickRecord {
  /** Tabs whose palette receiver armed, in order. */
  armed: number[];
  /** Each finished `openCommandPalette` send: its tab and whether it was answered. */
  sends: { tabId: number; answered: boolean }[];
  /** `runtime.openOptionsPage` calls so far. */
  optionsOpens: number;
}

/** The worker global the instrumentation writes (test-only, never shipped). */
const RECORD_KEY = 'e2eToolbarClicks';

/**
 * Instrument the settled worker, from the test only:
 * - armed: the palette module's first arm sends `getChordPlatform` in the
 *   same synchronous turn that registers the `openCommandPalette` receiver
 *   (the chord arms, then the receiver), so the worker receiving that ask
 *   from a tab means any later message to it finds the receiver;
 * - sends: the platform tab send is wrapped (outermost, after the
 *   messaging module's own guard) to record each palette send once its
 *   callback ran — the click's decision then finishes in that callback's
 *   microtasks, so any later worker evaluation sees its final effects;
 * - options opens: `runtime.openOptionsPage` is wrapped to count calls.
 *
 * @param worker The settled extension service worker.
 */
async function instrumentClicks(worker: Worker): Promise<void> {
  await worker.evaluate((key: string) => {
    const record: ClickRecord = { armed: [], sends: [], optionsOpens: 0 };
    (globalThis as unknown as Record<string, unknown>)[key] = record;
    chrome.runtime.onMessage.addListener((message: unknown, sender) => {
      const tabId = sender.tab?.id;
      if ((message as { type?: unknown } | null)?.type === 'getChordPlatform' && tabId) {
        record.armed.push(tabId);
      }
      // Never answers: the extension's own listener does.
      return undefined;
    });
    type LooseSend = (tabId: number, message: unknown, ...rest: unknown[]) => unknown;
    const send = chrome.tabs.sendMessage as unknown as LooseSend;
    const wrapped: LooseSend = (tabId, message, ...rest) => {
      const at = rest.findIndex((arg) => typeof arg === 'function');
      if (at >= 0 && (message as { type?: unknown } | null)?.type === 'openCommandPalette') {
        const callback = rest[at] as (response: unknown) => void;
        rest[at] = (response: unknown): void => {
          const answered = chrome.runtime.lastError === undefined;
          try {
            callback(response);
          } finally {
            record.sends.push({ tabId, answered });
          }
        };
      }
      return send(tabId, message, ...rest);
    };
    chrome.tabs.sendMessage = wrapped as unknown as typeof chrome.tabs.sendMessage;
    const openOptions = chrome.runtime.openOptionsPage.bind(chrome.runtime);
    chrome.runtime.openOptionsPage = () => {
      record.optionsOpens += 1;
      return openOptions();
    };
  }, RECORD_KEY);
}

/**
 * The instrumentation's record so far.
 *
 * @param worker The instrumented worker.
 */
async function clickRecord(worker: Worker): Promise<ClickRecord> {
  return await worker.evaluate(
    (key: string) =>
      structuredClone((globalThis as unknown as Record<string, ClickRecord>)[key]) as ClickRecord,
    RECORD_KEY
  );
}

/**
 * A page's tab id (its URL must be unique).
 *
 * @param worker The extension service worker.
 * @param page The page.
 */
async function tabIdOf(worker: Worker, page: Page): Promise<number> {
  const tabId = await worker.evaluate(
    (url: string) => chrome.tabs.query({ url }).then((tabs) => tabs[0]?.id ?? null),
    page.url()
  );
  if (tabId === null) throw new Error(`No tab matched ${page.url()}`);
  return tabId;
}

/**
 * Click the toolbar for a page and wait until the worker finished the
 * click's send (answered or not).
 *
 * @param worker The instrumented worker.
 * @param click The click (see {@link clickToolbar}).
 * @returns The finished send and the options opens the click added.
 */
async function clickAndSettle(
  worker: Worker,
  click: () => Promise<void>
): Promise<{ send: { tabId: number; answered: boolean }; optionsOpened: number }> {
  const before = await clickRecord(worker);
  await click();
  await expect
    .poll(async () => (await clickRecord(worker)).sends.length, CLICK_SETTLE)
    .toBe(before.sends.length + 1);
  const after = await clickRecord(worker);
  const send = after.sends.at(-1);
  if (send === undefined) throw new Error('The settled click recorded no send');
  return { send, optionsOpened: after.optionsOpens - before.optionsOpens };
}

/** How long a click may take to reach the page and back (busy machines included). */
const CLICK_SETTLE = { timeout: 15_000 };

test.describe('toolbar click', () => {
  let late: LateInstallBrowser;

  test.beforeEach(async () => {
    late = await launchForLateInstall();
  });

  test.afterEach(async () => {
    await late.close();
  });

  test('opens the palette, else the options page (no receiver, on-page UI off)', async () => {
    // Loaded before install: no content script, so no receiver.
    const before = await late.context.newPage();
    await before.goto(`${ORIGIN_A}/palette/hotkeys.html?leg=before-install`, { waitUntil: 'load' });

    const { id, worker } = await late.install();
    const browser = late.context.browser();
    if (browser === null) throw new Error('The persistent context exposes no browser for CDP');
    const session = await browser.newBrowserCDPSession();
    // Settle the fresh worker first (an evaluation runs only after its
    // top-level registrations): without it the first click reached no
    // listener — no send, no log, no palette (3/3 runs, live) — the same
    // fact the harness warm-up handles for the header capture.
    await worker.evaluate(() => true);
    await instrumentClicks(worker);

    const after = await late.context.newPage();
    await after.goto(`${ORIGIN_A}/palette/hotkeys.html?leg=after-install`, { waitUntil: 'load' });
    const afterTab = await tabIdOf(worker, after);
    const beforeTab = await tabIdOf(worker, before);
    // The receiver arms after the page's async gate read: click only then.
    await expect
      .poll(async () => (await clickRecord(worker)).armed, CLICK_SETTLE)
      .toContain(afterTab);
    const palette = after.locator(PALETTE_FIELD);
    const clickAfter = (): Promise<void> => clickToolbar(session, id, after);

    // A tab with the palette module: the click opens the palette, focus in its field.
    expect(await clickAndSettle(worker, clickAfter)).toEqual({
      send: { tabId: afterTab, answered: true },
      optionsOpened: 0
    });
    await expect(palette).toBeFocused(MOUNT);
    // A second click keeps the open palette as it is (no toggle, no options
    // page): its open ran in the page before the answer came back.
    await palette.fill('side');
    expect(await clickAndSettle(worker, clickAfter)).toEqual({
      send: { tabId: afterTab, answered: true },
      optionsOpened: 0
    });
    await expect(palette).toBeFocused();
    await expect(palette).toHaveValue('side');
    await after.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    // A click on the closed palette opens a fresh one.
    expect(await clickAndSettle(worker, clickAfter)).toEqual({
      send: { tabId: afterTab, answered: true },
      optionsOpened: 0
    });
    await expect(palette).toBeFocused(MOUNT);
    await expect(palette).toHaveValue('');
    await after.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    // A tab without a receiver: the options page instead.
    await expectOptionsOpened(late.context, id, async () => {
      expect(await clickAndSettle(worker, () => clickToolbar(session, id, before))).toEqual({
        send: { tabId: beforeTab, answered: false },
        optionsOpened: 1
      });
    });

    // On-page UI off: the receiver is gone, the options page opens instead.
    await setPageUi(worker, false);
    // The gate-off notice marks the receiver's removal (clicking earlier races it).
    await expect(after.locator(GATE_OFF_NOTICE)).toContainText('On-page UI is off', MOUNT);
    await expectOptionsOpened(late.context, id, async () => {
      expect(await clickAndSettle(worker, clickAfter)).toEqual({
        send: { tabId: afterTab, answered: false },
        optionsOpened: 1
      });
    });
    await expect(palette).toHaveCount(0);
    await session.detach();
  });
});

/**
 * Write the on-page UI gate (its synced key, as the palette suite does).
 *
 * @param worker The extension service worker.
 * @param enabled The gate value.
 */
async function setPageUi(worker: Worker, enabled: boolean): Promise<void> {
  await worker.evaluate(async (on: boolean) => {
    await chrome.storage.sync.set({ 'page-ui-gate': on });
  }, enabled);
}
