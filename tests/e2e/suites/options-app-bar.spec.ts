/**
 * The options page's app bar over the real document:
 *
 * - at a 320 × 480 tab the bar stays pinned at the top of the scrolled page
 *   with Save, the unsaved marker and the appearance menu whole and on
 *   screen (the name elides, the version chip stays, the "Options" label
 *   leaves the row — back from the regular tier), with no horizontal
 *   scroll; the marker follows dirty → saved;
 * - a menu pick restyles the options page and an open panel live, stores
 *   the choice and moves the appearance row (the page stays clean: the
 *   pick wrote at once);
 * - a pick in the panel moves the open options page's row and menu live
 *   (the row held no unsaved edit);
 * - the menu's code stays off the page's start set (walked from the build
 *   the way the budget gate walks it), yet a first Enter opens it.
 *
 * Every write goes through shipped code; the suite only resets the item.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { settleFrames } from '../helpers/frames';
import { openPanelForFixture } from '../helpers/panel-data';
import { pageStartSet } from '../helpers/start-set';
import {
  CHOICE_LABELS,
  expectRealmAlive,
  openOptionsPage,
  PAGE_SURFACE_0,
  readDocumentTheme,
  readStoredOptions,
  resetStoredOptions,
  rowSwitchTrack,
  saveOptions,
  stampRealm
} from '../helpers/options';

/** The live-restyle polls' profile (a storage-watch round trip). */
const RESTYLE_POLL: { timeout: number; intervals: number[] } = {
  timeout: 10_000,
  intervals: [100, 250, 500]
};

/** The badge row's storage id (the dirty-making toggle, last on the page). */
const BADGE_ROW_ID = 'toolbarBadge';

/**
 * Code only the appearance menu's own chunk carries: floating-ui's platform
 * hook (a property name, so minification keeps it) and the Kobalte menu
 * content's style key. Either in the options start set means the menu's
 * code moved back onto the page's start, under whatever chunk name.
 */
const MENU_CODE_MARKERS: readonly RegExp[] = [
  /convertOffsetParentRelativeRectToViewportRelativeRect/u,
  /["'`]--kb-menu-content-transform-origin["'`]/u
];

/** A document's appearance trigger (its name starts with "Appearance:"). */
function trigger(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('button', { name: /^Appearance: / });
}

/**
 * Pick one row of a document's appearance menu and wait for it to close.
 *
 * @param page The options or panel page.
 * @param name The row's word.
 */
async function pick(page: Page, name: 'System' | 'Dark' | 'Light'): Promise<void> {
  await trigger(page).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name }).click();
  await expect(menu).toHaveCount(0);
}

/**
 * Assert an element's box lies inside the viewport horizontally and
 * intersects it vertically.
 *
 * @param page The page.
 * @param locator The element.
 * @param what Its name in the failure message.
 */
async function expectOnScreen(
  page: Page,
  locator: ReturnType<Page['locator']>,
  what: string
): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error(`${what} has no box`);
  expect(box.x, `${what} starts on screen`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} ends on screen`).toBeLessThanOrEqual(viewport.width);
  expect(box.y, `${what} is not above the viewport`).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height, `${what} is not below the viewport`).toBeLessThanOrEqual(
    viewport.height
  );
}

test.describe('the options app bar', () => {
  test('at 320 × 480 the scrolled page keeps the bar, Save and the marker reachable', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await page.setViewportSize({ width: 320, height: 480 });
      await settleFrames(page);
      const bar = page.locator('[data-fdt="options-app-bar"]');
      const save = page.getByRole('button', { name: 'Save', exact: true });
      const marker = page.locator('[data-fdt="options-unsaved"]');
      await expect(save).toBeDisabled();
      await expect(marker).toHaveCount(0);

      // Dirty from the last row: the click scrolls the document down.
      await rowSwitchTrack(page, BADGE_ROW_ID).click();
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(marker).toHaveText('Unsaved changes');
      await expect(save).toBeEnabled();

      // Pinned: the bar sits at the viewport's top, its controls whole.
      expect((await bar.boundingBox())?.y).toBe(0);
      await expectOnScreen(page, save, 'Save');
      await expectOnScreen(page, marker, 'the unsaved marker');
      await expectOnScreen(page, trigger(page), 'the appearance menu');
      const chip = bar.getByText(/^v\d/u);
      await expect(chip).toBeVisible();
      await expectOnScreen(page, chip, 'the version chip');
      // The name is what gives way: it elides inside its own box.
      const name = await bar
        .getByRole('heading', { level: 1 })
        .evaluate((heading) => ({ scroll: heading.scrollWidth, client: heading.clientWidth }));
      expect(name.scroll, 'the name elides at 320 px').toBeGreaterThan(name.client);
      // Below the regular tier the "Options" label takes no room from it.
      const label = bar.getByText('Options', { exact: true });
      expect((await label.boundingBox())?.width ?? 0, 'no label at 320 px').toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        ),
        'no horizontal scroll at 320 px'
      ).toBe(0);

      // Saved from the scrolled position: the marker goes, Save rests.
      await saveOptions(page);
      await expect(marker).toHaveCount(0);
      await expect(save).toBeDisabled();
      expect((await readStoredOptions(extension))?.['features']).toMatchObject({
        toolbarBadge: false
      });

      // From the regular tier the label is back in the row.
      await page.setViewportSize({ width: 520, height: 480 });
      await settleFrames(page);
      await expect(label).toBeVisible();
      expect((await label.boundingBox())?.width ?? 0, 'the label at 520 px').toBeGreaterThan(20);
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('the menu’s code stays off the start, and a first key press opens it at its first row', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      // Off the start: no start file is the menu's chunk or carries its code (it is fetched
      // later, by the idle prefetch or the first press) …
      const start = pageStartSet('options.html');
      expect([...start.keys()].some((file) => file.startsWith('chunks/options-'))).toBe(true);
      for (const [file, source] of start) {
        expect(file, 'the menu chunk on the start').not.toMatch(/appearance-menu-/u);
        for (const marker of MENU_CODE_MARKERS)
          expect(source, `${file} ${String(marker)}`).not.toMatch(marker);
      }
      // … yet the trigger is there at once, and Enter opens the menu on the first press.
      await trigger(page).focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('menuitemradio', { name: 'System' })).toBeFocused();
      // The real menu answered (the stand-in, if it got the press, handed over).
      await expect(page.locator('[data-fdt="appearance-menu-stand-in"]')).toHaveCount(0);
      await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
    } finally {
      await page.close();
    }
  });

  test('a menu pick restyles the options page and an open panel live, and the row follows', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'light' }
    });
    const options = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await stampRealm(options);
      await stampRealm(panel);
      await expect(trigger(options)).toHaveAccessibleName('Appearance: System (Light)');
      await pick(options, 'Dark');

      for (const page of [options, panel]) {
        await expect
          .poll(async () => (await readDocumentTheme(page)).dataTheme, RESTYLE_POLL)
          .toBe('dark');
        expect((await readDocumentTheme(page)).background).toBe(PAGE_SURFACE_0.dark);
      }
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'], RESTYLE_POLL)
        .toBe('dark');
      await expect(options.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();
      await expect(trigger(options)).toHaveAccessibleName('Appearance: Dark');
      await expect(trigger(panel)).toHaveAccessibleName('Appearance: Dark');
      // Written at once: nothing is left for Save.
      await expect(options.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
      await expect(options.locator('[data-fdt="options-unsaved"]')).toHaveCount(0);
      await expectRealmAlive(options);
      await expectRealmAlive(panel);
    } finally {
      await resetStoredOptions(extension);
      await options.close();
      await panel.close();
      await fixture.page.close();
    }
  });

  test("a panel pick moves the open options page's row and menu live", async ({ extension }) => {
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'light' }
    });
    const options = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await stampRealm(options);
      await expect(options.getByRole('radio', { name: CHOICE_LABELS.system })).toBeChecked();
      await pick(panel, 'Dark');
      await expect(options.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked(
        RESTYLE_POLL
      );
      await expect(trigger(options)).toHaveAccessibleName('Appearance: Dark');
      await expect(options.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

      await pick(panel, 'Light');
      await expect(options.getByRole('radio', { name: CHOICE_LABELS.light })).toBeChecked(
        RESTYLE_POLL
      );
      await expect(trigger(options)).toHaveAccessibleName('Appearance: Light');
      expect((await readDocumentTheme(options)).dataTheme).toBe('light');
      await expectRealmAlive(options);
    } finally {
      await resetStoredOptions(extension);
      await options.close();
      await panel.close();
      await fixture.page.close();
    }
  });
});
