/**
 * The Stylesheets page over the docker site's real WordPress output
 * (`/fdt/`: a block theme, inline styles only; no WP Rocket CSS feature runs
 * on the site). Ground truth is the live page's own DOM, read at the same
 * moment: every inline style is listed once, in document order, named by its
 * id; no state chip is claimed (nothing WP Rocket printed); the Inline
 * facet covers them all, nothing reads Minified (Minify CSS is not
 * declared), and a style's detail shows its whole CSS as the element holds it.
 */
import { expect, test } from '../helpers/extension';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';

/** The default scenario, never cached (each load is WP Rocket's fresh output). */
const PAGE = `${SITE_URL}/fdt/?fdt-no-store=1`;

test.beforeAll(async ({ extension }) => {
  // Anonymous visitor: a site login from an earlier suite disables the optimizations.
  await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
});

test('lists the site’s inline styles as the page has them, claiming no WP Rocket state', async ({
  extension
}) => {
  const site = await openSitePage(extension, PAGE);
  const panel = await extension.browserContext.newPage();
  try {
    await panel.setViewportSize({ width: 1280, height: 2400 });
    await panel.addInitScript(devtoolsShim(site.tabId));
    await panel.goto(`${await panelPageUrl(extension)}#/stylesheets`, { waitUntil: 'load' });
    const page = panel.locator('[data-fdt-page="stylesheets"]');
    await expect(panel.getByRole('heading', { level: 1, name: 'Stylesheets' })).toBeVisible();
    await expect(page.locator('[data-fdt="stylesheet-row"]').first()).toBeVisible();
    await page.locator('[data-fdt="stylesheets-refresh"]').click();
    await expect(page.locator('[data-fdt="stylesheets-refresh"]')).not.toHaveAttribute(
      'aria-busy',
      'true'
    );

    // Ground truth after the read: the live page's styles, in document order.
    const truth = await site.page.evaluate(() => ({
      ids: [...document.querySelectorAll('style')].map((style) => style.id),
      links: document.querySelectorAll('link[rel="stylesheet"]').length
    }));
    expect(truth.ids.length, 'the block theme prints inline styles').toBeGreaterThan(5);
    expect(truth.links, 'the scenario prints no stylesheet link').toBe(0);

    const rows = page.locator('[data-fdt="stylesheet-row"]');
    await expect(rows).toHaveCount(truth.ids.length);
    // Each row is named by its id (a block theme's styles carry no class).
    const shownIds = await rows.evaluateAll((elements) =>
      elements.map(
        (row) =>
          row.querySelector('[data-fdt="list-row-name"]')?.textContent.match(/^#([^.]+)/)?.[1] ?? ''
      )
    );
    expect(shownIds).toEqual(truth.ids);
    await expect(page.locator('[data-fdt="state-chip"]')).toHaveCount(0);
    await expect(
      page.locator('[data-fdt="choice"][data-fdt-choice-value="inline"] [data-fdt-choice-count]')
    ).toHaveText(String(truth.ids.length));
    const minified = page.locator('[data-fdt="toggle-chip"][data-fdt-toggle-chip="minified"]');
    await expect(minified.locator('[data-fdt-toggle-count]')).toHaveText('0');
    await expect(minified).toBeDisabled();

    // The detail reads a style's whole CSS, exactly as the live element holds it.
    const last = truth.ids.length - 1;
    const css = await site.page.evaluate(
      (index) => document.querySelectorAll('style')[index]?.textContent ?? '',
      last
    );
    await rows.nth(last).locator('[data-fdt-row-open]').click();
    const detail = panel.locator('[data-fdt="detail-pane"]');
    await expect(detail.locator('[data-fdt="style-css"] [data-fdt-code-content]')).toHaveText(css);
  } finally {
    await panel.close();
    await site.page.close();
  }
});
