/**
 * P9.1 — the D-bugger improvement round over the real site's wp-admin,
 * driven by the real options page (the P4.3 admin suite drives the same
 * storage seam directly; this suite drives the page's own Save path).
 *
 * The improvement is ONE-SHOT by design: the content script's improvement
 * module re-reads the option on the next wp-admin page load — toggling the
 * option (and saving it) changes nothing on an already-open admin page. The
 * assertion makes that explicit before reloading.
 *
 * Receipt honesty: this is a PAGE reload of the inspected admin document.
 * The service worker never restarts in this round and the suite makes no
 * restart claim — the P9B copy's "applies as soon as it is saved" refers to
 * the storage write, and the admin entry's application remains the next page
 * load's business.
 *
 * Cookie lifecycle is file-owned, deliberately NOT the shared `siteTest`
 * adminPage fixture: that fixture is worker-scoped and would be created (and
 * logged in) HERE — the alphabetically first login-bearing file — and its
 * single login cannot be revoked for the files that need an anonymous
 * visitor (the badge pipeline's cached-truth legs) nor re-established for
 * the files that need a session (their fixture never runs again). This file
 * logs its own page in and clears the site's cookies on the way out, leaving
 * the shared profile's neutral anonymous state.
 */

import { expect, test } from '../helpers/extension';
import type { Page } from '@playwright/test';
import {
  openOptionsPage,
  resetStoredOptions,
  rowSwitchInput,
  rowSwitchTrack,
  saveOptions
} from '../helpers/options';
import { loginAdminPage, SITE_URL } from '../helpers/site';

/** Id of the admin-bar list item the improvement module owns. */
const DBUGGER_ITEM_ID = 'wp-admin-bar-d-bugger';
/** Exact label (user-facing string parity). */
const DBUGGER_LABEL = 'WPR D-bugger';
/** The row's storage id. */
const DBUGGER_ROW_ID = 'wp-dashboard-dbugger-entry';

/** Read the D-bugger entry state from the live admin bar (page DOM probe). */
function readDbugger(adminPage: Page): Promise<{
  count: number;
  label: string | null;
}> {
  return adminPage.evaluate((id: string) => {
    const items = document.querySelectorAll(`#${id}`);
    return {
      count: items.length,
      label: items[0]?.querySelector('a')?.textContent ?? null
    };
  }, DBUGGER_ITEM_ID);
}

test.describe('options dbugger admin round', () => {
  /** This file's own authenticated admin page; closed + wiped in afterAll. */
  let adminPage: Page | null = null;

  test.beforeAll(async ({ extension }) => {
    adminPage = await extension.browserContext.newPage();
    await loginAdminPage(adminPage);
  });

  test.afterAll(async ({ extension }) => {
    if (adminPage !== null) await adminPage.close().catch(() => undefined);
    // Leave the shared profile ANONYMOUS: the later `site-*` files include
    // the badge pipeline's cached-truth legs (logged-in visitors get no
    // cache and no footprint), and the admin suites log in themselves.
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
  });

  test('toggling the improvement off changes nothing on the open admin page and removes the entry after its reload', async ({
    extension
  }) => {
    if (adminPage === null) throw new Error('the file-scoped admin page is missing');
    let options: Page | null = null;
    try {
      await resetStoredOptions(extension); // Defaults: the entry on.
      await adminPage.goto(`${SITE_URL}/wp-admin/index.php`, { waitUntil: 'load' });
      const before = await readDbugger(adminPage);
      expect(before.count, 'the entry renders on the default option').toBe(1);
      expect(before.label).toBe(DBUGGER_LABEL);

      // The real page path: toggle + Save (the toast proves the write landed).
      options = await openOptionsPage(extension, { colorScheme: 'light' });
      await rowSwitchTrack(options, DBUGGER_ROW_ID).click();
      await expect(rowSwitchInput(options, DBUGGER_ROW_ID)).not.toBeChecked();
      await saveOptions(options);

      // One-shot behavior: the OPEN page keeps the entry (no live removal).
      const stillThere = await readDbugger(adminPage);
      expect(stillThere.count, 'the toggle alone changes nothing until the page reloads').toBe(1);

      // The inspected admin page reloads — the next load applies the option.
      await adminPage.reload({ waitUntil: 'load' });
      const after = await readDbugger(adminPage);
      expect(after.count, 'the entry is gone after the admin page reload').toBe(0);
    } finally {
      // No storage reset here on purpose: the persisted off state IS the next
      // round's precondition (this file's disclosed round chain), so the
      // reset belongs to that round's finally — this one only owns the
      // options page's close on every exit path.
      if (options !== null) await options.close().catch(() => undefined);
    }
  });

  test('flipping the improvement back on restores the entry after the admin page reloads', async ({
    extension
  }) => {
    if (adminPage === null) throw new Error('the file-scoped admin page is missing');
    let options: Page | null = null;
    try {
      await adminPage.goto(`${SITE_URL}/wp-admin/index.php`, { waitUntil: 'load' });
      expect(
        (await readDbugger(adminPage)).count,
        'the off state from the previous round holds'
      ).toBe(0);

      options = await openOptionsPage(extension, { colorScheme: 'light' });
      await rowSwitchTrack(options, DBUGGER_ROW_ID).click();
      await expect(rowSwitchInput(options, DBUGGER_ROW_ID)).toBeChecked();
      await saveOptions(options);
      expect(
        (await readDbugger(adminPage)).count,
        'still nothing live — the open page is untouched'
      ).toBe(0);

      await adminPage.reload({ waitUntil: 'load' });
      const restored = await readDbugger(adminPage);
      expect(
        restored.count,
        'the restored entry renders exactly once — count parity across the reload'
      ).toBe(1);
      expect(restored.label, 'the label stays the parity string').toBe(DBUGGER_LABEL);
    } finally {
      // Every exit path leaves the shared profile's neutral default shape
      // behind and no options page open (afterAll clears only the site's
      // cookies) — this round owns the file's storage reset, which is why the
      // first round's off state had to survive until here.
      await resetStoredOptions(extension);
      if (options !== null) await options.close().catch(() => undefined);
    }
  });
});
