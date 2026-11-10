/**
 * The JavaScript page's state chips over WP Rocket's real output, on the
 * docker site's delay scenario (`/fdt/?fdt-delay=1`: Delay JS, Defer JS and
 * Minify JS on, the meta declares them). Ground truth is the served HTML:
 *
 * - each `cache/min/` script WP Rocket delayed and deferred reads exactly
 *   Delayed · Deferred (WP Rocket) · Minified — three chips, no "+N";
 * - a delayed module keeps its original type as the row's detail;
 * - the Minified filter lists exactly the minified scripts, Combined has none
 *   (Combine JS off: the meta does not declare it);
 * - the page never scrolls sideways from 320 to 1280 px.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';

/** The delay scenario, never cached (each load is WP Rocket's fresh output). */
const PAGE = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1`;

/** The three mu-plugin fixture scripts WP Rocket minifies, delays and defers. */
const MINIFIED_SCRIPTS = [
  'fdt-delayed-reference.js',
  'fdt-delayed-lifecycle.js',
  'fdt-delayed-definer.js'
] as const;

/**
 * The row whose URL or code contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 */
function rowWith(panel: Page, text: string): Locator {
  return panel.locator('[data-fdt="script-row"]', { hasText: text });
}

/**
 * A row's visible state words, in order.
 *
 * @param row The row.
 */
async function stateWords(row: Locator): Promise<string[]> {
  return await row.locator('[data-fdt="state-chip"]').allTextContents();
}

/**
 * A filter chip's count text.
 *
 * @param panel The panel page.
 * @param id The chip id.
 */
async function chipCount(panel: Page, id: string): Promise<string | null> {
  return await panel
    .locator(`[data-fdt-filter-chip="${id}"] [data-fdt-filter-count]`)
    .textContent();
}

test.beforeAll(async ({ extension }) => {
  // Anonymous visitor: a site login from an earlier suite disables the optimizations.
  await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
});

test('state chips and filters read WP Rocket’s real Delay, Defer and Minify JS output', async ({
  extension
}) => {
  const site = await openSitePage(extension, PAGE);
  const panel = await extension.browserContext.newPage();
  try {
    // Ground truth: the served tags carry the minify stamp under the minify cache.
    const served = await site.page.evaluate(() =>
      [...document.querySelectorAll('script[data-minify="1"]')].map(
        (script) => script.getAttribute('data-rocket-src') ?? ''
      )
    );
    expect(served.filter((src) => src.includes('/cache/min/'))).toHaveLength(
      MINIFIED_SCRIPTS.length
    );

    await panel.setViewportSize({ width: 1280, height: 2400 });
    await panel.addInitScript(devtoolsShim(site.tabId));
    await panel.goto(`${await panelPageUrl(extension)}#/javascript`, { waitUntil: 'load' });
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    await expect(rowWith(panel, MINIFIED_SCRIPTS[0])).toBeVisible();

    for (const name of MINIFIED_SCRIPTS) {
      const row = rowWith(panel, name);
      expect(await stateWords(row), name).toEqual(['Delayed', 'Deferred (WP Rocket)', 'Minified']);
      await expect(row.locator('[data-fdt="state-chip-overflow"]')).toHaveCount(0);
      // Negative states are no chips any more.
      await expect(row).not.toContainText('Not delayed');
    }

    // The core navigation module: delayed and deferred, not minified, its type kept.
    const module = rowWith(panel, 'block-library/navigation/view.min.js');
    expect(await stateWords(module)).toEqual(['Delayed', 'Deferred (WP Rocket)']);
    await expect(module.locator('[data-fdt="script-original-type"]')).toHaveText('type: module');

    // Filters cover every chip: Minified lists exactly the minified scripts.
    expect(await chipCount(panel, 'minified')).toBe(String(MINIFIED_SCRIPTS.length));
    expect(await chipCount(panel, 'combined')).toBe('0');
    await expect(panel.locator('[data-fdt-filter-chip="combined"]')).toBeDisabled();
    await panel.locator('[data-fdt-filter-chip="minified"]').click();
    const shown = panel.locator('[data-fdt="script-row"]');
    await expect(shown).toHaveCount(MINIFIED_SCRIPTS.length);
    for (const name of MINIFIED_SCRIPTS) await expect(rowWith(panel, name)).toHaveCount(1);
    await panel.locator('[data-fdt-filter-chip="all"]').click();

    // No sideways scroll at any panel width; the three chips stay on screen at 320.
    const root = panel.locator('[data-fdt-page="javascript"]');
    for (const width of [320, 480, 768, 1280]) {
      await panel.setViewportSize({ width, height: 2400 });
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript must fit at ${String(width)}px`
        })
        .toBe(0);
      const chips = rowWith(panel, MINIFIED_SCRIPTS[0]).locator('[data-fdt="status-badge"]');
      await expect(chips).toHaveCount(3);
      const right = await root.evaluate((element) => element.getBoundingClientRect().right);
      for (const box of await chips.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().right)
      )) {
        expect(box, `chip inside the page at ${String(width)}px`).toBeLessThanOrEqual(right + 0.5);
      }
    }
  } finally {
    await panel.close();
    await site.page.close();
  }
});
