/**
 * The JavaScript page's state chips on a crafted fixture
 * (`fixtures/javascript/chips.html`: the meta declares Delay JS and Combine
 * JS, no runtime ever runs the delayed tags):
 *
 * - root- and protocol-relative bundle URLs read Combined (resolved before
 *   the bundle-shape test, as the detection pass resolves served URLs);
 * - a classic original type (`text/javascript`) shows no detail, a 64-char
 *   one with no break opportunity does — and wraps inside the page at 320 px
 *   instead of pushing it sideways.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The fixture's long original type (the payload cap: 64 characters). */
const LONG_TYPE = 'xlongoriginaltypewithoutanybreakopportunityatallabcdefghijklmnop';

/**
 * The row whose URL contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 * @returns The row locator.
 */
function rowWith(panel: Page, text: string): Locator {
  return panel.locator('[data-fdt="script-row"]', { hasText: text });
}

test('relative bundle URLs read Combined; the original type hides when classic and wraps at 320 px', async ({
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
    await expect(
      panel.locator('[data-fdt-filter-chip="combined"] [data-fdt-filter-count]')
    ).toHaveText('2');

    await expect(
      rowWith(panel, 'classic-type.js').locator('[data-fdt="script-original-type"]')
    ).toHaveCount(0);
    const detail = rowWith(panel, 'long-type.js').locator('[data-fdt="script-original-type"]');
    await expect(detail).toHaveText(`type: ${LONG_TYPE}`);

    const root = panel.locator('[data-fdt-page="javascript"]');
    for (const width of [320, 480, 1280]) {
      await panel.setViewportSize({ width, height: 1600 });
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript must fit at ${String(width)}px`
        })
        .toBe(0);
      const pageRight = await root.evaluate((element) => element.getBoundingClientRect().right);
      const detailRight = await detail.evaluate((element) => element.getBoundingClientRect().right);
      expect(detailRight, `type detail inside the page at ${String(width)}px`).toBeLessThanOrEqual(
        pageRight + 0.5
      );
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
