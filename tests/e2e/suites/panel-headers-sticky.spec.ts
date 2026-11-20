/**
 * The Headers & Cookies page's sticky section headings, in a real layout:
 * the active heading pins to the list's top while its rows scroll under it
 * (opaque, nothing shows through), it hands over to the next section's
 * heading, and a find match scrolled back up lands below the stuck band —
 * never hidden under it. Rows separate by spacing, not hairlines, and a
 * one-line row keeps its 36 px floor.
 *
 * Fixture: `/__e2e/header-find-deep` (10 response headers, 60 readable
 * cookies `fdt_deep_01…60`), so the cookie section runs viewports deep.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture, relaySearchAction } from '../helpers/panel-data';

/** The geometry of the list, its stuck band and the find's marked row. */
interface StickyGeometry {
  /** The stuck band's heading name (its visible text, normalized), or null. */
  stuck: string | null;
  /** Stuck band top minus scroller top (px; 0 = pinned). */
  bandOffset: number | null;
  /** The stuck band's bottom edge (viewport px). */
  bandBottom: number | null;
  /** The marked row's top edge (viewport px), or null without a marked row. */
  markedTop: number | null;
  /** The marked row's cookie token, or null. */
  marked: string | null;
  /** The scroller's scrollTop. */
  scrollTop: number;
}

/**
 * Read the list geometry in the panel.
 *
 * @param panel The panel page.
 * @returns The geometry.
 */
function geometry(panel: Page): Promise<StickyGeometry> {
  return panel.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
    if (list === null) throw new Error('no list');
    const band = list.querySelector<HTMLElement>('[data-fdt-stuck]');
    const marked = list.querySelector<HTMLElement>('[aria-current="true"]');
    const listTop = list.getBoundingClientRect().top;
    const bandRect = band?.getBoundingClientRect();
    return {
      stuck:
        band?.querySelector('[role="heading"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      bandOffset: bandRect === undefined ? null : Math.round(bandRect.top - listTop),
      bandBottom: bandRect?.bottom ?? null,
      markedTop: marked?.getBoundingClientRect().top ?? null,
      marked: marked?.textContent.match(/fdt_deep_\d{2}/)?.[0] ?? null,
      scrollTop: list.scrollTop
    };
  });
}

/**
 * Scroll the list's own scroller and let the virtualizer re-render.
 *
 * @param panel The panel page.
 * @param top The scroll offset (px).
 */
async function scrollList(panel: Page, top: number): Promise<void> {
  await panel.evaluate((offset) => {
    const list = document.querySelector<HTMLElement>('[data-fdt-page] [role="list"]');
    if (list === null) throw new Error('no list');
    list.scrollTop = offset;
  }, top);
}

test('section headings stick over their rows and find matches land below the band', async ({
  extension
}) => {
  // Cookies persist per origin across suites: clear them so the counts pin this fixture.
  await extension.browserContext.clearCookies();
  const { panel, fixture } = await openPanelForFixture(extension, '/__e2e/header-find-deep', {
    bootHash: '#/headers-cookies'
  });
  try {
    // A short panel: the cookie list runs several viewports deep.
    await panel.setViewportSize({ width: 1100, height: 480 });
    const page = panel.locator('[data-fdt-page="headers-cookies"]');
    await expect(page.locator('[data-fdt="headers-results-status"]')).toHaveText(
      'Showing all 70 entries'
    );

    // At rest the first heading is the stuck one, in its own place.
    await expect
      .poll(() => geometry(panel))
      .toMatchObject({
        stuck: expect.stringMatching(/^Caching evidence \d+ headers?$/),
        bandOffset: 0
      });

    // Deep in the cookie list: the cookie heading is pinned to the top, the
    // header headings are gone from the window.
    await scrollList(panel, 1200);
    await expect
      .poll(() => geometry(panel))
      .toMatchObject({
        stuck: 'Cookies 60 cookies',
        bandOffset: 0
      });
    // Opaque: the band paints the canvas over whatever row scrolls under it.
    const bandBackground = await panel.evaluate(() => {
      const band = document.querySelector('[data-fdt-stuck] [data-fdt-inventory-row] > div');
      return band === null ? null : getComputedStyle(band).backgroundColor;
    });
    expect(bandBackground).not.toBeNull();
    expect(bandBackground).not.toBe('rgba(0, 0, 0, 0)');

    // Back up: the first section's heading takes over again.
    await scrollList(panel, 0);
    await expect
      .poll(() => geometry(panel))
      .toMatchObject({
        stuck: expect.stringMatching(/^Caching evidence \d+ headers?$/),
        bandOffset: 0
      });

    // The find filters to fdt_deep_50…59 (the cookie heading + lead + 10
    // rows, taller than the list); walking to the last match scrolls down,
    // the wrap to the first scrolls back up — that row must land below the
    // stuck band, not under it.
    await relaySearchAction(extension, {
      action: 'performSearch',
      query: 'fdt_deep_5',
      tabId: fixture.tabId
    });
    await expect.poll(async () => (await geometry(panel)).marked).toBe('fdt_deep_50');
    for (let step = 1; step <= 9; step += 1) {
      await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
    }
    await expect.poll(async () => (await geometry(panel)).marked).toBe('fdt_deep_59');
    await expect.poll(async () => (await geometry(panel)).scrollTop).toBeGreaterThan(0);
    await relaySearchAction(extension, { action: 'nextSearchResult', tabId: fixture.tabId });
    await expect.poll(async () => (await geometry(panel)).marked).toBe('fdt_deep_50');
    // The row lands fully below the band (a 1 px tolerance for subpixel edges).
    await expect
      .poll(async () => {
        const landed = await geometry(panel);
        return (
          landed.stuck === 'Cookies 10 cookies' &&
          landed.bandOffset === 0 &&
          landed.markedTop !== null &&
          landed.bandBottom !== null &&
          landed.markedTop >= landed.bandBottom - 1
        );
      })
      .toBe(true);

    // A one-line row keeps the 36 px row floor (a cookie row's own content is shorter).
    const rowHeight = await panel.evaluate(() => {
      const row = document.querySelector('[data-fdt-inventory-row="cookie"] > div');
      return row === null ? null : row.getBoundingClientRect().height;
    });
    expect(rowHeight).not.toBeNull();
    expect(rowHeight).toBeGreaterThanOrEqual(36);

    // Rows separate by spacing: no list item draws a border.
    const borders = await panel.evaluate(
      () =>
        [...document.querySelectorAll('[data-fdt-inventory-row]')].filter((row) => {
          const style = getComputedStyle(row);
          return style.borderTopWidth !== '0px' || style.borderBottomWidth !== '0px';
        }).length
    );
    expect(borders).toBe(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
