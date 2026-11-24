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
 * featuring the newest announced release; one more reload on the same version (a
 * fresh worker: `onInstalled` update + the start check; a reload closes the
 * extension's own tabs) opens none.
 *
 * Layout leg (the shared fixture): the page at 320–1440 px in both palettes
 * never scrolls sideways and runs no animation under reduced motion; on a
 * desktop window (1024–1920 px, the side-by-side tier's edge included)
 * every screenshot renders at its full shot width (its UI text at real size)
 * and body text at the reading size; its
 * footer switch writes the synced setting.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Worker } from '@playwright/test';
import { EXTENSION_PATH, expect, test } from '../helpers/extension';
import { launchLoader, loadUnpacked } from '../helpers/cdp-loader';
import {
  WHATS_NEW_WAIT_MS,
  expectSecondWakeOpensNone,
  expectWhatsNewTabsStay,
  featuredRelease,
  whatsNewTabs
} from '../helpers/whats-new';
import { WHATS_NEW_PAGE_PATH } from '../../../lib/release-notes/page-path';
import packageInfo from '../../../package.json' with { type: 'json' };

/**
 * Desktop window widths the screenshots must render 1:1 at: a small laptop,
 * the band below the side-by-side tier, a few px either side of it (≈ 1222 px
 * with the gutters and scrollbar) and common wide windows.
 */
const DESKTOP_WIDTHS = [1024, 1120, 1180, 1210, 1218, 1222, 1226, 1230, 1280, 1440, 1920];

/** Window widths around the old `@wide` gutter step (≈ 776 px), every 4 px. */
const GROWING_WIDTHS = Array.from({ length: 11 }, (_, step) => 760 + step * 4);

/** The version the store item had before 3.0.0. */
const PUBLISHED_VERSION = '2.2.5';

/** The marker's bare key in `storage.local`. */
const MARKER = 'whats-new-seen-through';

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
    const loader = await launchLoader(path.join(root, 'profile'));
    const { context } = loader;
    try {
      // 1. Install the "published" build: no page, the marker seeded; then
      //    forget the marker (the published build kept none).
      stageBundle(extensionDir, PUBLISHED_VERSION);
      const { worker: installed } = await loadUnpacked(loader, extensionDir);
      // The install's check stores the marker before deciding: its write is the check done.
      await expect.poll(() => marker(installed)).toBe(PUBLISHED_VERSION);
      await expectWhatsNewTabsStay(context, 0, 'an install opens no What’s new tab');
      await installed.evaluate((key) => chrome.storage.local.remove(key), MARKER);

      // 2. Update in place: exactly one rendered page tab.
      stageBundle(extensionDir);
      const { worker: updated } = await loadUnpacked(loader, extensionDir, installed);
      await expect.poll(() => whatsNewTabs(context).length, { timeout: WHATS_NEW_WAIT_MS }).toBe(1);
      const page = whatsNewTabs(context)[0];
      if (page === undefined) throw new Error('the What’s new tab vanished');
      // The address carries the floor; every announced release above it is featured.
      expect(new URL(page.url()).searchParams.get('since')).toBe(PUBLISHED_VERSION);
      await expect(
        page.locator(`[data-fdt-release="${featuredRelease(PUBLISHED_VERSION)}"]`)
      ).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('WPR Front Debugging Tool');
      await expect(page.getByText(`v${packageInfo.version}`)).toBeVisible();
      await expect(page.locator('[data-fdt-highlight="exclusion-builder"]')).toBeVisible();
      await expect(
        page.getByRole('switch', { name: 'Show what’s new after updates' })
      ).toBeChecked();
      await expectWhatsNewTabsStay(context, 1, 'the update opens no second tab');
      expect(await marker(updated)).toBe(packageInfo.version);

      // 3. A second wake on the same version: nothing new opens.
      // (A reload closes the extension's own tabs, so any page now is a new one.)
      const { worker: reloaded } = await loadUnpacked(loader, extensionDir, updated);
      await expectSecondWakeOpensNone(context);
      expect(await marker(reloaded)).toBe(packageInfo.version);
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
        for (const width of [320, 480, 768, 1280, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          await page.goto(`chrome-extension://${id}${WHATS_NEW_PAGE_PATH}`);
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
      // Every desktop width gives the screenshots their whole shot width, never a
      // share of it — including the band around the side-by-side tier (list
      // 1166 px ≈ a 1222 px window), where a too-early switch once shrank them.
      // Below 1:1 a shot only grows with the window (a gutter step once took
      // 16 px near 776 px). Both palettes: a resize only, no reload.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`chrome-extension://${id}${WHATS_NEW_PAGE_PATH}`);
      await expect(page.locator('[data-fdt-highlight="command-palette"]')).toBeVisible();
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        let previous = 0;
        for (const width of GROWING_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const rendered = await page
            .locator('[data-fdt-highlight] img')
            .first()
            .evaluate((image) => image.getBoundingClientRect().width);
          expect(rendered, `${colorScheme} @ ${String(width)} px`).toBeGreaterThanOrEqual(previous);
          previous = rendered;
        }
        const beside = new Map<number, boolean>();
        for (const width of DESKTOP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          const geometry = await page.evaluate(() => ({
            shots: [...document.querySelectorAll<HTMLImageElement>('[data-fdt-highlight] img')].map(
              (image) => {
                const card = image.closest('[data-fdt-highlight]');
                const shot = image.getBoundingClientRect();
                const title = card?.querySelector('h2, h3, h4')?.getBoundingClientRect();
                return {
                  id: card?.getAttribute('data-fdt-highlight'),
                  rendered: shot.width,
                  // The width attribute is the registry's shot width (CSS px).
                  shot: Number(image.getAttribute('width')),
                  // The text column's width when it sits beside the shot, else null.
                  besideText: title !== undefined && title.left >= shot.right ? title.width : null
                };
              }
            ),
            body: Number.parseFloat(
              getComputedStyle(document.querySelector('[data-fdt-highlight] p') ?? document.body)
                .fontSize
            )
          }));
          expect(geometry.shots.length).toBeGreaterThan(0);
          for (const shot of geometry.shots) {
            const where = `${colorScheme} ${String(shot.id)} @ ${String(width)} px`;
            expect(shot.rendered, where).toBeGreaterThanOrEqual(shot.shot);
            // Beside the shot, the text keeps its 20 rem reading column.
            if (shot.besideText !== null)
              expect(shot.besideText, where).toBeGreaterThanOrEqual(320);
          }
          expect(geometry.body).toBeGreaterThanOrEqual(16);
          beside.set(
            width,
            geometry.shots.every((shot) => shot.besideText !== null)
          );
        }
        // Both layouts are exercised: stacked on a small laptop, side by side wide.
        expect(beside.get(1024)).toBe(false);
        expect(beside.get(1440)).toBe(true);
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
