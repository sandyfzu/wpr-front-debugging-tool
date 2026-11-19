/**
 * The calm list's master–detail on the JavaScript page, in the real browser:
 * a side pane from 830 px of list content on (click / Enter open, ↑/↓ step,
 * Esc closes), a drill-in view below it (Back focused, "n of m", held ends,
 * Back / Esc restore the row in view and focus it), selections that survive
 * a soft refresh and a resize across the split width, a removed row named
 * as gone, a search typed over a live find listing (and opening) its own
 * match — clearing it keeps the pane, no running motion under reduced motion, and no horizontal scroll
 * at the UI bar's widths in either layout.
 *
 * The fixture is generated per run (never committed): {@link ROW_COUNT}
 * delayed external scripts `md-NN.js` (never fetched), enough rows to
 * scroll. A refresh is the real one: the fixture tab reloads with a changed
 * script list and the content script's push refetches in place.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import {
  facetCount,
  openScriptDetail,
  scriptDetail,
  scriptRowNamed
} from '../helpers/javascript-page';
import { openPanelForFixture, relaySearchAction, type InspectedPanel } from '../helpers/panel-data';

/** The fixture path (served by the route below). */
const FIXTURE_PATH = '/pipeline/master-detail.html';

/** Scripts on the default fixture. */
const ROW_COUNT = 32;

/** A viewport whose list content is ≥ 830 px (the pane layout). */
const PANE_WIDTH = 1280;

/** A viewport whose list content is < 830 px but not compact (the drill layout). */
const DRILL_WIDTH = 760;

/**
 * A script's row name.
 *
 * @param index The script's position (0-based).
 */
function scriptName(index: number): string {
  return `md-${String(index).padStart(2, '0')}.js`;
}

/**
 * The fixture page: one delayed external script per index.
 *
 * @param indexes The scripts' indexes, in page order.
 * @returns The document.
 */
function masterDetailPage(indexes: readonly number[]): string {
  const scripts = indexes
    .map(
      (index) =>
        `<script type="rocketlazyloadscript" data-rocket-src="https://example.test/${scriptName(index)}"></script>`
    )
    .join('');
  return `<!doctype html><html lang="en"><head><title>Master–detail</title></head>
    <body><h1>Master–detail</h1>${scripts}</body></html>`;
}

/** Indexes 0…n-1. */
function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

/** The script list the next fixture load serves (tests change it, then reload). */
let served: readonly number[] = range(ROW_COUNT);

/** The JavaScript page root. */
function jsPage(panel: Page): Locator {
  return panel.locator('[data-fdt-page="javascript"]');
}

/** A row's open button (the row's one focus stop). */
function rowOpen(panel: Page, index: number): Locator {
  return scriptRowNamed(jsPage(panel), scriptName(index)).locator('[data-fdt-row-open]');
}

/** The calm list root (`data-fdt-layout`). */
function calmList(panel: Page): Locator {
  return jsPage(panel).locator('[data-fdt="calm-list"]');
}

/** The open detail's title. */
function detailTitle(panel: Page): Locator {
  return scriptDetail(panel).locator('[data-fdt="detail-title"]');
}

/** The rows' scroller. */
function scroller(panel: Page): Locator {
  return jsPage(panel).locator('[data-fdt="virtual-list"]');
}

/**
 * Open the JavaScript page on the fixture at a viewport width, booted into
 * reduced motion (state changes settle at once).
 *
 * @param extension The extension driver.
 * @param width The viewport width.
 */
async function openMasterDetail(
  extension: Parameters<typeof openPanelForFixture>[0],
  width: number
): Promise<InspectedPanel> {
  const opened = await openPanelForFixture(extension, FIXTURE_PATH, {
    bootHash: '#/javascript',
    emulation: { colorScheme: 'dark', reducedMotion: 'reduce' }
  });
  await opened.panel.setViewportSize({ width, height: 800 });
  await expect(facetCount(jsPage(opened.panel), 'any', 'Delay')).toHaveText(String(served.length));
  // The boot's own state changes settle (reduced motion runs each as a
  // near-zero transition that can stay pending for a frame or two).
  await expect.poll(() => runningAnimations(opened.panel)).toEqual([]);
  return opened;
}

/**
 * Reload the fixture tab with a new script list and wait for the panel's
 * in-place refresh to land (the Delay facet's total follows the page).
 *
 * @param opened The panel and fixture pages.
 * @param indexes The scripts the reloaded page serves.
 */
async function softRefresh(opened: InspectedPanel, indexes: readonly number[]): Promise<void> {
  served = indexes;
  await opened.fixture.page.reload({ waitUntil: 'load' });
  // The summary's total (outside the list, readable while the drill covers it).
  await expect(jsPage(opened.panel).locator('[data-fdt="script-total"]')).toHaveText(
    `${String(indexes.length)} scripts`
  );
}

/** Whether focus sits on the page body (nothing meaningful holds it). */
function focusOnBody(panel: Page): Promise<boolean> {
  return panel.evaluate(
    () => document.activeElement === null || document.activeElement === document.body
  );
}

/**
 * The running animations in the JavaScript page after two frames — long
 * enough for reduced motion's near-zero durations to finish, far shorter
 * than any full-motion entrance (the pane's slide runs for the base motion
 * token, so without reduced motion this lists its opacity + translate).
 *
 * @param panel The panel page.
 * @returns Each running animation's name (transition property or keyframes).
 */
function runningAnimations(panel: Page): Promise<string[]> {
  return panel.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const root = document.querySelector('[data-fdt-page="javascript"]');
            const running = (root?.getAnimations({ subtree: true }) ?? []).filter(
              (animation) => animation.playState === 'running'
            );
            resolve(
              running.map((animation) =>
                animation instanceof CSSTransition
                  ? animation.transitionProperty
                  : animation instanceof CSSAnimation
                    ? animation.animationName
                    : animation.id
              )
            );
          });
        });
      })
  );
}

test.beforeEach(async ({ extension }) => {
  served = range(ROW_COUNT);
  await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: masterDetailPage(served) });
  });
});

test.afterEach(async ({ extension }) => {
  await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
});

test('from 830 px of content the pane opens beside the list: click and Enter open, ↑/↓ step, Esc closes onto the row', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'pane');
    const width = await calmList(panel).evaluate(
      (element) => element.getBoundingClientRect().width
    );
    expect(width).toBeGreaterThanOrEqual(830);
    // Click: the pane beside the rows (the list stays visible).
    await rowOpen(panel, 2).click();
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    await expect(detailTitle(panel)).toHaveText(scriptName(2));
    await expect(scroller(panel)).toBeVisible();
    // Enter on another row opens it.
    await rowOpen(panel, 4).focus();
    await panel.keyboard.press('Enter');
    await expect(detailTitle(panel)).toHaveText(scriptName(4));
    await expect(rowOpen(panel, 4)).toHaveAttribute('aria-current', 'true');
    // ↓ / ↑ open the neighbor and move focus with the selection.
    await panel.keyboard.press('ArrowDown');
    await expect(detailTitle(panel)).toHaveText(scriptName(5));
    await expect(rowOpen(panel, 5)).toBeFocused();
    await expect(rowOpen(panel, 5)).toHaveAttribute('aria-current', 'true');
    await expect(rowOpen(panel, 4)).not.toHaveAttribute('aria-current', 'true');
    await panel.keyboard.press('ArrowUp');
    await panel.keyboard.press('ArrowUp');
    await expect(detailTitle(panel)).toHaveText(scriptName(3));
    await expect(rowOpen(panel, 3)).toBeFocused();
    // Esc on the row closes the pane; focus stays on the row.
    await panel.keyboard.press('Escape');
    await expect(scriptDetail(panel)).toHaveCount(0);
    await expect(rowOpen(panel, 3)).toBeFocused();
    // Esc inside the pane closes it and hands focus back to the row.
    await rowOpen(panel, 6).click();
    await panel.locator('[data-fdt="detail-close"]').focus();
    await panel.keyboard.press('Escape');
    await expect(scriptDetail(panel)).toHaveCount(0);
    await expect(rowOpen(panel, 6)).toBeFocused();
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('below 830 px the detail drills in: Back focused, "n of m", steps, and the ends held', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, DRILL_WIDTH);
  const { panel } = opened;
  try {
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'drill');
    const drill = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(0)));
    await expect(drill).toHaveAttribute('data-fdt', 'drill-detail');
    await expect(drill.locator('[data-fdt="drill-back"]')).toBeFocused();
    // The list is replaced: covered and inert while the drill shows.
    await expect(jsPage(panel).locator('[data-fdt="calm-list-view"]')).toHaveAttribute('inert', '');
    const position = drill.locator('[data-fdt="drill-position"]');
    await expect(position).toHaveText(`1 of ${String(ROW_COUNT)}`);
    const previous = drill.locator('[data-fdt="drill-previous"]');
    const next = drill.locator('[data-fdt="drill-next"]');
    await expect(previous).toHaveAttribute('aria-disabled', 'true');
    // A held arrow is still a focus stop: Enter on it changes nothing.
    await previous.focus();
    await panel.keyboard.press('Enter');
    await expect(detailTitle(panel)).toHaveText(scriptName(0));
    await expect(previous).toBeFocused();
    await next.click();
    await expect(detailTitle(panel)).toHaveText(scriptName(1));
    await expect(position).toHaveText(`2 of ${String(ROW_COUNT)}`);
    await expect(previous).not.toHaveAttribute('aria-disabled');
    await previous.click();
    await expect(position).toHaveText(`1 of ${String(ROW_COUNT)}`);
    // The far end: a search narrows to the last two rows; m follows it.
    await drill.locator('[data-fdt="drill-back"]').click();
    await jsPage(panel).locator('input[type="search"]').fill('md-3');
    await expect(scriptRowNamed(jsPage(panel), scriptName(31))).toBeVisible();
    const last = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(30)));
    await last.locator('[data-fdt="drill-next"]').click();
    await expect(detailTitle(panel)).toHaveText(scriptName(31));
    await expect(last.locator('[data-fdt="drill-position"]')).toHaveText('2 of 2');
    const held = last.locator('[data-fdt="drill-next"]');
    await expect(held).toHaveAttribute('aria-disabled', 'true');
    await held.focus();
    await panel.keyboard.press('Enter');
    // Held: same row, focus kept on the arrow.
    await expect(detailTitle(panel)).toHaveText(scriptName(31));
    await expect(held).toBeFocused();
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('Back and Esc restore the list with the row in view at the same scroll, focused', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, DRILL_WIDTH);
  const { panel } = opened;
  try {
    // Scroll part-way, then pick a row fully inside the window.
    await scroller(panel).evaluate((element) => {
      element.scrollTop = 150;
    });
    await expect.poll(() => scroller(panel).evaluate((element) => element.scrollTop)).toBe(150);
    const index = await scroller(panel).evaluate((list) => {
      const box = list.getBoundingClientRect();
      const row = [...list.querySelectorAll('[data-fdt="script-row"]')].find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.top >= box.top && rect.bottom <= box.bottom;
      });
      const name = row?.querySelector('[data-fdt="list-row-name"]')?.textContent ?? '';
      return Number(/md-(\d+)\.js/u.exec(name)?.[1] ?? Number.NaN);
    });
    expect(Number.isInteger(index)).toBe(true);
    for (const leave of ['back', 'escape'] as const) {
      const drill = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(index)));
      if (leave === 'back') await drill.locator('[data-fdt="drill-back"]').click();
      else await panel.keyboard.press('Escape');
      await expect(scriptDetail(panel)).toHaveCount(0);
      await expect(scroller(panel)).toBeVisible();
      await expect(rowOpen(panel, index)).toBeFocused();
      // The row was in view: the list did not move.
      expect(await scroller(panel).evaluate((element) => element.scrollTop)).toBe(150);
      // The list's re-entry keyframe settles before the next pass clicks: its
      // first frame (reduced motion collapses it to that one frame) still
      // offsets the rows by its `from` translate, and Playwright retries a
      // click on a moving target with a forced `block: 'end'` scroll — which
      // would move this list itself (to 0 for a row near the top).
      await expect.poll(() => runningAnimations(panel)).toEqual([]);
    }
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('a search typed over a live find lists its own match at an equal count; clearing it keeps the pane', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  const status = jsPage(panel).locator('[data-fdt="resource-results-status"]');
  const rows = jsPage(panel).locator('[data-fdt="script-row"]');
  try {
    // The DevTools find: one match.
    await relaySearchAction(extension, {
      action: 'performSearch',
      query: scriptName(19),
      tabId: opened.fixture.tabId
    });
    await expect(rows).toHaveCount(1);
    await expect(rows.locator('[data-fdt="list-row-name"]')).toHaveText(scriptName(19));
    // Typed over it: one match again, and it is the typed script's row.
    const search = jsPage(panel).locator('input[type="search"]');
    await search.fill(scriptName(7));
    await expect(rows.locator('[data-fdt="list-row-name"]')).toHaveText(scriptName(7));
    await expect(status).toHaveText(`Showing 1 of ${String(ROW_COUNT)} scripts`);
    await openScriptDetail(panel, rows);
    await expect(detailTitle(panel)).toHaveText(scriptName(7));
    // Cleared: every row back, the pane still on the typed row.
    await search.fill('');
    await expect(status).toHaveText(`Showing all ${String(ROW_COUNT)} scripts`);
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    await expect(detailTitle(panel)).toHaveText(scriptName(7));
    await expect(rowOpen(panel, 7)).toHaveAttribute('aria-current', 'true');
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('a soft refresh keeps the selection open, in the pane and in the drill', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(5)));
    // A new script lands above the selection.
    await softRefresh(opened, [ROW_COUNT, ...range(ROW_COUNT)]);
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    await expect(detailTitle(panel)).toHaveText(scriptName(5));
    await expect(rowOpen(panel, 5)).toHaveAttribute('aria-current', 'true');

    await panel.setViewportSize({ width: DRILL_WIDTH, height: 800 });
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'drill');
    const drill = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(7)));
    await expect(drill.locator('[data-fdt="drill-position"]')).toHaveText(
      `9 of ${String(ROW_COUNT + 1)}`
    );
    await softRefresh(opened, [ROW_COUNT + 1, ROW_COUNT, ...range(ROW_COUNT)]);
    await expect(panel.locator('[data-fdt="drill-detail"]')).toBeVisible();
    await expect(detailTitle(panel)).toHaveText(scriptName(7));
    // Same row, its new place in the list.
    await expect(drill.locator('[data-fdt="drill-position"]')).toHaveText(
      `10 of ${String(ROW_COUNT + 2)}`
    );
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('a refresh that drops the selected script says "No longer on the page", in the pane and in the drill', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(10)));
    await softRefresh(
      opened,
      range(ROW_COUNT).filter((index) => index !== 10)
    );
    const pane = panel.locator('[data-fdt="detail-pane"]');
    await expect(pane.locator('[data-fdt="detail-gone"]')).toContainText('No longer on the page');
    // Never a silent jump to another row: the title still names the script.
    await expect(detailTitle(panel)).toHaveText(scriptName(10));

    await softRefresh(opened, range(ROW_COUNT));
    await panel.setViewportSize({ width: DRILL_WIDTH, height: 800 });
    const drill = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(12)));
    await softRefresh(
      opened,
      range(ROW_COUNT).filter((index) => index !== 12)
    );
    await expect(drill.locator('[data-fdt="detail-gone"]')).toContainText('No longer on the page');
    await expect(detailTitle(panel)).toHaveText(scriptName(12));
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('resizing across 830 px keeps the selected row, and focus never drops to the body', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    // Pane → narrower: the selection stays, on its row in the list.
    await rowOpen(panel, 4).focus();
    await panel.keyboard.press('Enter');
    await expect(detailTitle(panel)).toHaveText(scriptName(4));
    await panel.setViewportSize({ width: DRILL_WIDTH, height: 800 });
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'drill');
    await expect(scriptRowNamed(jsPage(panel), scriptName(4))).toHaveAttribute('data-selected', '');
    expect(await focusOnBody(panel)).toBe(false);
    // Drill detail → wider: the pane shows the same row; focus lands on its row.
    const drill = await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(4)));
    await expect(drill.locator('[data-fdt="drill-back"]')).toBeFocused();
    await panel.setViewportSize({ width: PANE_WIDTH, height: 800 });
    await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', 'pane');
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    await expect(detailTitle(panel)).toHaveText(scriptName(4));
    await expect(rowOpen(panel, 4)).toBeFocused();
    expect(await focusOnBody(panel)).toBe(false);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('under reduced motion nothing runs once the pane or the drill has opened', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    await rowOpen(panel, 1).click();
    await expect(panel.locator('[data-fdt="detail-pane"]')).toBeVisible();
    expect(await runningAnimations(panel)).toEqual([]);
    await panel.locator('[data-fdt="detail-close"]').click();
    await panel.setViewportSize({ width: DRILL_WIDTH, height: 800 });
    await rowOpen(panel, 1).click();
    await expect(panel.locator('[data-fdt="drill-detail"]')).toBeVisible();
    expect(await runningAnimations(panel)).toEqual([]);
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});

test('no horizontal scroll with the pane open or in the drill at 320–1280 px, docked right or bottom', async ({
  extension
}) => {
  const opened = await openMasterDetail(extension, PANE_WIDTH);
  const { panel } = opened;
  try {
    await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(3)));
    for (const height of [800, 360]) {
      for (const width of [320, 420, 480, 760, 1100, 1280]) {
        await panel.setViewportSize({ width, height });
        const layout = width >= 1100 ? 'pane' : 'drill';
        await expect(calmList(panel)).toHaveAttribute('data-fdt-layout', layout);
        // The drill shows once the row is opened again in it.
        if (layout === 'drill' && (await scriptDetail(panel).count()) === 0)
          await openScriptDetail(panel, scriptRowNamed(jsPage(panel), scriptName(3)));
        await expect(
          panel.locator(
            layout === 'pane' ? '[data-fdt="detail-pane"]' : '[data-fdt="drill-detail"]'
          )
        ).toBeVisible();
        const overflow = await panel.evaluate(() => {
          const sides = (element: Element | null): number =>
            element === null ? 0 : element.scrollWidth - element.clientWidth;
          return {
            document: sides(document.documentElement),
            content: sides(document.querySelector('[data-fdt="panel-content"]')),
            page: sides(document.querySelector('[data-fdt-page="javascript"]')),
            detail: sides(
              document.querySelector('[data-fdt="detail-pane"], [data-fdt="drill-body"]')
            )
          };
        });
        expect(overflow, `${String(width)}×${String(height)} (${layout})`).toEqual({
          document: 0,
          content: 0,
          page: 0,
          detail: 0
        });
      }
    }
  } finally {
    await opened.panel.close();
    await opened.fixture.page.close();
  }
});
