/**
 * The content-script restart signal is not the page's to pull.
 *
 * WXT ends a content script's context when `document` receives the
 * `<extension id>:<script>:wxt:content-script-started` event of a newer
 * start; the page shares that DOM and the id is public, so a hostile page
 * could forge it and silence the tool for the load. Each isolated-world
 * script now refuses a start event while its own extension context is live
 * (a real extension reload leaves the old context dead, and the event then
 * reaches WXT as before), a newer same-world start ends the older instance
 * through state only our world can read, and no start is broadcast to the
 * page's `message` listeners.
 *
 * - Forged events for every isolated-world script leave the isolated script
 *   (page data), the identity relay (device-simulation push) and a mounted
 *   builder overlay alive.
 * - The page receives no start broadcast at load or at a runtime injection.
 * - Injecting the overlay twice into one page leaves one live overlay (the
 *   newer start still ends the older instance).
 */
import type { Page } from '@playwright/test';

import { OVERLAY_HOST, injectOverlay } from '../helpers/exclusion-overlay';
import {
  expect,
  openFixturePage,
  test,
  wireEnvelope,
  type DriverPage,
  type ExtensionDriver,
  type WireEnvelope
} from '../helpers/extension';

/** The hostile fixture: records start broadcasts, forges restart events. */
const FIXTURE = '/restart-signal/hostile.html';

/** Every isolated-world content script the extension ships (manifest + runtime). */
const ISOLATED_WORLD_SCRIPTS = ['isolated', 'ua-relay', 'command-palette', 'exclusion-overlay'];

/**
 * Forge the restart event of `script` from the page's own world.
 *
 * @param page The hostile page.
 * @param extensionId The (public) extension id.
 * @param script The content script's entrypoint name.
 */
async function forgeRestart(page: Page, extensionId: string, script: string): Promise<void> {
  await page.evaluate(
    ({ extensionId, script }) => {
      (window as unknown as { __forgeRestart: (id: string, name: string) => void }).__forgeRestart(
        extensionId,
        script
      );
    },
    { extensionId, script }
  );
}

/** The start broadcasts the page received. */
const startBroadcasts = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __startBroadcasts: string[] }).__startBroadcasts);

/**
 * Send one protocol envelope to the tab's top frame and return the reply's
 * `res` — the probe that a content script's listener is still registered.
 *
 * @param extension The driver.
 * @param tabId The tab.
 * @param envelope The protocol envelope.
 * @returns The listener's answer, or the error text when none answered.
 */
async function askTopFrame(
  extension: ExtensionDriver,
  tabId: number,
  envelope: WireEnvelope
): Promise<unknown> {
  return await extension.evaluateInWorker(
    async ({ tabId, envelope }: { tabId: number; envelope: WireEnvelope }) => {
      try {
        const reply = await chrome.tabs.sendMessage<WireEnvelope, { res?: unknown } | undefined>(
          tabId,
          envelope,
          { frameId: 0 }
        );
        return reply?.res ?? 'no answer';
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    },
    { tabId, envelope }
  );
}

/**
 * Whether the isolated script still serves the panel's page data.
 *
 * @param extension The driver.
 * @param opened The tab.
 */
async function isolatedAnswers(extension: ExtensionDriver, opened: DriverPage): Promise<boolean> {
  const res = await askTopFrame(extension, opened.tabId, wireEnvelope('getFdtData', undefined));
  return typeof res === 'object' && res !== null;
}

/**
 * Whether the identity relay still acknowledges a device-simulation push
 * (the state pushed is "nothing simulates": no page effect).
 *
 * @param extension The driver.
 * @param opened The tab.
 */
async function relayAnswers(extension: ExtensionDriver, opened: DriverPage): Promise<boolean> {
  const res = await askTopFrame(
    extension,
    opened.tabId,
    wireEnvelope('deviceSimulationChanged', { available: true, enabled: false })
  );
  return res === true;
}

test.describe('content-script restart signal vs a hostile page', () => {
  test('forged restart events stop none of the isolated-world scripts', async ({ extension }) => {
    const id = await extension.extensionId();
    const opened = await openFixturePage(extension, FIXTURE);
    await expect.poll(() => isolatedAnswers(extension, opened)).toBe(true);
    await expect.poll(() => relayAnswers(extension, opened)).toBe(true);
    await injectOverlay(extension, opened);

    for (const script of ISOLATED_WORLD_SCRIPTS) await forgeRestart(opened.page, id, script);

    expect(await isolatedAnswers(extension, opened)).toBe(true);
    expect(await relayAnswers(extension, opened)).toBe(true);
    await expect(opened.page.locator(OVERLAY_HOST)).toHaveCount(1);
    await expect(
      opened.page.getByRole('heading', { name: 'Exclusion Builder', exact: true })
    ).toBeVisible();
    await opened.page.close();
  });

  test('the page receives no start broadcast naming the extension', async ({ extension }) => {
    const opened = await openFixturePage(extension, FIXTURE);
    await expect.poll(() => isolatedAnswers(extension, opened)).toBe(true);
    await injectOverlay(extension, opened);
    expect(await startBroadcasts(opened.page)).toEqual([]);
    await opened.page.close();
  });

  test('a newer same-world start still ends the older instance', async ({ extension }) => {
    const opened = await openFixturePage(extension, FIXTURE);
    await injectOverlay(extension, opened);
    await injectOverlay(extension, opened);
    await expect(opened.page.locator(OVERLAY_HOST)).toHaveCount(1);
    await opened.page.close();
  });
});
