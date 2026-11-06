/**
 * Runtime states against WP Rocket's real Delay JS runtime (P14.1 box 3), on
 * the docker WordPress site (Delay JS on, the bootstrap baseline). The
 * suite's page carries a missing theme file, a plugin file that runs, an
 * inline script and JSON-LD; WordPress adds its own core module and inline
 * scripts. Ground truth is the page's own DOM — the `type` and
 * `data-rocket-status` WP Rocket's runtime writes:
 *
 * - before any input every delayed script is pending, the rest not delayed,
 *   and the panel's states equal the DOM's script by script;
 * - a real user input runs the queue: WP Rocket marks each script executed
 *   or failed (the missing theme file: `failed-network`), and Read again
 *   shows exactly that, script by script;
 * - a reload rearms the queue: the shown read turns stale, Read again shows
 *   everything pending again;
 * - the Theme / Plugins / Inline / Other groups and the structured data row
 *   (JSON-LD, read as data) stay in the list throughout.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';
import { createSitePage, deleteSitePage } from '../helpers/site-wpcli';

/** The suite's page slug. */
const SLUG = 'fdt-e2e-runtime-states';

/** The suite's page content (one script per line: WordPress keeps them as written). */
const PAGE_HTML = [
  '<p id="fdt-runtime-marker">Runtime states</p>',
  '<script src="/wp-content/themes/twentytwentyfive/fdt-runtime-missing.js"></script>',
  '<script src="/wp-content/mu-plugins/assets/fdt-delayed-lifecycle.js"></script>',
  '<script>window.fdtRuntimeInlineRan = true;</script>',
  '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Runtime states"}</script>'
].join('\n');

/** The page, never cached (each load is WP Rocket's fresh output). */
const PAGE = `${SITE_URL}/${SLUG}/?fdt-no-store=1`;

/** Shared by the suite's tests. */
let pageId: number | null = null;

/** One script element as the page's DOM states it. */
interface DomScript {
  readonly state: 'pending' | 'executed' | 'failed' | 'not-delayed' | 'other';
  readonly status: string | null;
  readonly src: string;
}

/**
 * The page's own script states: WP Rocket's delay type or its status attribute.
 *
 * @param page The site page.
 */
async function domScripts(page: Page): Promise<DomScript[]> {
  return await page.evaluate(() =>
    [...document.querySelectorAll('script')].map((script) => {
      const status = script.getAttribute('data-rocket-status');
      const delayedType = script.getAttribute('type') === 'text/rocketlazyloadscript';
      const state =
        status === null
          ? delayedType
            ? 'pending'
            : 'not-delayed'
          : status === 'executed'
            ? 'executed'
            : status.startsWith('failed')
              ? 'failed'
              : 'other';
      return {
        state,
        status,
        src: script.getAttribute('data-rocket-src') ?? script.getAttribute('src') ?? ''
      } as const;
    })
  );
}

/**
 * The panel's state per row, in list order.
 *
 * @param panel The panel page.
 */
async function panelStates(panel: Page): Promise<string[]> {
  return await panel
    .locator('[data-fdt="runtime-row"] [data-fdt-runtime-state]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-fdt-runtime-state') ?? ''));
}

/**
 * Read again until the panel's states equal the page's DOM read right after
 * (the page may still add scripts of its own — WP Rocket's runtime, WordPress).
 *
 * @param panel The panel page.
 * @param page The site page.
 */
async function expectPanelMatchesDom(panel: Page, page: Page): Promise<void> {
  await expect(async () => {
    await panel.locator('[data-fdt-runtime-read]').click();
    await expect(panel.locator('[data-fdt-runtime-read]')).toBeEnabled();
    const shown = await panelStates(panel);
    expect(shown).toEqual((await domScripts(page)).map((script) => script.state));
  }).toPass({ timeout: 15_000 });
}

/**
 * A chip of one of the section's bars.
 *
 * @param panel The panel page.
 * @param bar The source bar or the state bar.
 * @param value The chip's value.
 */
function chip(panel: Page, bar: 'source' | 'state', value: string): Locator {
  const scope =
    bar === 'source'
      ? panel.locator('[data-fdt-runtime-sources]')
      : panel.locator(
          '[data-fdt="runtime-states"] [data-fdt="filter-bar"]:not([data-fdt-runtime-sources])'
        );
  return scope.locator(`[data-fdt-filter-chip="${value}"]`);
}

/**
 * The row whose URL or code contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 */
function rowWith(panel: Page, text: string): Locator {
  return panel.locator('[data-fdt="runtime-row"]', { hasText: text });
}

/**
 * Open the panel's Runtime states on a tab (tall viewport: every row rendered).
 *
 * @param extension The driver.
 * @param tabId The site tab.
 */
async function openRuntimeStates(extension: ExtensionDriver, tabId: number): Promise<Page> {
  const panel = await extension.browserContext.newPage();
  await panel.setViewportSize({ width: 1280, height: 2400 });
  await panel.addInitScript(devtoolsShim(tabId));
  await panel.goto(`${await panelPageUrl(extension)}#/javascript`, { waitUntil: 'load' });
  await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
  await panel.getByRole('tab', { name: 'Runtime states' }).click();
  await expect(panel.locator('[data-fdt="runtime-row"]').first()).toBeVisible();
  return panel;
}

test.beforeAll(async ({ extension }) => {
  pageId = await createSitePage(SLUG, 'Runtime states', PAGE_HTML);
  // Anonymous visitor: a site login from an earlier suite disables the optimizations.
  await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
});

test.afterAll(async () => {
  if (pageId !== null) await deleteSitePage(pageId);
});

test('WP Rocket’s real Delay JS: pending → input → executed / failed, then a reload rearms it', async ({
  extension
}) => {
  const site = await openSitePage(extension, PAGE);
  try {
    const panel = await openRuntimeStates(extension, site.tabId);

    // Before any input: the DOM's truth, script by script.
    const before = await domScripts(site.page);
    expect(before.filter((script) => script.state === 'pending').length).toBeGreaterThanOrEqual(4);
    expect(before.some((script) => script.state === 'executed')).toBe(false);
    await expectPanelMatchesDom(panel, site.page);
    await expect(
      rowWith(panel, 'fdt-runtime-missing.js').locator('[data-fdt-runtime-state]')
    ).toHaveAttribute('data-fdt-runtime-group', 'theme');
    await expect(
      rowWith(panel, 'fdt-delayed-lifecycle.js').locator('[data-fdt-runtime-state]')
    ).toHaveAttribute('data-fdt-runtime-group', 'plugin');
    await expect(
      rowWith(panel, 'fdtRuntimeInlineRan').locator('[data-fdt-runtime-state]')
    ).toHaveAttribute('data-fdt-runtime-group', 'inline');
    await expect(
      rowWith(panel, '/wp-includes/js/dist/script-modules/').locator('[data-fdt-runtime-state]')
    ).toHaveAttribute('data-fdt-runtime-group', 'other');
    const jsonLd = rowWith(panel, '"@type":"WebPage"');
    await expect(jsonLd.locator('[data-fdt-runtime-state]')).toHaveAttribute(
      'data-fdt-runtime-state',
      'not-delayed'
    );

    // A real user input: WP Rocket's runtime runs its queue and stamps each script.
    await site.page.mouse.move(200, 200);
    await site.page.mouse.move(260, 240);
    await expect
      .poll(async () => (await domScripts(site.page)).filter((s) => s.state === 'pending').length, {
        timeout: 15_000
      })
      .toBe(0);
    const after = await domScripts(site.page);
    const missing = after.find((script) => script.src.includes('fdt-runtime-missing.js'));
    expect(missing?.status).toBe('failed-network');
    expect(after.find((script) => script.src.includes('fdt-delayed-lifecycle.js'))?.status).toBe(
      'executed'
    );
    expect(await site.page.evaluate(() => 'fdtRuntimeInlineRan' in window)).toBe(true);

    await expectPanelMatchesDom(panel, site.page);
    await expect(chip(panel, 'state', 'pending')).toContainText('0');
    await expect(chip(panel, 'state', 'failed')).toContainText('1');
    await chip(panel, 'state', 'failed').click();
    await expect(panel.locator('[data-fdt="runtime-row"]')).toHaveCount(1);
    await panel.locator('[data-fdt-runtime-toggle]').click();
    await expect(panel.locator('[data-fdt-runtime-detail]')).toContainText('failed-network');
    await chip(panel, 'state', 'all').click();

    // Groups and the structured data stay listed after the run.
    for (const group of ['theme', 'plugin', 'inline', 'other'] as const) {
      await chip(panel, 'source', group).click();
      expect(
        await panel.locator('[data-fdt="runtime-row"]').count(),
        `rows in ${group}`
      ).toBeGreaterThan(0);
    }
    await chip(panel, 'source', 'all').click();
    await expect(jsonLd).toHaveCount(1);
    await jsonLd.locator('[data-fdt-runtime-toggle]').click();
    await expect(jsonLd.locator('[data-fdt-runtime-detail]')).toContainText(
      'Structured data (JSON-LD): read as data, never run.'
    );

    // A reload rearms the queue: the shown read is stale, a new read is pending again.
    await site.page.reload({ waitUntil: 'load' });
    await expect(panel.locator('[data-fdt-runtime-stale]')).toBeVisible({ timeout: 15_000 });
    const reloaded = await domScripts(site.page);
    expect(reloaded.some((script) => script.state === 'executed')).toBe(false);
    await expectPanelMatchesDom(panel, site.page);
    await expect(panel.locator('[data-fdt-runtime-stale]')).toHaveCount(0);
    await panel.close();
  } finally {
    await site.page.close();
  }
});
