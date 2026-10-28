/**
 * The local WordPress site's harness side (the P4.2 stack).
 *
 * `docker/.env` is the site's single declaring site: the URL and the admin
 * credentials are read from there (falling back to the committed
 * `.env.example`'s static local-only values when the file does not exist
 * yet), never hardcoded, never printed. The helpers own two things the
 * fixture-tier helpers cannot: a PARAM-FREE site navigation (the
 * `openFixturePage` `?e2e-tab=N` stamp makes URLs uncached — WP Rocket only
 * caches its `cache_query_strings` params — so every cached-page leg must
 * navigate real cacheable URLs) and the reused, per-test re-validated wp-admin login.
 */

import path from 'node:path';
import { readFileSync } from 'node:fs';

import type { BrowserContext, Page } from '@playwright/test';

import { test } from './extension';
import type { ExtensionDriver, DriverPage } from './extension';

/** The env file's directory (docker/), resolved from this file's location. */
const DOCKER_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'docker');

/** The site-config keys the harness consumes. */
interface SiteEnv {
  siteUrl: string;
  adminUser: string;
  adminPassword: string;
}

/**
 * Parse a dotenv-shaped file into a record. Only `KEY=value` lines count;
 * quotes and inline comments are not this site's vocabulary (the example
 * file documents plain values).
 *
 * @param filePath Absolute env-file path.
 * @returns The key→value map, empty when the file is missing.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    const key = match?.[1];
    const value = match?.[2];
    if (key === undefined || value === undefined) continue;
    values[key] = value;
  }
  return values;
}

/**
 * Read the site's config: `docker/.env` when present, else the committed
 * `.env.example` (whose values are the stack's static local defaults —
 * `up.sh` seeds a missing `.env` from it, so both files agree by design).
 *
 * @param keys Which keys to require.
 * @returns The values for exactly those keys.
 * @throws {Error} Naming the first missing key, with the fix.
 */
function readSiteEnv(keys: readonly (keyof SiteEnv)[]): SiteEnv {
  const envVarNames: Record<keyof SiteEnv, string> = {
    siteUrl: 'WPR_FDT_SITE_URL',
    adminUser: 'WPR_FDT_ADMIN_USER',
    adminPassword: 'WPR_FDT_ADMIN_PASSWORD'
  };
  const values = {
    ...parseEnvFile(path.join(DOCKER_DIR, '.env')),
    ...parseEnvFile(path.join(DOCKER_DIR, '.env.example'))
  };
  const result = {} as SiteEnv;
  for (const key of keys) {
    const value = values[envVarNames[key]];
    if (value === undefined || value === '') {
      throw new Error(
        `The browser-test site config is missing ${envVarNames[key]} — run docker/scripts/up.sh once (it creates docker/.env), or set the key in docker/.env`
      );
    }
    result[key] = value;
  }
  return result;
}

/** The site's base URL (no trailing slash), read once per run. */
export const SITE_URL: string = readSiteEnv(['siteUrl']).siteUrl.replace(/\/+$/, '');

/** The site's origin — the one origin every site navigation happens on. */
export const SITE_ORIGIN: string = new URL(SITE_URL).origin;

/**
 * Open a site page the way the real site is visited: PARAM-FREE unless the
 * caller's URL carries its own (cacheable) query. Resolves the tab id by
 * exact URL match and refuses ambiguity — a same-URL page left open from an
 * earlier test is a suite bug, and routing messages to the wrong tab would
 * assert the wrong tab's state.
 *
 * @param driver The extension driver.
 * @param url The absolute site URL to navigate.
 * @param beforeNavigate Hook between page creation and navigation — where
 *   console/pageerror listeners attach so the page emits into a listening
 *   capture.
 * @returns The page plus its tab id.
 */
export async function openSitePage(
  driver: ExtensionDriver,
  url: string,
  beforeNavigate?: (page: Page) => void
): Promise<DriverPage> {
  if (!url.startsWith(`${SITE_ORIGIN}/`)) {
    throw new Error(
      `openSitePage refuses non-site URLs (${url}) — use openFixturePage for the fixture origins`
    );
  }
  const page = await driver.browserContext.newPage();
  if (beforeNavigate !== undefined) beforeNavigate(page);
  await page.goto(url, { waitUntil: 'load' });
  const matches = await driver.evaluateInWorker(
    async (pattern: string) => await chrome.tabs.query({ url: pattern }),
    url
  );
  if (matches.length !== 1 || matches[0]?.id === undefined) {
    await page.close();
    throw new Error(
      `Expected exactly one tab at ${url}, found ${String(matches.length)} — close earlier same-URL pages before opening another`
    );
  }
  return { page, tabId: matches[0].id };
}

/**
 * Log one page into wp-admin (the worker profile keeps the cookie, so later
 * pages of the same worker are already authenticated — and a re-login on an
 * authenticated profile just redirects to wp-admin).
 *
 * Credentials come from the site env and are never echoed.
 *
 * @param page The page to log in with.
 */
export async function loginAdminPage(page: Page): Promise<void> {
  const { adminUser, adminPassword } = readSiteEnv(['adminUser', 'adminPassword']);
  await page.goto(`${SITE_URL}/wp-login.php`, { waitUntil: 'load' });
  await page.fill('#user_login', adminUser);
  await page.fill('#user_pass', adminPassword);
  await Promise.all([
    page.waitForURL('**/wp-admin/**', { timeout: 20_000 }),
    page.click('#wp-submit')
  ]);
}

/** WordPress's login-state cookie prefix (`wordpress_logged_in_<site hash>`). */
const LOGGED_IN_COOKIE_PREFIX = 'wordpress_logged_in_';

/**
 * Whether the context holds the site's WordPress login cookie — the cheap
 * re-check before a test is handed the admin page (no navigation).
 *
 * @param context The browser context to read.
 * @returns True when a `wordpress_logged_in_*` cookie for the site exists.
 */
async function hasSiteLogin(context: BrowserContext): Promise<boolean> {
  const cookies = await context.cookies(SITE_URL);
  return cookies.some((cookie) => cookie.name.startsWith(LOGGED_IN_COOKIE_PREFIX));
}

/** The worker's admin page slot: null until a test first asks for it. */
interface AdminPageSlot {
  page: Page | null;
}

/**
 * The site suites' admin page, reused across the worker's tests yet always
 * valid when handed out: re-created (and logged in) when the held page is
 * closed or belongs to an earlier browser context — a suite's
 * `extension.relaunch()` closes the context and every page in it — and
 * logged in again when the profile lost its login cookie (suites clear the
 * site's cookies to run as anonymous visitors).
 *
 * @param slot The worker's slot (updated in place).
 * @param context The driver's current browser context.
 * @returns The open, logged-in admin page.
 */
async function liveAdminPage(slot: AdminPageSlot, context: BrowserContext): Promise<Page> {
  const held = slot.page;
  if (held === null || held.isClosed() || held.context() !== context) {
    const page = await context.newPage();
    slot.page = page;
    await loginAdminPage(page);
    return page;
  }
  if (!(await hasSiteLogin(context))) await loginAdminPage(held);
  return held;
}

/**
 * The site suites' test: the extension test extended with a logged-in admin
 * page. The page lives in a worker-scoped slot (one wp-login round per run
 * in the common case; tests navigate it to their own admin pages); the
 * test-scoped `adminPage` re-validates it per test, so a relaunch or a
 * cookie wipe in an earlier test or file never hands out a dead page.
 */
interface SiteTestFixtures {
  /** The open, logged-in admin page of the current browser context. */
  adminPage: Page;
}

/** The worker-scoped fixtures behind {@link SiteTestFixtures}. */
interface SiteWorkerFixtures {
  /** The admin page slot shared by the worker's tests. */
  adminPageSlot: AdminPageSlot;
}

export const siteTest = test.extend<SiteTestFixtures, SiteWorkerFixtures>({
  adminPageSlot: [
    async ({}, use) => {
      const slot: AdminPageSlot = { page: null };
      await use(slot);
      // The browser may already be closed (a relaunch leg) — tolerate that.
      await slot.page?.close().catch(() => undefined);
    },
    { scope: 'worker' }
  ],
  adminPage: [
    async ({ extension, adminPageSlot }, use) => {
      await use(await liveAdminPage(adminPageSlot, extension.browserContext));
    },
    { timeout: 60_000 }
  ]
});
