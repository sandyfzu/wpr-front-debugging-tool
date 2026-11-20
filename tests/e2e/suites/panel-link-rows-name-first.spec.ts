/**
 * Resource rows lead with the file name on real Chromium: at a 320 px panel
 * (the narrowest supported) in both palettes, every URL row on the
 * JavaScript, Stylesheets, Lazyload and Preloaded Resources pages shows its
 * file name whole — not cut by the row, inside the page — while the full
 * URL stays one step away: the row's URL preview beneath and its detail's
 * source-link tile (href + `title`, its file name whole inside the tile);
 * the page never scrolls sideways; at a
 * regular-tier 768 px width the settled names stay whole too. The palette
 * check reads the rendered `color-scheme` (no stored Dark/Light override),
 * not just the emulated media. The fixture's URLs are deliberately deep so
 * the URL line itself truncates long before its file name: what a bare URL
 * row would hide.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { closeScriptDetail, openScriptDetail } from '../helpers/javascript-page';
import { expectSystemPalette, resetStoredOptions } from '../helpers/options';
import { openPanelForFixture } from '../helpers/panel-data';

/** A path deep enough that its URL truncates at 320 px well before the file name. */
const DEEP =
  'https://example.test/wp-content/plugins/a-plugin-with-a-rather-long-directory-name/assets';

/**
 * Each page under test: its route, its row hook, its rows' name hook, the
 * file names its rows must show (each row opens its detail, whose tile
 * carries the full URL).
 */
const PAGES = [
  {
    route: 'javascript',
    row: '[data-fdt="script-row"]',
    name: '[data-fdt="list-row-name"]',
    names: ['frontend.min.js', 'vendor.js']
  },
  {
    route: 'stylesheets',
    row: '[data-fdt="stylesheet-row"]',
    name: '[data-fdt="list-row-name"]',
    names: ['style.min.css', 'print.css']
  },
  {
    route: 'lazyload',
    row: '[data-fdt="lazyload-row"]',
    name: '[data-fdt="list-row-name"]',
    names: ['hero-photo.jpg']
  },
  {
    route: 'preloaded-resources',
    row: '[data-fdt="hint-row"]',
    name: '[data-fdt="list-row-name"]',
    names: ['inter-var.woff2']
  }
] as const;

/**
 * The file name's pattern at the end of a URL path (before its query/hash).
 *
 * @param name The file name.
 */
function fileUrlPattern(name: string): RegExp {
  return new RegExp(`/${name.replaceAll('.', '\\.')}`);
}

/**
 * The fixture: deep-path scripts (one delayed), stylesheets (one
 * print-only), a font preload and an image.
 */
function nameFirstPage(): string {
  return `<!doctype html><html lang="en"><head><title>Name-first rows</title>
    <link rel="preload" as="font" href="${DEEP}/fonts/inter-var.woff2" crossorigin>
    <link rel="stylesheet" href="${DEEP}/css/style.min.css?ver=6.8.3">
    <link rel="stylesheet" media="print" href="${DEEP}/css/print/print.css?ver=1.0#x">
    </head><body><h1>Name-first rows</h1>
    <img src="${DEEP}/uploads/2026/11/hero-photo.jpg" alt="" width="10" height="10">
    <script type="rocketlazyloadscript" data-rocket-src="${DEEP}/js/frontend/frontend.min.js?ver=1.2.3"></script>
    <script src="${DEEP}/js/vendor/vendor.js"></script>
    </body></html>`;
}

/**
 * One name's fit: whether its text is cut by its own box, and how far its
 * box ends past its container's right edge (≤ 0 = inside).
 *
 * @param page The container: the page root, or the detail's tile.
 * @param name The name element.
 */
async function nameFit(page: Locator, name: Locator): Promise<{ cut: boolean; overflow: number }> {
  const right = await page.evaluate((element) => element.getBoundingClientRect().right);
  return await name.evaluate(
    (element, pageRight) => ({
      cut: element.scrollWidth > element.clientWidth,
      overflow: element.getBoundingClientRect().right - pageRight
    }),
    right
  );
}

/** A name's settled box: its width and whether its text is cut, once layout stops moving. */
interface SettledName {
  width: number;
  cut: boolean;
  overflow: number;
}

/**
 * Measure a name after layout settles: reads once per animation frame until
 * two consecutive reads agree (capped at 120 frames), so a resize's transient
 * frames are never what gets asserted.
 *
 * @param name The name element.
 * @returns Its settled width, cut state and overflow past its page's right edge.
 */
async function settledName(name: Locator): Promise<SettledName> {
  return await name.evaluate(
    (element) =>
      new Promise<SettledName>((resolve) => {
        const read = (): SettledName => {
          const box = element.getBoundingClientRect();
          const pageRight =
            element.closest('[data-fdt-page]')?.getBoundingClientRect().right ?? box.right;
          return {
            width: box.width,
            cut: element.scrollWidth > element.clientWidth,
            overflow: box.right - pageRight
          };
        };
        let last = read();
        let frames = 0;
        const step = (): void => {
          const next = read();
          frames += 1;
          const same =
            next.width === last.width && next.cut === last.cut && next.overflow === last.overflow;
          if (same || frames >= 120) {
            resolve(next);
            return;
          }
          last = next;
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      })
  );
}

/**
 * Switch the panel's route and wait for its page.
 *
 * @param panel The panel page.
 * @param route The route id.
 * @returns The page root.
 */
async function openRoute(panel: Page, route: string): Promise<Locator> {
  await panel.evaluate((hash) => {
    location.hash = hash;
  }, `#/${route}`);
  const page = panel.locator(`[data-fdt-page="${route}"]`);
  await expect(page).toBeVisible();
  return page;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`URL rows lead with a whole file name at 320 and 768 px (${colorScheme})`, async ({
    extension
  }) => {
    await extension.browserContext.route('**/name-first.html*', async (route) => {
      await route.fulfill({ contentType: 'text/html', body: nameFirstPage() });
    });
    // The deep URLs stay offline: every asset answers empty at once.
    await extension.browserContext.route('https://example.test/**', async (route) => {
      await route.fulfill({ status: 200, body: '' });
    });
    // Suites share one profile and earlier ones leave a Dark/Light choice
    // stored: seed the System default so the emulated scheme decides.
    await resetStoredOptions(extension);
    // The palette is emulated before the panel's first render (resolved at boot).
    const { panel, fixture } = await openPanelForFixture(extension, '/name-first.html', {
      bootHash: '#/javascript',
      emulation: { colorScheme }
    });
    try {
      await panel.setViewportSize({ width: 320, height: 900 });
      expect(await panel.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(
        colorScheme === 'dark'
      );
      await expectSystemPalette(panel, colorScheme);
      for (const target of PAGES) {
        const page = await openRoute(panel, target.route);
        const rows = page.locator(target.row);
        await expect(rows).toHaveCount(target.names.length);
        for (const [index, expected] of target.names.entries()) {
          const row = rows.nth(index);
          const name = row.locator(target.name);
          await expect(name).toHaveText(expected);
          await expect(name).toBeVisible();
          const fit = await nameFit(page, name);
          expect(fit.cut, `${target.route} ${expected} whole`).toBe(false);
          expect(fit.overflow, `${target.route} ${expected} inside the page`).toBeLessThanOrEqual(
            0.5
          );
          // The URL previews beneath the name (scheme dropped); the full URL
          // is the detail's source-link tile: its href and its title.
          await expect(row.locator('[data-fdt="list-row-preview"]')).toContainText(
            DEEP.replace('https://', '')
          );
          const detail = await openScriptDetail(panel, row);
          const link = detail.locator('[data-fdt="source-link"] a[href]').first();
          await expect(link).toHaveAttribute('href', fileUrlPattern(expected));
          const tile = detail.locator('[data-fdt="source-link-open"]');
          expect((await tile.getAttribute('title'))?.startsWith(DEEP)).toBe(true);
          // The tile names the file whole however deep the path: only its
          // directory elides, and the file stays inside the tile.
          const file = tile.locator('[data-fdt="source-link-file"]');
          await expect(file).toHaveText(expected);
          await expect(file).toBeVisible();
          const fileFit = await nameFit(tile, file);
          expect(fileFit.cut, `${expected} tile file name whole`).toBe(false);
          expect(fileFit.overflow, `${expected} tile file inside the tile`).toBeLessThanOrEqual(
            0.5
          );
          // Nor clamped away below the path's visible lines.
          const path = tile.locator('[data-fdt="source-link-path"]');
          const clip = await path.evaluate((element) => {
            const shown = element.querySelector('[data-fdt="source-link-file"]');
            return {
              hidden: element.scrollHeight - element.clientHeight,
              below:
                (shown?.getBoundingClientRect().bottom ?? Infinity) -
                element.getBoundingClientRect().bottom
            };
          });
          expect(clip.hidden, `${expected} tile path never clamped`).toBeLessThanOrEqual(0.5);
          expect(clip.below, `${expected} tile file within the path`).toBeLessThanOrEqual(0.5);
          await closeScriptDetail(panel);
        }
        await expect
          .poll(() => page.evaluate((element) => element.scrollWidth - element.clientWidth), {
            message: `${target.route} fits at 320 px`
          })
          .toBe(0);
      }
      // Regular tier: the names stay whole once layout settles after the resize.
      await panel.setViewportSize({ width: 768, height: 900 });
      for (const target of PAGES) {
        const page = await openRoute(panel, target.route);
        const rows = page.locator(target.row);
        await expect(rows).toHaveCount(target.names.length);
        for (const [index, expected] of target.names.entries()) {
          const name = rows.nth(index).locator(target.name);
          await expect(name).toBeVisible();
          await expect
            .poll(() => settledName(name), { message: `${target.route} ${expected} at 768 px` })
            .toMatchObject({ cut: false });
          const settled = await settledName(name);
          expect(settled.width, `${target.route} ${expected} has width`).toBeGreaterThan(0);
          expect(
            settled.overflow,
            `${target.route} ${expected} inside the page`
          ).toBeLessThanOrEqual(0.5);
        }
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
