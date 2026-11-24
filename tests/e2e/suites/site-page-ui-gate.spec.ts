/**
 * The on-page UI gate over every gated surface on the real docker
 * site: the detection widget (front page + plugins screen), the Known
 * Conflicts card (plugins screen), the Side-by-Side overlay and the
 * exclusion builder overlay.
 *
 * - Boot off: nothing mounts — the page stays pristine (no `wpr-fdt-*`
 *   host, no shadow-root document style, no scroll lock — not even briefly:
 *   a document-start recorder sees every insertion) although the isolated
 *   world is alive (it answers the liveness probe); a later gate-on brings
 *   each surface in, the Known Conflicts card through its whole scan flow
 *   (it reaches its empty verdict).
 * - Live off: every visible surface leaves the running page (SBS restores
 *   the page scroll and clears its reload-restore record); live on: each
 *   comes back per its own state (SBS re-opens since it was open).
 * - Per-site widget opt-outs hold across gate off → on.
 * - The SBS reload restore cannot survive a gate-off boot (record consumed,
 *   nothing opens, and a later gate-on does not resurrect it).
 * - The command palette: on a gate-off boot (pressed after several times a
 *   measured gate-on arm, so the module has settled) neither its chord
 *   (Alt+K reaches the page) nor the menu's send opens it; a gate-on arms
 *   both live, a live off removes the view and frees the chord again.
 * - The builder overlay: a live off ends it, and an injection racing a
 *   gate-off write never stays (observed for several times the measured
 *   gate-on mount time — the positive control); the background opener's
 *   `page-ui-off` refusal is unit-tested — a standalone extension page is
 *   not a tab-less sender.
 *
 * The gate is written through the service worker (the options switch's and
 * the menu rescue's exact storage write). Every test restores the gate and
 * the per-site entries it touched.
 */
import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { OVERLAY_HOST as BUILDER_HOST, injectOverlay } from '../helpers/exclusion-overlay';
import { SITE_ORIGIN, SITE_URL, openSitePage, siteTest } from '../helpers/site';
import { WIDGET_ORIGINS_KEY } from '../helpers/strip-pill';

/** The gated surfaces' shadow hosts. */
const STRIP_HOST = 'wpr-fdt-detection-widget';
const KC_HOST = 'wpr-fdt-known-conflicts';
const SBS_HOST = 'wpr-fdt-side-by-side';
const PALETTE_HOST = 'wpr-fdt-command-palette';
/** The page-UI gate's sync key (the widget map's key is the shared `WIDGET_ORIGINS_KEY`). */
const GATE_KEY = 'page-ui-gate';
/** The SBS reload-restore record (tab `sessionStorage`). */
const SBS_RESTORE_KEY = 'wpr-fdt-sbs-open';
/** A cached front-end page and the plugins screen (Known Conflicts' wp-admin mode). */
const FRONT_URL = `${SITE_URL}/fdt/`;
const PLUGINS_URL = `${SITE_URL}/wp-admin/plugins.php`;
/**
 * The plugins screen's active-only view: its title cells hold just WP Rocket,
 * so the Known Conflicts scan legitimately finds nothing and settles on its
 * empty verdict (only once its late pass has run).
 */
const PLUGINS_ACTIVE_URL = `${PLUGINS_URL}?plugin_status=active`;
/** The Known Conflicts empty verdict's exact copy. */
const KC_EMPTY_COPY = 'No known conflicts found...';
/** Mount settle (hub pass, DB load, the plugins screen's late pass). */
const SETTLE = { timeout: 15_000, intervals: [250, 500] };
/**
 * How long a gate-off page is watched for a late mount: past the Known
 * Conflicts late pass (1 s after `load`) and the hub pass, with margin.
 */
const QUIET_WINDOW_MS = 3_000;
/** The page-global insertion log the recorder keeps. */
const HOST_LOG = '__wprFdtHostLog';

/**
 * Record every `wpr-fdt-*` host and shadow-root document style entering
 * (`+name`) or leaving (`-name`) the page, from the moment it runs (an init
 * script runs it at document start). Runs in the page; self-contained.
 */
function recordHosts(): void {
  const entries: string[] = [];
  Object.defineProperty(window, '__wprFdtHostLog', { value: entries, configurable: true });
  const note = (node: Node, sign: string): void => {
    if (!(node instanceof Element)) return;
    for (const element of [node, ...node.querySelectorAll('*')]) {
      if (
        element.localName.startsWith('wpr-fdt-') ||
        element.matches('style[wxt-shadow-root-document-styles]')
      ) {
        entries.push(`${sign}${element.localName}`);
      }
    }
  };
  new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        note(node, '+');
      });
      record.removedNodes.forEach((node) => {
        note(node, '-');
      });
    }
  }).observe(document, { childList: true, subtree: true });
}

/**
 * The recorder's log.
 *
 * @param page The recorded page.
 * @returns Its `+name`/`-name` entries, in insertion order.
 * @throws {@link Error} When no recorder runs on the page (a suite bug).
 */
async function hostLog(page: Page): Promise<string[]> {
  return await page.evaluate((key: string) => {
    const entries = (window as unknown as Record<string, unknown>)[key];
    if (!Array.isArray(entries)) throw new Error('no host recorder on this page');
    return entries.map(String);
  }, HOST_LOG);
}

/**
 * Watch a page that must stay quiet for the observation window (the
 * recorder's log is read afterwards).
 *
 * @param page The watched page.
 * @param ms The window, in milliseconds.
 */
async function stayQuiet(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

/**
 * Write the gate (null removes it: default on).
 *
 * @param driver The extension driver.
 * @param value The gate, or null.
 */
async function setGate(driver: ExtensionDriver, value: boolean | null): Promise<void> {
  await driver.evaluateInWorker(
    async (arg: { key: string; value: boolean | null }) => {
      if (arg.value === null) await chrome.storage.sync.remove(arg.key);
      else await chrome.storage.sync.set({ [arg.key]: arg.value });
    },
    { key: GATE_KEY, value }
  );
}

/**
 * Write (or clear) the site's per-origin widget entry.
 *
 * @param driver The extension driver.
 * @param enabled The entry, or null to remove every entry.
 */
async function setSiteEntry(driver: ExtensionDriver, enabled: boolean | null): Promise<void> {
  await driver.evaluateInWorker(
    async (arg: { key: string; origin: string; enabled: boolean | null }) => {
      if (arg.enabled === null) await chrome.storage.sync.remove(arg.key);
      else await chrome.storage.sync.set({ [arg.key]: { [arg.origin]: { enabled: arg.enabled } } });
    },
    { key: WIDGET_ORIGINS_KEY, origin: SITE_ORIGIN, enabled }
  );
}

/** How many hosts of a surface the page holds. */
async function hosts(page: Page, host: string): Promise<number> {
  return await page.evaluate((name: string) => document.querySelectorAll(name).length, host);
}

/** What our injection could leave in a page, read in the page. */
async function pageFootprint(page: Page): Promise<{
  hosts: string[];
  documentStyles: number;
  htmlOverflow: string;
  bodyOverflow: string;
}> {
  return await page.evaluate(() => ({
    hosts: [...document.querySelectorAll('*')]
      .map((node) => node.localName)
      .filter((name) => name.startsWith('wpr-fdt-')),
    documentStyles: document.querySelectorAll('style[wxt-shadow-root-document-styles]').length,
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow
  }));
}

/** Prove the isolated world booted on the tab (its liveness probe answers). */
async function expectWorldAlive(driver: ExtensionDriver, tabId: number): Promise<void> {
  expect(await driver.sendToTab<boolean>(tabId, 'reportDeviceSimulationLiveness')).toBe(true);
}

/** Read the SBS reload-restore record. */
async function restoreRecord(page: Page): Promise<string | null> {
  return await page.evaluate((key: string) => sessionStorage.getItem(key), SBS_RESTORE_KEY);
}

/**
 * Install a document-capture keydown recorder on the page (modifier presses
 * alone skipped): a keystroke the palette chord consumes stops at the window
 * and never lands here.
 *
 * @param page The page.
 */
async function recordKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as unknown as { __fdtKeys: string[] };
    scope.__fdtKeys = [];
    document.addEventListener(
      'keydown',
      (event) => {
        if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return;
        const mods = (['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const)
          .filter((name) => event[name])
          .map((name) => name.replace('Key', ''));
        scope.__fdtKeys.push([...mods, event.code].join('+'));
      },
      true
    );
  });
}

/**
 * Read and clear the page's key recorder.
 *
 * @param page The page.
 * @returns The keystrokes that reached the document (`alt+KeyK`, …).
 */
async function takeKeys(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const scope = window as unknown as { __fdtKeys: string[] };
    const keys = scope.__fdtKeys;
    scope.__fdtKeys = [];
    return keys;
  });
}

/** The SBS overlay's open state. */
const sbsOpen = (page: Page) => page.locator(`${SBS_HOST} .sbs-overlay--open`);

siteTest.describe('on-page UI gate', () => {
  siteTest.afterEach(async ({ extension }) => {
    await setGate(extension, null);
    await setSiteEntry(extension, null);
  });

  siteTest(
    'a gate-off boot mounts nothing: the page stays pristine',
    async ({ extension, adminPage }) => {
      await setGate(extension, false);
      // A fresh page for the plugins screen — widget + Known Conflicts card —
      // recorded from document start; the worker's admin page logged the
      // profile in (its cookie serves this page too).
      expect(adminPage.url()).toContain('/wp-admin/');
      const admin = await extension.browserContext.newPage();
      const front = await openSitePage(extension, FRONT_URL);
      try {
        await admin.addInitScript(recordHosts);
        await admin.goto(PLUGINS_ACTIVE_URL, { waitUntil: 'load' });
        // The front page boots again (still gate-off) under the recorder.
        await front.page.addInitScript(recordHosts);
        await front.page.reload({ waitUntil: 'load' });
        await expectWorldAlive(extension, front.tabId);
        // An explicit Side-by-Side open is refused too (the gate outranks it).
        expect(await extension.sendToTab<boolean>(front.tabId, 'openSideBySide')).toBe(true);
        // Past the Known Conflicts late pass and the hub pass: nothing ever
        // entered either page, not even briefly.
        await stayQuiet(admin, QUIET_WINDOW_MS);
        expect(await hostLog(front.page), 'nothing entered the front page').toEqual([]);
        expect(await hostLog(admin), 'nothing entered the plugins screen').toEqual([]);
        expect(await pageFootprint(front.page)).toEqual({
          hosts: [],
          documentStyles: 0,
          htmlOverflow: '',
          bodyOverflow: ''
        });

        // The modules were alive and waiting: a gate-on brings them in.
        await setGate(extension, true);
        await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
        await expect.poll(() => hosts(admin, STRIP_HOST), SETTLE).toBe(1);
        // The Known Conflicts card runs its whole scan flow from the gate-on
        // (the gate-off boot never ran it): it reaches its empty verdict
        // instead of staying blank.
        await expect
          .poll(
            async () =>
              await admin.evaluate((host: string) => {
                const root = document.querySelector(host)?.shadowRoot ?? null;
                return [...(root?.querySelectorAll('.kc-none') ?? [])].map((n) => n.textContent);
              }, KC_HOST),
            SETTLE
          )
          .toContain(KC_EMPTY_COPY);
        // Nothing that was never open comes up on its own.
        expect(await hosts(front.page, SBS_HOST)).toBe(0);
      } finally {
        await front.page.close();
        await admin.close();
      }
    }
  );

  siteTest(
    'live off unmounts every visible surface; live on restores each',
    async ({ extension, adminPage }) => {
      await adminPage.goto(PLUGINS_URL, { waitUntil: 'load' });
      const front = await openSitePage(extension, FRONT_URL);
      try {
        await expect.poll(() => hosts(adminPage, KC_HOST), SETTLE).toBe(1);
        await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
        expect(await extension.sendToTab<boolean>(front.tabId, 'openSideBySide')).toBe(true);
        await expect(sbsOpen(front.page)).toHaveCount(1, SETTLE);
        expect(await restoreRecord(front.page)).toBe(FRONT_URL);

        await setGate(extension, false);
        await expect.poll(async () => (await pageFootprint(front.page)).hosts, SETTLE).toEqual([]);
        await expect.poll(async () => (await pageFootprint(adminPage)).hosts, SETTLE).toEqual([]);
        const footprint = await pageFootprint(front.page);
        expect(footprint.htmlOverflow, 'the page scroll is back').toBe('');
        expect(footprint.bodyOverflow).toBe('');
        expect(footprint.documentStyles).toBe(0);
        expect(await restoreRecord(front.page), 'the reload-restore record is cleared').toBeNull();

        await setGate(extension, true);
        await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
        await expect.poll(() => hosts(adminPage, KC_HOST), SETTLE).toBe(1);
        await expect(sbsOpen(front.page), 'the overlay open at gate-off re-opens').toHaveCount(
          1,
          SETTLE
        );
      } finally {
        await front.page.close();
      }
    }
  );

  siteTest('a site’s widget opt-out holds across gate off → on', async ({ extension }) => {
    await setSiteEntry(extension, false);
    const front = await openSitePage(extension, FRONT_URL);
    try {
      await expectWorldAlive(extension, front.tabId);
      expect(await hosts(front.page, STRIP_HOST)).toBe(0);
      await setGate(extension, false);
      await setGate(extension, true);
      await expectWorldAlive(extension, front.tabId);
      expect(await hosts(front.page, STRIP_HOST), 'the opt-out still holds').toBe(0);
      // The entry is untouched by the gate: clearing it shows the widget.
      await setSiteEntry(extension, null);
      await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
    } finally {
      await front.page.close();
    }
  });

  siteTest(
    'the Side-by-Side reload restore cannot survive a gate-off boot',
    async ({ extension }) => {
      const front = await openSitePage(extension, FRONT_URL);
      try {
        expect(await extension.sendToTab<boolean>(front.tabId, 'openSideBySide')).toBe(true);
        await expect(sbsOpen(front.page)).toHaveCount(1, SETTLE);
        expect(await restoreRecord(front.page)).toBe(FRONT_URL);
        // The overlay is open and the record set; the next load boots with the
        // gate off. Re-record it once the live off has fully landed (its
        // close clears the record — a late clear would otherwise delete the
        // re-written one and the boot below would test nothing).
        await setGate(extension, false);
        await expect.poll(() => hosts(front.page, SBS_HOST), SETTLE).toBe(0);
        await expect.poll(() => restoreRecord(front.page), SETTLE).toBeNull();
        await front.page.evaluate(
          (arg: { key: string; href: string }) => {
            sessionStorage.setItem(arg.key, arg.href);
          },
          { key: SBS_RESTORE_KEY, href: FRONT_URL }
        );
        expect(await restoreRecord(front.page), 'the record is in place for the boot').toBe(
          FRONT_URL
        );
        await front.page.reload({ waitUntil: 'load' });
        await expectWorldAlive(extension, front.tabId);
        expect(await hosts(front.page, SBS_HOST)).toBe(0);
        // The record is consumed at DOMContentLoaded (already past here).
        expect(await restoreRecord(front.page), 'the boot consumed the record').toBeNull();

        await setGate(extension, true);
        await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
        expect(await hosts(front.page, SBS_HOST), 'a later gate-on does not resurrect it').toBe(0);
      } finally {
        await front.page.close();
      }
    }
  );

  siteTest(
    'the builder overlay: a live off ends it; an injection racing a gate-off never stays',
    async ({ extension }) => {
      // The explicit open's refusal (`page-ui-off`, nothing injected) is the
      // background opener's, unit-tested: a standalone extension page's sender
      // has a tab, and the opener answers tab-less (DevTools) senders only.
      const front = await openSitePage(extension, FRONT_URL);
      try {
        await front.page.evaluate(recordHosts);
        // Positive control (gate on): the overlay mounts — and how long that
        // takes bounds the racing case's observation window below.
        const started = Date.now();
        await injectOverlay(extension, front);
        const mountMs = Date.now() - started;
        expect(await hosts(front.page, BUILDER_HOST)).toBe(1);

        // A live off ends the open overlay.
        await setGate(extension, false);
        await expect.poll(() => hosts(front.page, BUILDER_HOST), SETTLE).toBe(0);
        const builderEntries = async (): Promise<string[]> =>
          (await hostLog(front.page)).filter((entry) => entry.endsWith(BUILDER_HOST));
        expect(await builderEntries()).toEqual([`+${BUILDER_HOST}`, `-${BUILDER_HOST}`]);

        // An injection that raced a gate-off write: the instance follows the
        // gate from its first moment. Watched for several times the measured
        // mount time, it either never mounts or leaves at once — never stays.
        await extension.evaluateInWorker(async (tabId: number) => {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            files: ['/content-scripts/exclusion-overlay.js']
          });
        }, front.tabId);
        await stayQuiet(front.page, Math.max(3 * mountMs, QUIET_WINDOW_MS));
        expect(await hosts(front.page, BUILDER_HOST)).toBe(0);
        const raced = (await builderEntries()).slice(2);
        expect(
          raced.filter((entry) => entry.startsWith('+')).length,
          'every racing insertion was removed'
        ).toBe(raced.filter((entry) => entry.startsWith('-')).length);
      } finally {
        await front.page.close();
      }
    }
  );

  siteTest(
    'the palette follows the gate on a real page: chord and menu open, both die while off',
    async ({ extension }) => {
      // Calibration (gate on): how long a fresh page takes until the chord
      // opens the palette — the gate read, then the chord's read and platform
      // ask, more than a gate-off boot does. The boot-off press below waits
      // several times that, so it lands in the settled `off` state, never
      // while the module still boots (where the chord is inert too).
      await setGate(extension, null);
      const calibration = await openSitePage(extension, FRONT_URL);
      let armMs: number;
      try {
        const started = Date.now();
        const openField = calibration.page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`);
        await expect
          .poll(async () => {
            if ((await openField.count()) === 0) await calibration.page.keyboard.press('Alt+KeyK');
            return await openField.count();
          }, SETTLE)
          .toBe(1);
        armMs = Date.now() - started;
      } finally {
        await calibration.page.close();
      }

      await setGate(extension, false);
      const front = await openSitePage(extension, FRONT_URL);
      const page = front.page;
      const field = page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`);
      try {
        await expectWorldAlive(extension, front.tabId);
        await recordKeys(page);
        await stayQuiet(page, Math.max(3 * armMs, QUIET_WINDOW_MS));
        // Boot off: the chord is an ordinary keystroke, the menu's send finds no receiver.
        await page.keyboard.press('Alt+KeyK');
        expect(await takeKeys(page), 'not consumed on a gate-off boot').toEqual(['alt+KeyK']);
        await expect(
          extension.sendToTab<boolean>(front.tabId, 'openCommandPalette')
        ).rejects.toThrow();
        expect(await hosts(page, PALETTE_HOST)).toBe(0);

        // Gate on (no reload): the chord arms and opens the palette — the
        // module behind the boot-off press was alive and settled.
        await setGate(extension, true);
        await expect
          .poll(async () => {
            if ((await field.count()) === 0) await page.keyboard.press('Alt+KeyK');
            return await field.count();
          }, SETTLE)
          .toBe(1);
        await expect(field).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(field).toHaveCount(0);
        // The menu's send opens it too.
        expect(await extension.sendToTab<boolean>(front.tabId, 'openCommandPalette')).toBe(true);
        await expect(field).toBeFocused({ timeout: SETTLE.timeout });
        await page.keyboard.press('Escape');

        // Live off: the view leaves and the chord passes to the page again.
        await setGate(extension, false);
        await expect.poll(() => hosts(page, PALETTE_HOST), SETTLE).toBe(0);
        await takeKeys(page);
        await page.keyboard.press('Alt+KeyK');
        expect(await takeKeys(page), 'not consumed after a live off').toEqual(['alt+KeyK']);
        expect(await hosts(page, PALETTE_HOST)).toBe(0);
      } finally {
        await page.close();
      }
    }
  );
});
