/**
 * The Known Conflicts freshness row's browser suite, over the real
 * background service and the real endpoint.
 *
 * Assert surfaces, named per test: the row's rendered state (stamp text /
 * never-synced line, the card stays mounted), the toast region (the typed
 * outcomes), the real `local:known-conflicts-db$` meta read back from the
 * service worker, and the keyboard + axe legs per state.
 *
 * - **Success** — the stamp seed is two hours old, a refresh advances it
 *   (the rendered age flips to "just now"; the stored stamp moves) and the
 *   success toast confirms.
 * - **Offline** — `context.setOffline(true)` applies to the service
 *   worker's own fetches on this Chromium build (probed live: an https
 *   fetch throws while the run's loopback pages still answer), so the
 *   background's classified failure path answers `null` and the row's
 *   honest refusal toast names the remedy; the stored stamp never moves;
 *   the control re-enables.
 * - **Corrupt meta** — a garbage `updatedAt` reads as the never-synced
 *   line, never a fabricated age.
 *
 * Every leg first waits for the background's boot prime to settle (probed:
 * the startup refresh lands ~1–2 s after the launch and re-runs on every
 * service-worker start) — a click or a meta write racing that flight gets
 * the honest-but-unwanted refusal or has its write re-stamped under it.
 */

import type { Page } from '@playwright/test';

import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { runPanelAxe } from '../helpers/audit';
import {
  KC_NEVER_SYNCED,
  KC_REFRESH_FAILURE_TITLE,
  KC_REFRESH_SUCCESS_TITLE,
  KC_REFRESH_REFUSAL,
  openOptionsPage,
  resetStoredOptions
} from '../helpers/options';

/** The WXT meta item's key (`$` suffix) — the stamp lives here. */
const DB_META_KEY = 'known-conflicts-db$';

/** Two hours: the seeded age the success leg reads before refreshing. */
const SEEDED_AGE_MS = 2 * 3_600_000;

/**
 * Read the DB item's meta (the stamp) from the service worker.
 *
 * @param driver The extension driver.
 */
async function readMeta(driver: ExtensionDriver): Promise<{ updatedAt?: unknown }> {
  return await driver.evaluateInWorker(async (key: string): Promise<{ updatedAt?: unknown }> => {
    const stored: unknown = (await chrome.storage.local.get([key]))[key];
    return typeof stored === 'object' && stored !== null ? stored : {};
  }, DB_META_KEY);
}

/**
 * Write the DB item's meta from the service worker (the same raw seam the
 * site suites use for the DB; the background owns the stamp in real use, so
 * the suite restores exactly what it replaces).
 *
 * @param driver The extension driver.
 * @param meta The meta value to write.
 */
async function writeMeta(driver: ExtensionDriver, meta: Record<string, unknown>): Promise<void> {
  await driver.evaluateInWorker(
    async (payload: { key: string; meta: Record<string, unknown> }) => {
      await chrome.storage.local.set({ [payload.key]: payload.meta });
    },
    { key: DB_META_KEY, meta }
  );
}

/** The rendered stamp text (null when the never-synced line renders). */
async function stampText(page: Page): Promise<string | null> {
  const count = await page.locator('[data-fdt="kc-stamp"]').count();
  return count > 0 ? ((await page.locator('[data-fdt="kc-stamp"]').textContent()) ?? '') : null;
}

/** Wait for a stable rendered state: the KC row past its reading skeleton. */
async function kcRowSettled(page: Page): Promise<void> {
  await expect(
    page.locator('[data-fdt="kc-freshness-row"]'),
    'the freshness row renders'
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator('[data-fdt="kc-freshness-loading"]'),
    'the reading skeleton is gone'
  ).toHaveCount(0);
}

/**
 * Wait until the background's boot prime has settled, so no later write and
 * no click can race its flight: the poll waits for the stamp to read as a
 * NUMBER at all (the launch prime stamps exactly when its fetch+write
 * finishes — an unstamped DB means the prime is still flying or the machine
 * is offline, which the success leg's endpoint round needs anyway), then a
 * short stability read confirms no further stamp lands.
 *
 * @param driver The extension driver.
 */
async function bootPrimeSettled(driver: ExtensionDriver): Promise<void> {
  await expect
    .poll(
      async () => {
        const meta = await readMeta(driver);
        return typeof meta.updatedAt === 'number';
      },
      { timeout: 30_000, intervals: [500, 1_000] }
    )
    .toBe(true);
  // The single-flight lock releases with the stamp write; the stability read
  // proves the stamp stopped moving before this suite writes or clicks.
  const settled = await readMeta(driver);
  await new Promise((resolve) => setTimeout(resolve, 750));
  const again = await readMeta(driver);
  expect(again.updatedAt, 'the boot prime settled (the stamp stopped moving)').toBe(
    settled.updatedAt
  );
}

test.describe('options known-conflicts freshness', () => {
  test('a successful refresh advances the stamp, flips the rendered age, and confirms with a toast', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    await bootPrimeSettled(extension);
    const seededAt = Date.now() - SEEDED_AGE_MS;
    await writeMeta(extension, { updatedAt: seededAt });

    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await kcRowSettled(page);
      expect(
        await stampText(page),
        'the seeded two-hour age renders through the shared formatter'
      ).toBe('2 h ago');

      // The typed request: the background fetches the real endpoint, stamps
      // storage, and answers { updatedAt } — the card re-renders + confirms.
      // The toast assert carries the fetch's own 10 s cap (a slow endpoint
      // delays the toast, never skips it).
      await page.getByRole('button', { name: 'Refresh now' }).click();
      await expect(
        page.getByRole('status').filter({ hasText: KC_REFRESH_SUCCESS_TITLE })
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => await stampText(page), { timeout: 20_000, intervals: [250, 500] })
        .toBe('just now');
      const metaAfter = await readMeta(extension);
      expect(
        typeof metaAfter.updatedAt === 'number' ? metaAfter.updatedAt : -1,
        'the stored stamp advanced past the seeded age'
      ).toBeGreaterThan(seededAt);

      // The stable stamped state audits clean (the toast auto-dismisses
      // first — transient surfaces are the toast component's own tier).
      await expect(page.locator('[data-fdt="toast"]')).toHaveCount(0, { timeout: 10_000 });
      const audit = await runPanelAxe(page);
      expect(audit.violations, audit.detail.join('\n')).toEqual([]);
      expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('a corrupt stamp reads as the never-synced line, never a fabricated age', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    await bootPrimeSettled(extension);
    const metaBefore = await readMeta(extension);
    await writeMeta(extension, { updatedAt: 'two hours ago, honest' });

    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await kcRowSettled(page);
      const line = await page.locator('[data-fdt="kc-sync-state"]').textContent();
      expect(line, 'the never-synced reading is the degrade').toBe(KC_NEVER_SYNCED);
      expect(await stampText(page), 'no stamp span, so no fabricated age').toBeNull();

      // The never-synced state audits clean too (the round's second state).
      const audit = await runPanelAxe(page);
      expect(audit.violations, audit.detail.join('\n')).toEqual([]);
      expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);
    } finally {
      // Restore whatever the boot had stamped (the suite's own baseline).
      await writeMeta(extension, metaBefore);
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('an offline refresh lands the honest refusal with its remedy, and the stamp never moves', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    await bootPrimeSettled(extension);
    const metaBefore = await readMeta(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await kcRowSettled(page);
      const stampBefore = await stampText(page);
      await extension.browserContext.setOffline(true);

      // Keyboard leg: the control is reached and fired from the keyboard
      // (Tab-reachability across the whole page is the a11y suite's walk).
      const refresh = page.getByRole('button', { name: 'Refresh now' });
      await refresh.focus();
      await page.keyboard.press('Space');
      await expect(
        page.getByRole('alert').filter({ hasText: KC_REFRESH_FAILURE_TITLE }),
        'the refusal toast announces assertively'
      ).toBeVisible();
      await expect(
        page.getByRole('alert').filter({ hasText: KC_REFRESH_REFUSAL }),
        'the refusal names the remedy, verbatim'
      ).toBeVisible();

      // The stamp never moved; the control re-enabled (busy resolved).
      expect(await stampText(page), 'a failed refresh leaves the last reading in place').toBe(
        stampBefore
      );
      const metaAfter = await readMeta(extension);
      expect(metaAfter.updatedAt ?? -1, 'the stored stamp did not advance').toBe(
        metaBefore.updatedAt ?? -1
      );
      await expect(
        refresh,
        'the single refresh resolved — the control answers again'
      ).toBeEnabled();

      // The refusal state (toast up) audits clean as well.
      const audit = await runPanelAxe(page);
      expect(audit.violations, audit.detail.join('\n')).toEqual([]);
      expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);
    } finally {
      await extension.browserContext.setOffline(false);
      await resetStoredOptions(extension);
      await page.close();
    }
  });
});
