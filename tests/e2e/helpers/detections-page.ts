/**
 * Detections page helpers for specs that read the whole row set: Grouped
 * (the default layout) leaves the facts the overview tiles state (plugin
 * identity, cache stamp, server, platform) to the tiles, so a spec pinning
 * "the rendered rows are the view model" switches to List first — every
 * row, page facts included, in the view model's order.
 */
import type { Page } from '@playwright/test';
import { expect } from './extension';

/**
 * Pick the List layout and wait until the rows render in it. The layout
 * control shows, and List renders, from the regular tier up: call it at a
 * wide viewport (narrower, the page renders Grouped and keeps the choice).
 *
 * @param panel The panel page, on `#/detections`.
 */
export async function showDetectionsList(panel: Page): Promise<void> {
  const page = panel.locator('[data-fdt-page="detections"]');
  await page
    .locator('[data-fdt="detections-controls"] [data-fdt-choice-value="list"] label')
    .click();
  await expect(page.locator('[data-fdt="detections-grid"]')).toHaveAttribute(
    'data-fdt-layout',
    'list'
  );
}
