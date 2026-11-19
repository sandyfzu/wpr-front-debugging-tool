/**
 * The admin-bar improvement on real wp-admin pages.
 *
 * The option-on admin bar carries the "WPR D-bugger" entry exactly once,
 * with the admin base derived from WP Rocket's own bar anchor (this install
 * serves at the root, so the derived href is the full absolute tools-page
 * URL); the flip-off removes it after a reload (the improvement is one-shot
 * by design and re-reads on the next page); flipping back restores it.
 *
 * Assert surface: the host page's own DOM (the admin bar is the page's
 * markup — the entry is deliberately NOT shadow-isolated: it must live in
 * the admin bar's own tree).
 *
 * The option flips ride the real `sync:options` item (written from the SW,
 * read back by the next page load), which is also how the options page will
 * set it once its phase lands.
 */

import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { SITE_URL, siteTest } from '../helpers/site';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
siteTest.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/** Id of the admin-bar list item this module owns. */
const DBUGGER_ITEM_ID = 'wp-admin-bar-d-bugger';

/** Exact label (user-facing string parity). */
const DBUGGER_LABEL = 'WPR D-bugger';

/** The entry's read-back (page DOM probe). */
interface DbuggerRead {
  count: number;
  label: string | null;
  href: string | null;
}

/**
 * Read the D-bugger entry state from the live admin bar.
 *
 * @param page An authenticated admin page.
 */
async function readDbugger(page: Page): Promise<DbuggerRead> {
  return await page.evaluate((id: string) => {
    const items = document.querySelectorAll(`#${id}`);
    const anchor = items[0]?.querySelector('a');
    return {
      count: items.length,
      label: anchor?.textContent ?? null,
      href: anchor?.getAttribute('href') ?? null
    };
  }, DBUGGER_ITEM_ID);
}

/** The raw stored-options shape the suite writes (the validator's own slots). */
interface RawStoredOptions {
  improvements?: Record<string, boolean>;
  appearance?: string;
  features?: Record<string, boolean>;
}

/**
 * Flip the dbugger improvement option in the real sync:options item.
 *
 * @param extension The extension driver.
 * @param enabled The value to write.
 */
async function flipDbuggerOption(extension: ExtensionDriver, enabled: boolean): Promise<void> {
  await extension.evaluateInWorker(async (on: boolean) => {
    const stored = (await chrome.storage.sync.get('options'))['options'] as
      RawStoredOptions | undefined;
    const current: RawStoredOptions = stored ?? {
      improvements: { 'wp-dashboard-dbugger-entry': true },
      appearance: 'system',
      features: { toolbarBadge: true }
    };
    current.improvements = {
      ...current.improvements,
      'wp-dashboard-dbugger-entry': on
    };
    await chrome.storage.sync.set({ options: current });
  }, enabled);
}

siteTest.describe('site improvements admin bar', () => {
  siteTest(
    'the option-on admin bar carries the D-bugger entry exactly once',
    async ({ adminPage, extension }) => {
      await flipDbuggerOption(extension, true);
      await adminPage.goto(`${SITE_URL}/wp-admin/index.php`, { waitUntil: 'load' });
      const read = await readDbugger(adminPage);
      expect(read.count, 'the entry is built once (idempotent on re-render)').toBe(1);
      expect(read.label, 'the exact user-facing label').toBe(DBUGGER_LABEL);
      expect(read.href, 'the derived admin base keeps the link on this install').toBe(
        `${SITE_URL}/wp-admin/tools.php?page=wprockettoolset`
      );
    }
  );

  siteTest(
    'flipping the option off removes the entry after a reload',
    async ({ adminPage, extension }) => {
      await flipDbuggerOption(extension, false);
      await adminPage.goto(`${SITE_URL}/wp-admin/index.php`, { waitUntil: 'load' });
      const read = await readDbugger(adminPage);
      expect(read.count, 'no entry renders when the option is off').toBe(0);
    }
  );

  siteTest(
    'flipping the option back on restores the entry, exactly once',
    async ({ adminPage, extension }) => {
      await flipDbuggerOption(extension, true);
      await adminPage.goto(`${SITE_URL}/wp-admin/index.php`, { waitUntil: 'load' });
      const read = await readDbugger(adminPage);
      expect(read.count, 'the restored entry is still built exactly once').toBe(1);
      expect(read.label, 'the label stays the parity string').toBe(DBUGGER_LABEL);
    }
  );
});
