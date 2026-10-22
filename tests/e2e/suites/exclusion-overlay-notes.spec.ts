/**
 * P10K.5a suite — the exclusion builder's stored-form notes, in the real
 * overlay (injected into a fixture page's top frame the way the background
 * opens it) over the real session backend.
 *
 * Owner-visible flows: a row becomes WP Rocket's stored form when left,
 * with a "you typed" note and Undo (keyboard only); a duplicate row leaves
 * with its note and Restore, and focus that was heading into the removed
 * row lands on Restore; copy-all copies the stored form; and, applied, a
 * Delay row typed in another case matches its script while a picked row
 * whose file name holds `+` excludes its own (both scripts run).
 *
 * The overlay is a shadow-root UI (open root): Playwright's role locators
 * pierce it. Every leg opens its own fixture tab (a session is per tab).
 */

import type { Locator, Page } from '@playwright/test';

import {
  expect,
  openFixturePage,
  ORIGIN_A,
  test,
  type DriverPage,
  type ExtensionDriver
} from '../helpers/extension';

/** The fixture page: two scripts served as Delay JavaScript execution delays them. */
const FIXTURE = '/exclusion/delayed.html';

/** The Delay lane's label (the verified feature name). */
const DELAY = 'Delay JavaScript execution';

/** Bounded waits for the overlay mount and the applied reload. */
const MOUNT = { timeout: 15_000 };
const APPLIED = { timeout: 30_000 };

/**
 * Open the fixture and the exclusion builder in it (the background's own
 * injection: the overlay's runtime content script into the top frame).
 *
 * @param extension The driver.
 */
async function openBuilder(extension: ExtensionDriver): Promise<DriverPage> {
  const opened = await openFixturePage(extension, FIXTURE);
  await extension.evaluateInWorker(async (tabId: number) => {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ['/content-scripts/exclusion-overlay.js']
    });
  }, opened.tabId);
  await expect(opened.page.getByRole('heading', { name: 'Exclusion builder' })).toBeVisible(MOUNT);
  await expect(opened.page.getByRole('button', { name: /^Apply$/ })).toBeVisible(MOUNT);
  return opened;
}

/** The Delay lane region. */
const delayLane = (page: Page): Locator => page.getByRole('region', { name: DELAY });

/** A Delay row's input. */
const delayRow = (page: Page, n: number): Locator =>
  page.getByRole('textbox', { name: `${DELAY} row ${String(n)}`, exact: true });

/** The focused element's accessible name (inside the overlay's shadow root). */
async function focusedName(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    let active: Element | null = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active?.getAttribute('aria-label') ?? null;
  });
}

/** Add a Delay row and type into it (focus ends in the row). */
async function typeNewDelayRow(page: Page, text: string): Promise<void> {
  await delayLane(page).getByRole('button', { name: 'Add row' }).click();
  await page.keyboard.type(text);
}

test.describe('exclusion builder stored-form notes', () => {
  test('a row left becomes its stored form with a note; Undo restores the typed text', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'jquery-*.js');
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 1)).toHaveValue('jquery-(.*).js');
    await expect(delayLane(page)).toContainText(
      'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).'
    );
    // The note describes the row; focus did not move at commit.
    await expect(delayRow(page, 1)).toHaveAccessibleDescription(
      'WP Rocket stores this as jquery-(.*).js (you typed jquery-*.js).'
    );
    expect(await focusedName(page)).toBe(`Remove ${DELAY} row 1`);
    await expect(page.getByRole('status').last()).toHaveText(
      `${DELAY} row 1: WP Rocket stores it as jquery-(.*).js.`
    );
    // Undo is next in Tab order; Enter puts the typed text back, focused.
    await page.keyboard.press('Tab');
    expect(await focusedName(page)).toBe(`Undo change to ${DELAY} row 1`);
    await page.keyboard.press('Enter');
    await expect(delayRow(page, 1)).toHaveValue('jquery-*.js');
    await expect(delayRow(page, 1)).toBeFocused();
    // Leaving again converts again, with the same note.
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 1)).toHaveValue('jquery-(.*).js');
    await expect(
      delayLane(page).getByRole('button', { name: `Undo change to ${DELAY} row 1` })
    ).toBeVisible();
    // The next edit in the lane ends the undo; the note stays.
    await delayRow(page, 1).press('End');
    await page.keyboard.type('x');
    await expect(
      delayLane(page).getByRole('button', { name: `Undo change to ${DELAY} row 1` })
    ).toHaveCount(0);
    await page.close();
  });

  test('a duplicate row leaves with its note; Restore brings it back for editing', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'gtag');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gtag');
    // Tab heads to the row's own Remove button, which leaves with the row.
    await page.keyboard.press('Tab');
    await expect(delayRow(page, 2)).toHaveCount(0);
    await expect(delayLane(page).getByRole('list', { name: `${DELAY} rows removed` })).toHaveText(
      /Removed gtag: WP Rocket drops a copy of row 1\./
    );
    expect(await focusedName(page)).toBe(`Restore removed ${DELAY} row 2`);
    await page.keyboard.press('Enter');
    await expect(delayRow(page, 2)).toHaveValue('gtag');
    await expect(delayRow(page, 2)).toBeFocused();
    await page.close();
  });

  test('copy-all copies the stored form', async ({ extension }) => {
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: ORIGIN_A
    });
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'jquery-*.js');
    await page.keyboard.press('Enter');
    await page.keyboard.type('g%41tag');
    await page.getByRole('button', { name: `Copy all ${DELAY} exclusions`, exact: true }).click();
    await expect(page.getByRole('status').last()).toHaveText('Copied 2 exclusions');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('jquery-(.*).js\ngtag');
    await page.close();
  });

  test('applied: a row typed in another case matches; a picked + row excludes its script', async ({
    extension
  }) => {
    const { page } = await openBuilder(extension);
    await typeNewDelayRow(page, 'JQUERY-UI.JS');
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: /^On this page/ }).click();
    await page.getByRole('button', { name: `Add a+b.js to ${DELAY}` }).click();
    // The picker writes `+` as `\x2B` (WP Rocket reads a Delay `+` literally).
    await expect(delayRow(page, 2)).toHaveValue(/a\\x2Bb/);
    await page.getByRole('button', { name: /^Apply$/ }).click();
    // The page reloads through the session; the overlay comes back with counts.
    await expect(page.getByText('2 of 2 delayed scripts restored')).toBeVisible(APPLIED);
    const rows = delayLane(page).getByRole('listitem');
    await expect(rows.nth(0)).toContainText('1 match');
    await expect(rows.nth(1)).toContainText('1 match');
    await expect
      .poll(() =>
        page.evaluate(() => [
          document.documentElement.dataset.jqueryUiRan,
          document.documentElement.dataset.abRan
        ])
      )
      .toEqual(['true', 'true']);
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.close();
  });
});
