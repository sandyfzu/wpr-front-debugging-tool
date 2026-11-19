/**
 * The JavaScript page's Runtime states section over a real page:
 * the section's chunk loads on its tab, reads the fixture tab's live script
 * elements and classifies them — delayed scripts pending before any
 * interaction, a plain script and JSON-LD not delayed, a nomodule fallback
 * skipped (outside every state chip, named by a note); after a real click on
 * the page the fixture's stand-in runner loads the delayed scripts, and
 * "Read again" shows the theme file and the inline script executed and the
 * missing plugin file failed (network) — the live DOM, not the snapshot the
 * Delay & defer tab still lists. The Source facet narrows by group, the
 * State facet by state (counts follow the read); a row opens its detail
 * (status attribute, reason) and Read again keeps it open on the same
 * script. No horizontal overflow at 320 / 1280 px in light and dark, the
 * detail open (screenshots attached).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { facetCount, openScriptDetail, pickFacet, scriptDetail } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';

/** The section's required label. */
const LIVE_STATE_LABEL = 'Live DOM state (not the snapshot passed to detection)';

/**
 * The state of the row naming a script.
 *
 * @param panel The panel page.
 * @param name The row's name.
 */
function stateOf(panel: Page, name: string): Locator {
  return panel
    .locator('[data-fdt="runtime-row"]', { hasText: name })
    .locator('[data-fdt-runtime-state]');
}

test('reads the live script states, before and after a real interaction', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/runtime/scripts.html');
  try {
    await panel.evaluate(() => {
      location.hash = '#/javascript';
    });
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    await panel.getByRole('tab', { name: 'Runtime states' }).click();
    await expect(panel.getByRole('heading', { level: 2, name: LIVE_STATE_LABEL })).toBeVisible();
    const rows = panel.locator('[data-fdt="runtime-row"]');
    await expect(rows).toHaveCount(7);

    // Before any interaction: the delayed scripts wait.
    await expect(stateOf(panel, 'theme.js')).toHaveAttribute('data-fdt-runtime-state', 'pending');
    await expect(stateOf(panel, 'theme.js')).toHaveAttribute('data-fdt-runtime-group', 'theme');
    await expect(stateOf(panel, 'missing.js')).toHaveAttribute('data-fdt-runtime-group', 'plugin');
    await expect(stateOf(panel, 'lib.js')).toHaveAttribute('data-fdt-runtime-state', 'not-delayed');
    await expect(stateOf(panel, 'legacy.js')).toHaveAttribute('data-fdt-runtime-state', 'skipped');
    await expect(facetCount(panel, 'pending')).toHaveText('3');
    await expect(facetCount(panel, 'executed')).toHaveText('0');
    await expect(panel.locator('[data-fdt-runtime-note]')).toContainText(
      '1 skipped script (a nomodule fallback this browser doesn’t need)'
    );
    await expect(facetCount(panel, 'inline')).toHaveText('3');
    // Open the theme file before the run: Read again must keep it open.
    const themeDetail = await openScriptDetail(
      panel,
      panel.locator('[data-fdt="runtime-row"]', { hasText: 'theme.js' })
    );
    await expect(themeDetail.locator('[data-fdt-runtime-detail]')).toContainText('Pending');

    // A real interaction runs the delayed scripts; the page stamps their outcome.
    await fixture.page.locator('h1').click();
    await expect(fixture.page.locator('script[data-rocket-status="executed"]')).toHaveCount(2);
    await expect(fixture.page.locator('script[data-rocket-status="failed-network"]')).toHaveCount(
      1
    );
    await panel.locator('[data-fdt-runtime-read]').click();
    await expect(stateOf(panel, 'theme.js')).toHaveAttribute('data-fdt-runtime-state', 'executed');
    await expect(stateOf(panel, 'missing.js')).toHaveAttribute('data-fdt-runtime-state', 'failed');
    await expect(facetCount(panel, 'executed')).toHaveText('2');
    await expect(facetCount(panel, 'pending')).toHaveText('0');
    // The same script's detail, still open, now says it ran.
    await expect(scriptDetail(panel).locator('[data-fdt="detail-title"]')).toHaveText('theme.js');
    await expect(scriptDetail(panel).locator('[data-fdt-runtime-detail]')).toContainText(
      'executed'
    );

    // The Failed state, then its detail: the status attribute and the reason.
    await pickFacet(panel, 'failed');
    await expect(rows).toHaveCount(1);
    const detail = await openScriptDetail(panel, rows.first());
    await expect(detail.locator('[data-fdt-runtime-detail]')).toContainText('failed-network');
    await expect(detail.locator('[data-fdt-runtime-detail]')).toContainText(
      'its file failed to load'
    );
    await pickFacet(panel, 'any', 'State');

    // A source value narrows to its group.
    await pickFacet(panel, 'other');
    await expect(rows).toHaveCount(2);
    await pickFacet(panel, 'any', 'Source');
    await expect(rows).toHaveCount(7);
    await openScriptDetail(panel, rows.first());

    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 900 });
        const overflow = await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `horizontal overflow at ${String(width)} px (${scheme})`).toBe(0);
        await info.attach(`runtime-states-${scheme}-${String(width)}`, {
          body: await panel.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
      }
    }

    // The served view still lists the snapshot detection parsed at load: three delayed.
    await panel.getByRole('tab', { name: 'Delay & defer' }).click();
    await expect(facetCount(panel, 'delayed')).toHaveText('3');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
