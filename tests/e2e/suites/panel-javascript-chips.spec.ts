/**
 * The JavaScript page's state chips on a crafted fixture
 * (`fixtures/javascript/chips.html`: the meta declares Delay JS and Combine
 * JS, no runtime ever runs the delayed tags):
 *
 * - root- and protocol-relative bundle URLs read Combined (resolved before
 *   the bundle-shape test, as the detection pass resolves served URLs);
 * - a classic original type (`text/javascript`) leads no row preview, a
 *   64-char one with no break opportunity does — the row's preview truncates
 *   inside the page and the detail's "Original type" fact wraps inside it at
 *   320 px instead of pushing it sideways.
 *
 * And each chip's source on `fixtures/javascript/sources.html` (Delay JS,
 * Defer JS and Minify JS declared): WP Rocket's states, the FDT's exclusion
 * and the page's own defer each read by their look, under one legend — a row
 * shows two chips and folds the rest into "+N", its detail lists them all —
 * at 320 px nothing scrolls sideways, in both themes.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import {
  closeScriptDetail,
  facetCount,
  openScriptDetail,
  scriptRow
} from '../helpers/javascript-page';
import { expectSystemPalette, resetStoredOptions } from '../helpers/options';
import { openPanelForFixture } from '../helpers/panel-data';

/** The fixture's long original type (the payload cap: 64 characters). */
const LONG_TYPE = 'xlongoriginaltypewithoutanybreakopportunityatallabcdefghijklmnop';

/**
 * The row whose name or URL preview contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 * @returns The row locator.
 */
function rowWith(panel: Page, text: string): Locator {
  return scriptRow(panel, text);
}

/**
 * An element's right edge (px, viewport space).
 *
 * @param element The element.
 */
async function rightEdge(element: Locator): Promise<number> {
  return await element.evaluate((node) => node.getBoundingClientRect().right);
}

test('relative bundle URLs read Combined; a classic original type leads no preview, a long one wraps in the detail at 320 px', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/javascript/chips.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.setViewportSize({ width: 1280, height: 1600 });
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    await expect(panel.locator('[data-fdt="script-row"]')).toHaveCount(4);

    for (const name of [
      '5c03bce63bb3260466706a046cb00086.js',
      '0123456789abcdef0123456789abcdef.js'
    ]) {
      await expect(rowWith(panel, name).locator('[data-fdt="state-chip"]'), name).toHaveText([
        'Delayed',
        'Combined'
      ]);
    }
    // The File facet's Combined segment counts both bundles.
    await expect(facetCount(panel, 'combined')).toHaveText('2');

    // A classic original type leads no preview; the long one leads its row's.
    const preview = (name: string): Locator =>
      rowWith(panel, name).locator('[data-fdt="list-row-preview"]');
    await expect(preview('classic-type.js')).not.toContainText('text/javascript');
    await expect(preview('classic-type.js')).toContainText('/javascript/classic-type.js');
    await expect(preview('long-type.js')).toHaveText(
      new RegExp(`^${LONG_TYPE} · .*/javascript/long-type\\.js$`)
    );

    const root = panel.locator('[data-fdt-page="javascript"]');
    for (const width of [320, 480, 1280]) {
      await panel.setViewportSize({ width, height: 1600 });
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript must fit at ${String(width)}px`
        })
        .toBe(0);
      const pageRight = await rightEdge(root);
      expect(
        await rightEdge(preview('long-type.js')),
        `type preview inside the page at ${String(width)}px`
      ).toBeLessThanOrEqual(pageRight + 0.5);
      // The detail names the whole type and wraps it inside the page.
      const detail = await openScriptDetail(panel, rowWith(panel, 'long-type.js'));
      const fact = detail.locator('[data-fdt="script-facts"] dd', { hasText: LONG_TYPE });
      await expect(fact).toHaveText(LONG_TYPE);
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript with the detail open must fit at ${String(width)}px`
        })
        .toBe(0);
      expect(
        await rightEdge(fact),
        `type fact inside the page at ${String(width)}px`
      ).toBeLessThanOrEqual(pageRight + 0.5);
      await closeScriptDetail(panel);
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/**
 * Each visible chip of a row as `label/source`.
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
  test(`each chip shows its source under one legend and fits at 320 px (${colorScheme})`, async ({
    extension
  }) => {
    // Suites share one profile and earlier ones leave a Dark/Light choice
    // stored: seed the System default so the emulated scheme decides.
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/javascript/sources.html', {
      bootHash: '#/javascript',
      emulation: { colorScheme }
    });
    try {
      await expectSystemPalette(panel, colorScheme);
      await panel.setViewportSize({ width: 1280, height: 1200 });
      await expect(panel.locator('[data-fdt="script-row"]')).toHaveCount(3);
      // A row shows its first two chips and folds the rest into "+N" — here
      // WP Rocket's Minified, so the fold carries WP Rocket's look.
      const navigation = rowWith(panel, 'navigation.min.js');
      expect(await chipSources(navigation)).toEqual(['Delayed/wp-rocket', 'Deferred/wp-rocket']);
      const overflow = navigation.locator('[data-fdt="state-chip-overflow"]');
      await expect(overflow).toHaveText('+1');
      await expect(overflow).toHaveAttribute('data-fdt-hides-wp-rocket', '');
      expect(await chipSources(rowWith(panel, 'deferred-two.js'))).toEqual(['Excluded/excluded']);
      expect(await chipSources(rowWith(panel, 'deferred-one.js'))).toEqual(['Deferred/page']);
      // Its detail lists every chip with its source.
      const detail = await openScriptDetail(panel, navigation);
      expect(await chipSources(detail.locator('[data-fdt="script-detail-chips"]'))).toEqual([
        'Delayed/wp-rocket',
        'Deferred/wp-rocket',
        'Minified/wp-rocket'
      ]);
      await closeScriptDetail(panel);
      // Every chip names its source and feature on hover.
      await expect(
        rowWith(panel, 'navigation.min.js').locator('[data-fdt-state="delayed"] [title]')
      ).toHaveAttribute('title', 'Delayed by WP Rocket (Delay JavaScript execution)');
      const legend = panel.locator('[data-fdt="state-source-legend"]');
      await expect(legend).toHaveCount(1);
      await expect(legend).toHaveText('WP RocketSimulated by FDTExcluded by FDTPage');

      const root = panel.locator('[data-fdt-page="javascript"]');
      await panel.setViewportSize({ width: 320, height: 1200 });
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript must fit at 320px (${colorScheme})`
        })
        .toBe(0);
      const pageRight = await root.evaluate((element) => element.getBoundingClientRect().right);
      const rights = await panel
        .locator(
          '[data-fdt="state-chip"] [data-fdt="badge"], [data-fdt="state-chip-overflow"] [data-fdt="badge"], [data-fdt="state-source-legend"] > *'
        )
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().right)
        );
      expect(rights).toHaveLength(9);
      for (const right of rights) {
        expect(
          right,
          `chip/legend item inside the page at 320px (${colorScheme})`
        ).toBeLessThanOrEqual(pageRight + 0.5);
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
