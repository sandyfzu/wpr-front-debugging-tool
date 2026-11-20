/**
 * Known Conflicts over the real plugin tables and the real
 * DB flows.
 *
 * The wp-admin scans run against the docker site's real `plugins.php` (62
 * preinstalled conflict plugins); the DB flows run against the background's
 * real storage and its real serve path.
 *
 * Assert surfaces (named per assert): the shadow-DOM probe of the injected
 * Known Conflicts UI (badge + list), the SW-side storage read-back
 * (`known-conflicts-db` + its `$` meta item), and the background serve path
 * answered through the options page's runtime send (a real tabless extension
 * context).
 *
 * Independent expectation derivation: the expected findings are computed
 * inline (title-cell text containment over the stored rows) — the same rule
 * the wp-admin mode applies, restated as an assertion, never imported from
 * the extension.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { loginAdminPage, SITE_URL, siteTest } from '../helpers/site';

/** Shadow-root host of the Known Conflicts UI. */
const KC_HOST = 'wpr-fdt-known-conflicts';

/** Exact badge label (user-facing string parity). */
const BADGE_LABEL = 'Known Conflicts found';
/** Exact empty-state copy (the corrected string). */
const EMPTY_COPY = 'No known conflicts found...';
/** Exact list title (the corrected string). */
const LIST_TITLE = 'Known conflicts found';

/** The badge count display cap beyond which the badge reads `9+`. */
const BADGE_COUNT_CAP = 9;

/** The badge count as the view renders it (parity display rule). */
function badgeCount(count: number): string {
  return count > BADGE_COUNT_CAP ? `${String(BADGE_COUNT_CAP)}+` : String(count);
}

/** The settled badge's shape: label + `: N` (or `: 9+` beyond the cap). */
const SETTLED_BADGE_PATTERN = new RegExp(`^${BADGE_LABEL}: (\\d+\\+?)$`);

/** The UI's readable state (shadow-DOM probe + the page's own plugin cells). */
interface KcRead {
  badgeText: string | null;
  items: string[];
  copies: string[];
  cellText: string[];
  listTitle: string | null;
}

/**
 * Read the Known Conflicts UI and the plugins screen's plugin-title cells.
 *
 * @param page The plugins page.
 */
async function readKc(page: Page): Promise<KcRead> {
  return await page.evaluate((host: string) => {
    const root = document.querySelector(host)?.shadowRoot ?? null;
    return {
      badgeText: root?.querySelector('.kc-badge')?.textContent ?? null,
      items: [...(root?.querySelectorAll('.kc-item') ?? [])].map((n) => n.textContent),
      copies: [...(root?.querySelectorAll('.kc-none') ?? [])].map((n) => n.textContent),
      cellText: [
        ...document.querySelectorAll(
          'th.plugin-title.column-primary, td.plugin-title.column-primary'
        )
      ].map((c) => c.textContent),
      listTitle: root?.querySelector('.kc-title')?.textContent ?? null
    };
  }, KC_HOST);
}

/** The committed DB snapshot (175 rows) the boot's seed path writes. */
const SEED_ROWS: { name: string; id: string }[] = JSON.parse(
  readFileSync(
    path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'lib',
      'known-conflicts',
      'known-conflicts-db.json'
    ),
    'utf8'
  )
) as { name: string; id: string }[];

/** The storage keys the DB value and its meta live under (WXT `$` meta). */
const DB_KEYS = ['known-conflicts-db', 'known-conflicts-db$'] as const;

/** Poll profile for the scan's settle (the plugins screen's late pass at 1 s). */
const SCAN_SETTLE = { timeout: 10_000, intervals: [250, 500] };

/** One crafted DB row whose name matches the plugins screen's own text. */
const SYNTHETIC_ROW = {
  id: 'e2e-probe-synthetic-row',
  type: 'Plugin',
  name: 'WP Rocket',
  detection_pattern: null,
  summary: 'e2e probe synthetic row',
  issue_description: '',
  url: 'https://example.com/e2e-probe'
} as const;

/** Read the stored DB rows (and their meta) back from the SW. */
async function readStoredDb(driver: ExtensionDriver): Promise<{ rows: unknown; meta: unknown }> {
  return await driver.evaluateInWorker(async (keys: readonly string[]) => {
    const stored = await chrome.storage.local.get([keys[0] ?? '', keys[1] ?? '']);
    return { rows: stored[keys[0] ?? ''] ?? null, meta: stored[keys[1] ?? ''] ?? null };
  }, DB_KEYS);
}

/** Remove the DB value and its meta (a wiped local DB, like a wiped install). */
async function clearStoredDb(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async (keys: readonly string[]) => {
    await chrome.storage.local.remove([...keys]);
  }, DB_KEYS);
}

/**
 * Derive the expected findings the way the scan does, as an assertion:
 * stored rows with usable name+url whose lowercased name occurs in the
 * lowercased concatenation of the page's plugin-title cells.
 *
 * @param rows The stored rows (untyped: corrupt rows must not crash the
 *   derivation — they are skipped like the scan skips them).
 * @param cells The page's plugin-title cell texts.
 */
function deriveExpected(rows: unknown, cells: readonly string[]): { name: string; id: string }[] {
  const haystack = cells.join('').trim().toLocaleLowerCase();
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is { name: string; url: string; id: string } =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as { name?: unknown }).name === 'string' &&
        typeof (row as { url?: unknown }).url === 'string' &&
        typeof (row as { id?: unknown }).id === 'string' &&
        (row as { url: string }).url !== ''
    )
    .filter(
      (row) => haystack.includes(row.name.trim().toLocaleLowerCase()) && row.name.trim() !== ''
    );
}

siteTest.describe('site known conflicts', () => {
  siteTest(
    'the plugins screen scan matches the stored DB rows by name containment',
    async ({ adminPage, extension }) => {
      await adminPage.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });

      // Settled scan (shadow DOM): the badge shows a counted state.
      await expect
        .poll(async () => (await readKc(adminPage)).badgeText, SCAN_SETTLE)
        .toMatch(SETTLED_BADGE_PATTERN);
      const read = await readKc(adminPage);

      // Independent expectation: the stored rows (SW read-back) whose name is
      // contained in the page's own title-cell text.
      const { rows } = await readStoredDb(extension);
      const expected = deriveExpected(rows, read.cellText);
      expect(expected.length, 'the committed rows genuinely match this site').toBeGreaterThan(0);

      expect(read.badgeText, 'badge count matches the derived findings').toBe(
        `${BADGE_LABEL}: ${badgeCount(expected.length)}`
      );
      expect(read.items, 'the list renders exactly the derived findings').toHaveLength(
        expected.length
      );
      for (const name of [
        'Query Monitor',
        'Yoast SEO',
        'Elementor',
        'Forminator',
        'Ad Inserter',
        'Rank Math SEO'
      ]) {
        expect(
          read.items.some((item) => item.includes(name)),
          `the verified row "${name}" is listed`
        ).toBe(true);
      }

      // The real badge click opens the list (the control, in the shadow root).
      await adminPage.locator(`${KC_HOST} .kc-badge`).click();
      await expect(adminPage.locator(`${KC_HOST} .kc-list`)).toBeVisible();
      expect((await readKc(adminPage)).listTitle, 'the corrected list title renders').toBe(
        LIST_TITLE
      );
    }
  );

  siteTest(
    'a zero-finding scan shows the corrected empty state once settled',
    async ({ adminPage }) => {
      // The active-only view's title cells contain just WP Rocket — no stored
      // row name is contained in it, so the scan legitimately finds nothing
      // and the corrected empty state is the final verdict.
      await adminPage.goto(`${SITE_URL}/wp-admin/plugins.php?plugin_status=active`, {
        waitUntil: 'load'
      });
      await expect
        .poll(async () => (await readKc(adminPage)).copies, SCAN_SETTLE)
        .toContain(EMPTY_COPY);
      const read = await readKc(adminPage);
      expect(read.badgeText, 'zero findings render a zero count').toBe(`${BADGE_LABEL}: 0`);
      expect(read.items, 'no findings are listed').toHaveLength(0);
    }
  );

  siteTest(
    'a storage write re-scans the open page without a reload',
    async ({ adminPage, extension }) => {
      await adminPage.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });
      await expect
        .poll(async () => (await readKc(adminPage)).badgeText, SCAN_SETTLE)
        .toMatch(SETTLED_BADGE_PATTERN);
      const before = await readKc(adminPage);

      // Save the original rows, then write a fresh set with one extra row whose
      // name matches the page's own text: the watch must adopt the rows and
      // re-scan the OPEN page — the findings grow with no reload.
      const original = await extension.evaluateInWorker(
        async (key: string) => (await chrome.storage.local.get([key]))[key],
        DB_KEYS[0]
      );
      await extension.evaluateInWorker(
        async (payload: { key: string; original: unknown[]; row: unknown }) => {
          // Fresh set = the saved original + the injected row.
          await chrome.storage.local.set({
            [payload.key]: [...payload.original, payload.row]
          });
        },
        { key: DB_KEYS[0], original: original as unknown[], row: SYNTHETIC_ROW }
      );

      await expect
        .poll(async () => (await readKc(adminPage)).items, SCAN_SETTLE)
        .toHaveLength(before.items.length + 1);
      expect(
        (await readKc(adminPage)).items.some((item) => item.includes(SYNTHETIC_ROW.summary)),
        'the injected row rendered with its summary'
      ).toBe(true);

      // Restore: the original rows go back; the open page re-scans (findings
      // accumulate, so the injected row stays listed on THIS page — later
      // pages re-derive cleanly).
      await extension.evaluateInWorker(
        async (payload: { key: string; original: unknown[] }) => {
          await chrome.storage.local.set({ [payload.key]: payload.original });
        },
        { key: DB_KEYS[0], original: original as unknown[] }
      );
      await expect
        .poll(async () => {
          const { rows } = await readStoredDb(extension);
          const ids = Array.isArray(rows) ? rows.map((row) => (row as { id?: string }).id) : [];
          return !ids.includes(SYNTHETIC_ROW.id);
        }, SCAN_SETTLE)
        .toBe(true);
    }
  );

  siteTest(
    'an empty storage is served through the ask path with rows',
    async ({ adminPage, extension }) => {
      await clearStoredDb(extension);
      // The background may legitimately re-prime at any service worker wake
      // (fresh rows are its job), so nothing about the post-wipe storage
      // state is assertable. The SERVE PATH's contract is what this pins:
      // whatever the storage state, the ask never returns without rows.
      const worker = await extension.serviceWorker();
      const extensionPage = await extension.browserContext.newPage();
      await extensionPage.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
      const reply = (await extensionPage.evaluate(
        async () =>
          await new Promise<unknown>((resolve) => {
            chrome.runtime.sendMessage(
              { id: 2, type: 'getKnownConflictsDb', data: undefined, timestamp: Date.now() },
              (answer) => {
                resolve(answer);
              }
            );
          })
      )) as { res: { length: number } | null };
      expect(reply.res?.length ?? 0, 'the serve path answered with rows').toBeGreaterThan(0);

      // The real consumer: a fresh plugins.php page's own load path asks the
      // same way and renders a counted scan again.
      await adminPage.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });
      await expect
        .poll(async () => (await readKc(adminPage)).badgeText, SCAN_SETTLE)
        .toMatch(SETTLED_BADGE_PATTERN);
    }
  );

  siteTest('an offline first boot seeds the embedded snapshot unstamped', async ({ extension }) => {
    // Wipe the DB, then relaunch with a dead proxy for non-loopback hosts
    // (launch-time, so the boot's own refresh fails deterministically): the
    // prime must seed the embedded snapshot, unstamped — never fetched.
    await clearStoredDb(extension);
    await extension.relaunch([
      '--proxy-server=http://127.0.0.1:9',
      '--proxy-bypass-list=127.0.0.1;localhost'
    ]);

    await expect
      .poll(
        async () => {
          const { rows } = await readStoredDb(extension);
          return Array.isArray(rows) ? rows.length : null;
        },
        { timeout: 20_000, intervals: [500, 1_000] }
      )
      .toBe(SEED_ROWS.length);
    const { meta } = await readStoredDb(extension);
    expect(
      (meta as { updatedAt?: number } | null)?.updatedAt,
      'the seeded snapshot carries no fetch stamp'
    ).toBeUndefined();

    // The seeded rows serve scans immediately, without any network. The
    // login cookie does NOT survive the relaunch in this Chromium build
    // (verified: the navigation lands on wp-login.php again) — log in again.
    const page = await extension.browserContext.newPage();
    await loginAdminPage(page);
    await page.goto(`${SITE_URL}/wp-admin/plugins.php`, { waitUntil: 'load' });
    await expect
      .poll(async () => (await readKc(page)).badgeText, SCAN_SETTLE)
      .toMatch(SETTLED_BADGE_PATTERN);
    const read = await readKc(page);
    const expected = deriveExpected(SEED_ROWS, read.cellText);
    expect(read.badgeText, 'the seeded snapshot scans exactly like the committed DB').toBe(
      `${BADGE_LABEL}: ${badgeCount(expected.length)}`
    );
    await page.close();
  });
});
