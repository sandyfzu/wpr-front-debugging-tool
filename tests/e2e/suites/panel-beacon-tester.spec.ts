/**
 * The Beacon Tester page over a real run (P14C C1): the panel asks the
 * fixture tab to run WP Rocket's beacon — the runner injected on demand —
 * and renders each outcome: the desktop viewport bail at WP Rocket's
 * 1600 × 700 defaults (the fixture window is 1280 × 800), then, with lower
 * thresholds, the completed run's candidate table (the hero first, as `lcp`)
 * and the lazy-render hashes; the settings survive a panel reload. The page
 * is screenshotted in both palettes at the compact floor and a wide size
 * (no horizontal overflow at either).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Open the Beacon Tester route and wait for its loaded form. */
async function openTester(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    location.hash = '#/beacon-tester';
  });
  await expect(panel.getByRole('heading', { level: 1, name: 'Beacon Tester' })).toBeVisible();
  await expect(panel.getByLabel('Candidate elements')).toBeVisible();
}

/**
 * Toggle a switch the way a pointer does: its track (the input is visually hidden).
 *
 * @param panel The panel page.
 * @param name The switch's label.
 */
async function toggle(panel: Page, name: string): Promise<void> {
  const id = await panel.getByRole('switch', { name }).getAttribute('id');
  if (id === null) throw new Error(`The ${name} switch has no id`);
  await panel.locator(`[id="${id.replace(/-input$/, '-control')}"]`).click();
}

/** The finished run's outcome block. */
function outcome(panel: Page) {
  return panel.locator('[data-fdt="beacon-outcome"]');
}

test('runs the beacon on the inspected page: viewport bail, results, persisted settings', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/beacon/candidates.html');
  try {
    await openTester(panel);
    await toggle(panel, 'Optimize Critical Images');
    await toggle(panel, 'Automatic Lazy Rendering');

    // WP Rocket's desktop defaults need a viewport of at least 1600 × 700.
    await panel.locator('[data-fdt-beacon-run]').click();
    await expect(outcome(panel)).toHaveAttribute('data-fdt-beacon-outcome', 'bailed');
    await expect(outcome(panel)).toContainText('at least 1,600 × 700 px');

    await panel.getByLabel('Viewport width (px)').fill('1000');
    await panel.getByLabel('Viewport height (px)').fill('600');
    await panel.locator('[data-fdt-beacon-run]').click();
    await expect(outcome(panel)).toHaveAttribute('data-fdt-beacon-outcome', 'completed');
    await expect(outcome(panel)).toContainText('Beacon test complete');

    // The run opens the critical images: the hero is the LCP.
    const candidates = panel.locator('[data-fdt="beacon-candidate-row"]');
    await expect(candidates.first()).toContainText('#hero');
    await expect(candidates.first()).toContainText('lcp');
    expect(await candidates.count()).toBeGreaterThanOrEqual(2);

    await panel.getByRole('tab', { name: /Lazy rendering/ }).click();
    const hashes = panel.locator('[data-fdt="beacon-lazy-row"]');
    await expect(hashes).toHaveText(['far-section-one', 'far-section-two']);

    // The fixture page is not scrolled or changed by the run.
    expect(await fixture.page.evaluate(() => window.scrollY)).toBe(0);

    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        await panel.getByRole('tab', { name: /Critical images/ }).click();
        const overflow = await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `horizontal overflow at ${String(width)} px (${scheme})`).toBe(0);
        await info.attach(`beacon-tester-${scheme}-${String(width)}`, {
          body: await panel.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
        await panel.getByRole('tab', { name: 'Settings' }).click();
        await expect(panel.getByLabel('Candidate elements')).toBeVisible();
        expect(
          await panel
            .locator('[data-fdt="panel-content"]')
            .evaluate((element) => element.scrollWidth - element.clientWidth),
          `settings overflow at ${String(width)} px (${scheme})`
        ).toBe(0);
        await info.attach(`beacon-tester-settings-${scheme}-${String(width)}`, {
          body: await panel.locator('[data-fdt="panel-content"]').screenshot(),
          contentType: 'image/png'
        });
      }
    }

    // The settings were saved: a fresh panel document shows them.
    await panel.reload({ waitUntil: 'load' });
    await openTester(panel);
    await expect(panel.getByLabel('Viewport width (px)')).toHaveValue('1000');
    await expect(panel.getByRole('switch', { name: 'Automatic Lazy Rendering' })).toBeChecked();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
