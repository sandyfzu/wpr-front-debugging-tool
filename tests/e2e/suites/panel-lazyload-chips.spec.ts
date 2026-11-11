/**
 * The Lazyload page's state chips on `fixtures/lazyload/sources.html`
 * (WP Rocket's lazy markup, script and options; the runtime never loads):
 * WP Rocket's Lazyloaded and the FDT's Excluded each read by their source
 * look under one legend, the marker-only image shows no reasons line, the
 * Excluded filter selects exactly the Excluded rows — and at 768 / 480 /
 * 320 px nothing scrolls sideways (every chip and legend item inside the
 * page at 320), in both themes.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { expectSystemPalette, resetStoredOptions } from '../helpers/options';
import { openPanelForFixture } from '../helpers/panel-data';

/**
 * The image row whose name contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 */
function rowWith(panel: Page, text: string): Locator {
  return panel.locator('[data-fdt="resource-row"]', { hasText: text });
}

/**
 * Each state chip of a row as `label/source`.
 *
 * @param row The row.
 */
async function chipSources(row: Locator): Promise<string[]> {
  return await row
    .locator('[data-fdt="state-chip"]')
    .evaluateAll((chips) =>
      chips.map((chip) => `${chip.textContent}/${(chip as HTMLElement).dataset.fdtSource ?? ''}`)
    );
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`each image chip shows its source under one legend and fits at 320 px (${colorScheme})`, async ({
    extension
  }) => {
    // Suites share one profile and earlier ones leave a Dark/Light choice
    // stored: seed the System default so the emulated scheme decides.
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/lazyload/sources.html', {
      bootHash: '#/lazyload',
      emulation: { colorScheme }
    });
    try {
      await expectSystemPalette(panel, colorScheme);
      await panel.setViewportSize({ width: 1280, height: 1200 });
      await expect(
        panel.locator('[data-fdt="resource-summary"]').getByText('detected', { exact: true })
      ).toBeVisible();
      await expect(panel.locator('[data-fdt="resource-row"]')).toHaveCount(4);
      expect(await chipSources(rowWith(panel, 'a-very-long-hero-image'))).toEqual([
        'Lazyloaded/wp-rocket'
      ]);
      expect(await chipSources(rowWith(panel, 'excluded.jpg'))).toEqual(['Excluded/excluded']);
      expect(await chipSources(rowWith(panel, 'marker-only.jpg'))).toEqual(['Excluded/excluded']);
      expect(await chipSources(rowWith(panel, 'plain.jpg'))).toEqual([]);
      // Hover names the source and the feature.
      await expect(
        rowWith(panel, 'a-very-long-hero-image').locator('[data-fdt-state="lazyloaded"] [title]')
      ).toHaveAttribute('title', 'Lazyloaded by WP Rocket (LazyLoad for images)');
      await expect(
        rowWith(panel, 'excluded.jpg').locator('[data-fdt-state="excluded"] [title]')
      ).toHaveAttribute('title', 'Excluded by FDT from LazyLoad for images');
      // The page's reason stays beside the chip; the marker alone opens no reasons line.
      await expect(
        rowWith(panel, 'excluded.jpg').locator('[data-fdt="lazyload-reasons"]')
      ).toContainText('data-skip-lazy');
      await expect(
        rowWith(panel, 'marker-only.jpg').locator('[data-fdt="lazyload-reasons"]')
      ).toHaveCount(0);
      await expect(rowWith(panel, 'plain.jpg').locator('[data-fdt="lazyload-reasons"]')).toHaveText(
        'No reasons found'
      );
      const legend = panel.locator('[data-fdt="state-source-legend"]');
      await expect(legend).toHaveCount(1);
      await expect(legend).toHaveText('WP RocketSimulated by FDTExcluded by FDTPage');
      await expect(
        panel.locator('[data-fdt-filter-chip="excluded"] [data-fdt-filter-count]')
      ).toHaveText('2');

      const root = panel.locator('[data-fdt-page="lazyload"]');
      for (const width of [768, 480, 320]) {
        await panel.setViewportSize({ width, height: 1200 });
        await expect
          .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
            message: `lazyload must fit at ${String(width)}px (${colorScheme})`
          })
          .toBe(0);
      }
      const pageRight = await root.evaluate((element) => element.getBoundingClientRect().right);
      const rights = await panel
        .locator('[data-fdt="state-chip"] [data-fdt="badge"], [data-fdt="state-source-legend"] > *')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().right)
        );
      expect(rights).toHaveLength(7);
      for (const right of rights) {
        expect(
          right,
          `chip/legend item inside the page at 320px (${colorScheme})`
        ).toBeLessThanOrEqual(pageRight + 0.5);
      }

      // The Excluded filter selects exactly the rows showing the Excluded chip.
      await panel.locator('[data-fdt-filter-chip="excluded"]').click();
      await expect(panel.locator('[data-fdt="resource-row"]')).toHaveCount(2);
      await expect(panel.locator('[data-fdt="resource-row"] [data-fdt="state-chip"]')).toHaveText([
        'Excluded',
        'Excluded'
      ]);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
