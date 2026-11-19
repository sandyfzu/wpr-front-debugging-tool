/**
 * The Undefined References page's calm list + detail in the real browser,
 * over the found-reference fixture (the page's real search answers through
 * the panel seam's stubbed resource table):
 * - the row reads name · defining-script count · where (the file name);
 * - from the split width a side pane opens on Enter (the sidebar folds while
 *   it is open), carrying the definition's source tile and its copy action;
 *   Esc closes it and hands focus back to the row;
 * - below it the detail drills in: Back is focused, Esc returns to the
 *   list with the row focused;
 * - no horizontal scroll at either layout.
 */
import type { Page } from '@playwright/test';
import { expect, ORIGIN_A, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { wordRow } from '../helpers/undefined-references-page';

/** The fixture's undefined word. */
const WORD = 'wocketInventory';

/** The definer file the stubbed resource table serves. */
const DEFINER_URL = `${ORIGIN_A}/errors/wocket-definer.js`;

/** A viewport whose list content reaches the split width (pane). */
const PANE_WIDTH = 1100;

/** A viewport below it (drill-in). */
const DRILL_WIDTH = 420;

/**
 * Open the panel on the fixture's Undefined References page at a width and
 * wait for the word's answer (the row's count).
 *
 * @param extension The extension driver.
 * @param width The viewport width.
 */
async function openAt(
  extension: Parameters<typeof openPanelForFixture>[0],
  width: number
): Promise<Awaited<ReturnType<typeof openPanelForFixture>>> {
  const opened = await openPanelForFixture(extension, '/errors/found-reference.html', {
    bootHash: '#/undefined-references',
    inspect: {
      origin: ORIGIN_A,
      resources: [{ url: DEFINER_URL, content: 'window.wocketInventory = null;' }]
    }
  });
  await opened.panel.setViewportSize({ width, height: 800 });
  await expect(wordRow(opened.panel, WORD).locator('[data-fdt="list-row-size"]')).toHaveText('1');
  return opened;
}

/**
 * Whether the panel document scrolls horizontally.
 *
 * @param panel The panel page.
 */
async function horizontalScroll(panel: Page): Promise<boolean> {
  return await panel.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

test('rows read name, count and where; Enter opens the pane, Esc returns to the row', async ({
  extension
}) => {
  const { panel, fixture } = await openAt(extension, PANE_WIDTH);
  try {
    const row = wordRow(panel, WORD);
    await expect(row.locator('[data-fdt="list-row-preview"]')).toHaveText('wocket-definer.js');
    await expect(panel.locator('[data-fdt="list-head"]')).toHaveText(/Name\s*Scripts/i);
    const open = row.locator('[data-fdt-row-open]');
    await open.focus();
    await panel.keyboard.press('Enter');
    const pane = panel.locator('[data-fdt="detail-pane"]');
    await expect(pane).toBeVisible();
    await expect(panel.locator('[data-fdt="calm-list"]')).toHaveAttribute(
      'data-fdt-layout',
      'pane'
    );
    // The sidebar folds to the rail while a detail is open.
    await expect(panel.locator('[data-fdt="panel-nav"]')).toHaveAttribute(
      'data-fdt-nav-form',
      'rail'
    );
    await expect(pane.locator('[data-fdt="detail-kind"]')).toHaveText('Undefined reference');
    await expect(pane.locator('[data-fdt="detail-title"]')).toHaveText(WORD);
    await expect(pane.locator('[data-fdt="source-link-open"]')).toHaveAttribute(
      'href',
      DEFINER_URL
    );
    await expect(
      pane.getByRole('button', { name: 'Copy as exclusion: wocket-definer.js' })
    ).toHaveText('Copy as exclusion');
    expect(await horizontalScroll(panel)).toBe(false);
    await open.focus();
    await panel.keyboard.press('Escape');
    await expect(pane).toHaveCount(0);
    await expect(open).toBeFocused();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('below the split width the detail drills in: Back focused, Esc back to the row', async ({
  extension
}) => {
  const { panel, fixture } = await openAt(extension, DRILL_WIDTH);
  try {
    const open = wordRow(panel, WORD).locator('[data-fdt-row-open]');
    await open.focus();
    await panel.keyboard.press('Enter');
    const drill = panel.locator('[data-fdt="drill-detail"]');
    await expect(drill).toBeVisible();
    await expect(panel.locator('[data-fdt="drill-back"]')).toBeFocused();
    await expect(panel.locator('[data-fdt="drill-position"]')).toHaveText('1 of 1');
    // The copy action keeps its visible label at the narrow width.
    await expect(
      drill.getByRole('button', { name: 'Copy as exclusion: wocket-definer.js' })
    ).toHaveText('Copy as exclusion');
    expect(await horizontalScroll(panel)).toBe(false);
    await panel.keyboard.press('Escape');
    await expect(drill).toHaveCount(0);
    await expect(open).toBeFocused();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
