/**
 * P19D — the on-page UI gate over every gated surface on the real docker
 * site: the detection widget (front page + plugins screen), the Known
 * Conflicts card (plugins screen), the Side-by-Side overlay and the
 * exclusion builder overlay.
 *
 * - Boot off: nothing mounts — the page stays pristine (no `wpr-fdt-*`
 *   host, no shadow-root document style, no scroll lock) although the
 *   isolated world is alive (it answers the liveness probe).
 * - Live off: every visible surface leaves the running page (SBS restores
 *   the page scroll and clears its reload-restore record); live on: each
 *   comes back per its own state (SBS re-opens since it was open).
 * - Per-site widget opt-outs hold across gate off → on.
 * - The SBS reload restore cannot survive a gate-off boot (record consumed,
 *   nothing opens, and a later gate-on does not resurrect it).
 * - The builder overlay: an injection racing a gate-off write and a live
 *   off both end it (the background opener's `page-ui-off` refusal is
 *   unit-tested — a standalone extension page is not a tab-less sender).
 *
 * The gate is written through the service worker (the options switch's and
 * the menu rescue's exact storage write). Every test restores the gate and
 * the per-site entries it touched.
 */
import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { OVERLAY_HOST as BUILDER_HOST, injectOverlay } from '../helpers/exclusion-overlay';
import { SITE_ORIGIN, SITE_URL, openSitePage, siteTest } from '../helpers/site';

/** The gated surfaces' shadow hosts. */
const STRIP_HOST = 'wpr-fdt-inspector';
const KC_HOST = 'wpr-fdt-known-conflicts';
const SBS_HOST = 'wpr-fdt-side-by-side';
/** The sync keys the suite drives. */
const GATE_KEY = 'page-ui-gate';
const ORIGINS_KEY = 'inspector-origins';
/** The SBS reload-restore record (tab `sessionStorage`). */
const SBS_RESTORE_KEY = 'wpr-fdt-sbs-open';
/** A cached front-end page and the plugins screen (Known Conflicts' wp-admin mode). */
const FRONT_URL = `${SITE_URL}/fdt/`;
const PLUGINS_URL = `${SITE_URL}/wp-admin/plugins.php`;
/** Mount settle (hub pass, DB load, the plugins screen's late pass). */
const SETTLE = { timeout: 15_000, intervals: [250, 500] };

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
      else await chrome.storage.sync.set({ [arg.key]: { [arg.origin]: arg.enabled } });
    },
    { key: ORIGINS_KEY, origin: SITE_ORIGIN, enabled }
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
      // The plugins screen hosts the widget and the Known Conflicts card.
      await adminPage.goto(PLUGINS_URL, { waitUntil: 'load' });
      const front = await openSitePage(extension, FRONT_URL);
      try {
        await expectWorldAlive(extension, front.tabId);
        expect(await pageFootprint(front.page)).toEqual({
          hosts: [],
          documentStyles: 0,
          htmlOverflow: '',
          bodyOverflow: ''
        });
        // An explicit Side-by-Side open is refused too (the gate outranks it).
        expect(await extension.sendToTab<boolean>(front.tabId, 'openSideBySide')).toBe(true);
        expect(await hosts(front.page, SBS_HOST)).toBe(0);
        // The Known Conflicts late pass (1 s after load) has had its chance.
        await expect.poll(async () => (await pageFootprint(adminPage)).hosts, SETTLE).toEqual([]);

        // The modules were alive and waiting: a gate-on brings them in.
        await setGate(extension, true);
        await expect.poll(() => hosts(front.page, STRIP_HOST), SETTLE).toBe(1);
        await expect.poll(() => hosts(adminPage, KC_HOST), SETTLE).toBe(1);
        await expect.poll(() => hosts(adminPage, STRIP_HOST), SETTLE).toBe(1);
        // Nothing that was never open comes up on its own.
        expect(await hosts(front.page, SBS_HOST)).toBe(0);
      } finally {
        await front.page.close();
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
        // gate off. Re-record it (the live off clears it) so the boot sees a
        // record it must refuse.
        await setGate(extension, false);
        await front.page.evaluate(
          (arg: { key: string; href: string }) => {
            sessionStorage.setItem(arg.key, arg.href);
          },
          { key: SBS_RESTORE_KEY, href: FRONT_URL }
        );
        await front.page.reload({ waitUntil: 'load' });
        await expectWorldAlive(extension, front.tabId);
        expect(await hosts(front.page, SBS_HOST)).toBe(0);
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
    'the builder overlay: an injection racing a gate-off and a live off both end it',
    async ({ extension }) => {
      // The explicit open's refusal (`page-ui-off`, nothing injected) is the
      // background opener's, unit-tested: a standalone extension page's sender
      // has a tab, and the opener answers tab-less (DevTools) senders only.
      const front = await openSitePage(extension, FRONT_URL);
      try {
        // An injection that raced a gate-off write: the overlay follows the
        // gate from its first moment and leaves.
        await setGate(extension, false);
        await extension.evaluateInWorker(async (tabId: number) => {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [0] },
            files: ['/content-scripts/exclusion-overlay.js']
          });
        }, front.tabId);
        await expect.poll(() => hosts(front.page, BUILDER_HOST), SETTLE).toBe(0);

        // A live off ends an open overlay.
        await setGate(extension, true);
        await injectOverlay(extension, front);
        expect(await hosts(front.page, BUILDER_HOST)).toBe(1);
        await setGate(extension, false);
        await expect.poll(() => hosts(front.page, BUILDER_HOST), SETTLE).toBe(0);
      } finally {
        await front.page.close();
      }
    }
  );
});
