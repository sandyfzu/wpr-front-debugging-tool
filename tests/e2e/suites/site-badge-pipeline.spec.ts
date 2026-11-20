/**
 * Toolbar badge over the real site's pages.
 *
 * The fixture pipeline suite pins the badge MECHANICS (dot glyph, transparent
 * tile, green/gray states) over fixture pages. This suite pins the state
 * only the real site can produce — the blue present-but-uncached state —
 * plus the navigation supersede, the nothing-re-sets clear, and the live
 * `features.toolbarBadge` option flip.
 *
 * Assert surface: the `chrome.action` badge state evaluated in the SW.
 *
 * Real-URL facts (verified against the live stack):
 * - `/fdt/` is cache-served on a fresh profile's first visit → cached → green.
 * - a first-hit URL whose params are in `cache_query_strings` (unique
 *   `fdt-delay` value per run) is live-optimized but not cache-served →
 *   present-but-uncached → blue.
 * - `?nowprocket=1` bypasses everything → no WP Rocket footprint → gray.
 * - revisits in the same profile revalidate (the site answers 304) and keep
 *   serving the same document, so each state is stable for its tab.
 */

import { expect, type ExtensionDriver } from '../helpers/extension';
import { BADGE_COLORS, BADGE_DOT, POLLED_BADGE_OPTIONS, readBadge } from '../helpers/badge';
import { openSitePage, SITE_URL, siteTest } from '../helpers/site';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
siteTest.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/** A unique cacheable flagged URL per run (first-hit = live-optimized). */
const flaggedUrl = (): string => `${SITE_URL}/?fdt-error=reference&fdt-delay=${String(Date.now())}`;

/** The raw stored-options shape the suite writes (the validator's own slots). */
interface RawStoredOptions {
  improvements?: Record<string, boolean>;
  appearance?: string;
  features?: Record<string, boolean>;
}

/**
 * Flip the toolbar-badge feature key in the real sync:options item.
 *
 * @param extension The extension driver.
 * @param enabled The value to write.
 */
async function flipToolbarBadge(extension: ExtensionDriver, enabled: boolean): Promise<void> {
  await extension.evaluateInWorker(async (on: boolean) => {
    const stored = (await chrome.storage.sync.get('options'))['options'] as
      RawStoredOptions | undefined;
    const current: RawStoredOptions = stored ?? {
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: { toolbarBadge: true }
    };
    current.features = { ...current.features, toolbarBadge: on };
    await chrome.storage.sync.set({ options: current });
  }, enabled);
}

siteTest.describe('site badge pipeline', () => {
  siteTest(
    'the cached page reads green and the first-hit flagged page reads blue',
    async ({ extension }) => {
      const cachedPage = await openSitePage(extension, `${SITE_URL}/fdt/`);
      await expect
        .poll(async () => (await readBadge(extension, cachedPage.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_DOT);
      expect(
        (await readBadge(extension, cachedPage.tabId)).color,
        'the cache-served page reads the green state'
      ).toBe(BADGE_COLORS.cached);

      const flaggedPage = await openSitePage(extension, flaggedUrl());
      await expect
        .poll(
          async () => (await readBadge(extension, flaggedPage.tabId)).text,
          POLLED_BADGE_OPTIONS
        )
        .toBe(BADGE_DOT);
      expect(
        (await readBadge(extension, flaggedPage.tabId)).color,
        'the live-optimized first-hit page reads the blue state'
      ).toBe(BADGE_COLORS.presentUncached);
      await cachedPage.page.close();
      await flaggedPage.page.close();
    }
  );

  siteTest('a navigation supersedes the badge state on the same tab', async ({ extension }) => {
    const page = await openSitePage(extension, `${SITE_URL}/fdt/`);
    await expect
      .poll(async () => (await readBadge(extension, page.tabId)).color, POLLED_BADGE_OPTIONS)
      .toBe(BADGE_COLORS.cached);

    await page.page.goto(flaggedUrl(), { waitUntil: 'load' });
    await expect
      .poll(async () => (await readBadge(extension, page.tabId)).color, POLLED_BADGE_OPTIONS)
      .toBe(BADGE_COLORS.presentUncached);

    await page.page.goto(`${SITE_URL}/fdt/`, { waitUntil: 'load' });
    await expect
      .poll(async () => (await readBadge(extension, page.tabId)).color, POLLED_BADGE_OPTIONS)
      .toBe(BADGE_COLORS.cached);
    await page.page.close();
  });

  siteTest(
    'a navigation to a non-page clears the badge and nothing re-sets it',
    async ({ extension }) => {
      const page = await openSitePage(extension, `${SITE_URL}/fdt/?nowprocket=1`);
      await expect
        .poll(async () => (await readBadge(extension, page.tabId)).color, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_COLORS.absent);

      // chrome:// pages run no content script: the navigation clears the tab's
      // badge and no page ever reports a state again — the badge stays gone.
      await page.page.goto('chrome://version/');
      await expect
        .poll(async () => (await readBadge(extension, page.tabId)).text, {
          timeout: 4_000,
          intervals: [100, 250]
        })
        .toBe('');
      await page.page.close();
    }
  );

  siteTest(
    'the toolbarBadge option applies live, without a service-worker restart',
    async ({ extension }) => {
      const page = await openSitePage(extension, `${SITE_URL}/fdt/?nowprocket=1`);
      await expect
        .poll(async () => (await readBadge(extension, page.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_DOT);

      // Gate off (write the sync:options item from the SW): the watch sweeps
      // every rendered badge — no page reload, no worker restart.
      await flipToolbarBadge(extension, false);
      await expect
        .poll(async () => (await readBadge(extension, page.tabId)).text, {
          timeout: 4_000,
          intervals: [100, 250]
        })
        .toBe('');

      // Gate back on: the badge re-applies from the kept summary — still no
      // reload, and the state matches the page the tab still shows (gray).
      await flipToolbarBadge(extension, true);
      await expect
        .poll(async () => (await readBadge(extension, page.tabId)).text, POLLED_BADGE_OPTIONS)
        .toBe(BADGE_DOT);
      expect(
        (await readBadge(extension, page.tabId)).color,
        'the re-applied state matches the tab page (gray)'
      ).toBe(BADGE_COLORS.absent);
      await page.page.close();
    }
  );
});
