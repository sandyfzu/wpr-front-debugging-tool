/**
 * The What's new page across a real in-place update, and its layout.
 *
 * Update leg: the suite installs (CDP `Extensions.loadUnpacked`) a copy of
 * the built bundle whose manifest says 2.2.5 (the published version),
 * clears the page's marker (the published build kept none), swaps the real
 * bundle into the same folder and loads it again: Chromium reloads the
 * extension and fires `runtime.onInstalled` with reason `update` and
 * `previousVersion: '2.2.5'` — the real event, not a faked call (verified
 * live). A relaunch with `--load-extension` cannot drive this: Chromium
 * reports every command-line load as `install` (verified live: two
 * launches, versions 2.2.5 then 3.0.0, both `install`).
 *
 * Asserted: the install opens nothing (and seeds the marker); the update
 * opens exactly one rendered tab, its address carrying `since=2.2.5` and
 * featuring 3.0.0; one more reload on the same version (a
 * fresh worker: `onInstalled` update + the start check; a reload closes the
 * extension's own tabs) opens none.
 *
 * Layout leg (the shared fixture): the page at 320–1280 px in both palettes
 * never scrolls sideways, runs no animation under reduced motion, and its
 * footer switch writes the synced setting.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker
} from '@playwright/test';
import { EXTENSION_PATH, expect, test } from '../helpers/extension';
import { HOST_RESOLVER_RULES } from '../helpers/blocked-hosts';
import packageInfo from '../../../package.json' with { type: 'json' };

/** The page's file name under the extension root. */
const PAGE_FILE = 'whats-new.html';

/** The version the store item had before 3.0.0. */
const PUBLISHED_VERSION = '2.2.5';

/** The marker's bare key in `storage.local`. */
const MARKER = 'whats-new-seen-through';

/** How long a load may wait for the page tab to appear. */
const PAGE_WAIT_MS = 15_000;

/**
 * Copy the built bundle into `dir`, optionally rewriting the manifest version.
 *
 * @param dir The extension folder (replaced wholesale).
 * @param version The manifest version to write; absent, the build's own.
 */
function stageBundle(dir: string, version?: string): void {
  rmSync(dir, { recursive: true, force: true });
  cpSync(EXTENSION_PATH, dir, { recursive: true });
  if (version === undefined) return;
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string };
  manifest.version = version;
  writeFileSync(manifestPath, JSON.stringify(manifest));
}

/**
 * Launch a browser without extensions that accepts CDP extension loads
 * (headless unless `E2E_HEADED=1`).
 *
 * @param profileDir The persistent profile.
 */
async function launchLoader(
  profileDir: string
): Promise<{ context: BrowserContext; session: CDPSession }> {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chromium',
    headless: process.env.E2E_HEADED !== '1',
    // Playwright's default `--disable-extensions` would keep the load inert.
    ignoreDefaultArgs: ['--disable-extensions'],
    viewport: { width: 1280, height: 800 },
    timeout: 30_000,
    args: ['--enable-unsafe-extension-debugging', HOST_RESOLVER_RULES]
  });
  const browser = context.browser();
  if (browser === null) throw new Error('The persistent context exposes no browser for CDP');
  return { context, session: await browser.newBrowserCDPSession() };
}

/**
 * Load (or reload) the staged extension and wait for its worker.
 *
 * @param context The browser.
 * @param session Its CDP session.
 * @param dir The staged extension folder.
 * @param previous The worker of the previous load (a reload replaces it).
 */
async function load(
  context: BrowserContext,
  session: CDPSession,
  dir: string,
  previous?: Worker
): Promise<Worker> {
  const { id } = await session.send('Extensions.loadUnpacked', { path: dir });
  const isNew = (worker: Worker): boolean =>
    new URL(worker.url()).host === id && worker !== previous;
  return (
    context.serviceWorkers().find(isNew) ??
    (await context.waitForEvent('serviceworker', { predicate: isNew, timeout: 20_000 }))
  );
}

/** The open What's new tabs. */
function pageTabs(context: BrowserContext): Page[] {
  // By path: the update's tab carries a `since` query.
  return context.pages().filter((page) => new URL(page.url()).pathname === `/${PAGE_FILE}`);
}

/**
 * Let the background finish its boot checks (a few storage round trips).
 *
 * @param worker The extension's service worker.
 */
async function settle(worker: Worker): Promise<void> {
  await worker.evaluate(() => new Promise((done) => setTimeout(done, 1_500)));
}

/**
 * The stored marker.
 *
 * @param worker The extension's service worker.
 */
async function marker(worker: Worker): Promise<unknown> {
  return (await worker.evaluate((key) => chrome.storage.local.get(key), MARKER))[MARKER];
}

test.describe('What’s new on update', () => {
  test.describe.configure({ timeout: 120_000 });

  test('opens once on 2.2.5 → current, never on install or a second wake', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'wpr-fdt-e2e-whats-new-'));
    const extensionDir = path.join(root, 'extension');
    const { context, session } = await launchLoader(path.join(root, 'profile'));
    try {
      // 1. Install the "published" build: no page, the marker seeded; then
      //    forget the marker (the published build kept none).
      stageBundle(extensionDir, PUBLISHED_VERSION);
      const installed = await load(context, session, extensionDir);
      await settle(installed);
      expect(pageTabs(context)).toHaveLength(0);
      expect(await marker(installed)).toBe(PUBLISHED_VERSION);
      await installed.evaluate((key) => chrome.storage.local.remove(key), MARKER);

      // 2. Update in place: exactly one rendered page tab.
      stageBundle(extensionDir);
      const updated = await load(context, session, extensionDir, installed);
      await expect.poll(() => pageTabs(context).length, { timeout: PAGE_WAIT_MS }).toBe(1);
      const page = pageTabs(context)[0];
      if (page === undefined) throw new Error('the What’s new tab vanished');
      // The address carries the floor; every announced release above it is featured.
      expect(new URL(page.url()).searchParams.get('since')).toBe(PUBLISHED_VERSION);
      await expect(page.locator('[data-fdt-release="3.0.0"]')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('WPR Front Debugging Tool');
      await expect(page.getByText(`v${packageInfo.version}`)).toBeVisible();
      await expect(page.locator('[data-fdt-highlight="exclusion-builder"]')).toBeVisible();
      await expect(
        page.getByRole('switch', { name: 'Show what’s new after updates' })
      ).toBeChecked();
      await settle(updated);
      expect(pageTabs(context)).toHaveLength(1);
      expect(await marker(updated)).toBe(packageInfo.version);

      // 3. A second wake on the same version: nothing new opens.
      // (A reload closes the extension's own tabs, so any page now is a new one.)
      const reloaded = await load(context, session, extensionDir, updated);
      await settle(reloaded);
      expect(pageTabs(context)).toHaveLength(0);
    } finally {
      await context.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

test.describe('What’s new page layout', () => {
  test('no horizontal scroll from 320 px up, in both palettes; reduced motion stills it', async ({
    extension
  }) => {
    const id = await extension.extensionId();
    const page = await extension.browserContext.newPage();
    // One canvas color per palette: System follows the emulated OS scheme.
    const canvases = new Set<string>();
    try {
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        for (const width of [320, 480, 768, 1280]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`chrome-extension://${id}/${PAGE_FILE}`);
          await expect(page.locator('[data-fdt-highlight="command-palette"]')).toBeVisible();
          const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
            animations: document.getAnimations().length,
            canvas: getComputedStyle(document.documentElement).backgroundColor
          }));
          canvases.add(`${colorScheme} ${overflow.canvas}`);
          expect(overflow.scroll, `${colorScheme} @ ${String(width)} px`).toBe(overflow.client);
          expect(overflow.animations, `${colorScheme} @ ${String(width)} px`).toBe(0);
        }
      }
      const [light, dark] = [...canvases].map((entry) => entry.split(' ').slice(1).join(' '));
      expect(canvases.size).toBe(2);
      expect(light).not.toBe(dark);
      // The opt-out switch writes the synced setting (and the page never opens images remotely).
      await page
        .getByRole('switch', { name: 'Show what’s new after updates' })
        .click({ force: true });
      await expect
        .poll(() =>
          extension.evaluateInWorker(
            () => chrome.storage.sync.get('whats-new-on-update'),
            undefined
          )
        )
        .toEqual({ 'whats-new-on-update': false });
    } finally {
      await extension.evaluateInWorker(
        () => chrome.storage.sync.remove('whats-new-on-update'),
        undefined
      );
      await page.close();
    }
  });
});
