/**
 * The Detections layout modes over a real capture: the control absent at
 * 320 px (Grouped there whatever the choice: one column of groups; a List
 * choice applies again at 1280), the WP Rocket tile shown at 320, Grouped at 1280 in two
 * columns of headed sections with the tiles' facts left to the tiles, List
 * one bounded column of calm rows (every row, page facts included), Cards a
 * multi-column grid of bordered cards — no entry lifts on hover in any
 * layout (an entry is no control; its page link is) — radio keyboard
 * (arrows, Space), the filter kept across a switch, and a real soft refresh
 * plus a route round-trip keeping the mode — at 320, 480, 768 and 1280 px
 * with no sideways scroll, both palettes, reduced motion (no running
 * animation after a switch).
 */
import type { Locator, Page } from '@playwright/test';
import { placementOf } from '../../../lib/panel/detections-groups';
import type { StatusItemId } from '../../../lib/panel/detections-view-model';
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The shared reading width the List column is bounded to (`max-w-4xl`, 56 rem). */
const LIST_MAX_WIDTH = 896;

/** A layout id. */
type Layout = 'grouped' | 'list' | 'cards';

/** One layout radio's hidden input. */
function radio(page: Page, value: Layout): Locator {
  return page.locator(`[data-fdt="detections-controls"] input[type="radio"][value="${value}"]`);
}

/** The distinct left edges of a selector's boxes (one per column), and the grid's width. */
function geometry(
  page: Page,
  selector = '[data-fdt="status-card"]'
): Promise<{ lefts: number[]; gridWidth: number }> {
  return page.evaluate((target: string) => {
    const boxes = [...document.querySelectorAll<HTMLElement>(target)];
    const grid = document.querySelector<HTMLElement>('[data-fdt="detections-grid"]');
    return {
      lefts: [...new Set(boxes.map((el) => Math.round(el.getBoundingClientRect().left)))],
      gridWidth: grid?.getBoundingClientRect().width ?? 0
    };
  }, selector);
}

/** One entry's computed chrome. */
function chrome(
  card: Locator
): Promise<{ border: string; radius: string; shadow: string; paddingLeft: string }> {
  return card.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      border: style.borderTopWidth,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      paddingLeft: style.paddingLeft
    };
  });
}

/** The rendered entry ids, in DOM order. */
function cardIds(page: Page): Promise<string[]> {
  return page.evaluate((): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')].map(
      (el) => el.dataset.fdtCardId ?? ''
    )
  );
}

/** Ids without the rows the overview tiles state (Grouped leaves those to the tiles). */
const withoutTiles = (ids: readonly string[]): string[] =>
  ids.filter((id) => placementOf(id as StatusItemId) !== 'tile').sort();

/** Whether the document scrolls sideways (the 320 px rule). */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    (): boolean => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

/** Wait until the soft refresh landed the page whose top bar contains `text`. */
async function awaitStrip(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
        ),
      { timeout: 15_000, intervals: [50, 100, 250] }
    )
    .toContain(text);
}

/**
 * Assert no sideways scroll at every D-1 width in the current layout.
 *
 * @param page The panel.
 * @param label The layout's name (the failure message).
 */
async function assertNoSidewaysScroll(page: Page, label: string): Promise<void> {
  for (const width of [320, 480, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect
      .poll(async () => await scrollsSideways(page), `${label} at ${String(width)} px`)
      .toBe(false);
  }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`switches Grouped / List / Cards over a real capture and keeps the mode (${colorScheme})`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/javascript/chips.html', {
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      const group = root.getByRole('radiogroup', { name: 'Detection layout' });
      const grid = root.locator('[data-fdt="detections-grid"]');
      const filterActive = root.locator(
        '[data-fdt="detections-filter"] input[type="radio"][value="active"]'
      );
      const filterAll = root.locator(
        '[data-fdt="detections-filter"] input[type="radio"][value="all"]'
      );
      /** A row with a page link (Delay JS, an active feature on this fixture). */
      const linked = root.locator('[data-fdt="status-card"][data-fdt-card-id="delay_js"]');
      /** The score ring's rendered side (px): it follows the page container's tier. */
      const ringSide = (): Promise<number> =>
        root
          .locator('[data-fdt="score-ring"]')
          .evaluate((el) => Math.round(el.getBoundingClientRect().width));
      /** How many document animations are still running (reduced motion: none should linger). */
      const runningAnimations = (): Promise<number> =>
        panel.evaluate(
          () =>
            document.getAnimations().filter((animation) => animation.playState === 'running').length
        );
      await awaitStrip(panel, 'WP Rocket 3.24');

      // Compact: no control, Grouped as one column of sections, no sideways scroll.
      await panel.setViewportSize({ width: 320, height: 800 });
      await expect(group).toBeHidden();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'grouped');
      await expect.poll(async () => await scrollsSideways(panel)).toBe(false);
      // Polled: container queries settle a frame after the resize.
      await expect.poll(ringSide, 'ring at compact').toBe(44);
      await expect
        .poll(async () => (await geometry(panel, '[data-fdt="detections-group"]')).lefts)
        .toHaveLength(1);
      // The WP Rocket tile stays at compact (the one place with the full version), inside the panel.
      const wprTile = root.locator('[data-fdt-overview-tile="wpr"]');
      await expect(wprTile).toBeVisible();
      await expect(wprTile).toContainText('3.24');
      await expect
        .poll(async () =>
          wprTile.evaluate((el) => Math.ceil(el.getBoundingClientRect().right) <= innerWidth)
        )
        .toBe(true);

      // Wide Grouped: headed sections in two columns; the tiles' facts are no rows.
      await panel.setViewportSize({ width: 1280, height: 800 });
      await expect(group).toBeVisible();
      await expect(radio(panel, 'grouped')).toBeChecked();
      await expect
        .poll(async () => (await geometry(panel, '[data-fdt="detections-group"]')).lefts)
        .toHaveLength(2);
      await expect.poll(ringSide, 'ring from regular up').toBe(52);
      await expect(root.locator('[data-fdt="detections-group"] h2').first()).toHaveText(
        'JavaScript & CSS'
      );
      expect(await cardIds(panel)).not.toContain('wpr');
      // A calm row: no border, the 14 px inline padding, never a lift on hover.
      const row = await chrome(linked);
      expect(row.border).toBe('0px');
      expect(row.paddingLeft).toBe('14px');
      await linked.hover();
      await expect.poll(runningAnimations).toBe(0);
      expect((await chrome(linked)).shadow).toBe('none');
      await expect(linked.locator('a[data-fdt-card-link]')).toHaveAttribute('href', '#/javascript');

      // Filter first, so the switches are seen keeping it.
      await root
        .locator('[data-fdt="detections-filter"] [data-fdt-choice-value="active"] label')
        .click();
      await expect(filterActive).toBeChecked();
      const groupedIds = await cardIds(panel);

      // Keyboard: an arrow moves the choice to List; the filter holds.
      await radio(panel, 'grouped').focus();
      await panel.keyboard.press('ArrowRight');
      await expect(radio(panel, 'list')).toBeChecked();
      await expect(radio(panel, 'list')).toBeFocused();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'list');
      await expect(filterActive).toBeChecked();
      // List adds back only the rows the tiles state.
      expect(withoutTiles(await cardIds(panel))).toEqual(withoutTiles(groupedIds));
      expect(await cardIds(panel)).toContain('wpr');
      await filterAll.focus();
      await panel.keyboard.press('Space');
      await expect(filterAll).toBeChecked();

      // List: one bounded column of calm rows, no chrome, no lift on hover.
      await expect.poll(async () => (await geometry(panel)).lefts).toHaveLength(1);
      const wide = await geometry(panel);
      expect(wide.gridWidth).toBeLessThanOrEqual(LIST_MAX_WIDTH);
      const resting = await chrome(linked);
      expect(resting.border).toBe('0px');
      expect(resting.paddingLeft).toBe('14px');
      await linked.hover();
      await expect.poll(runningAnimations).toBe(0);
      expect((await chrome(linked)).shadow).toBe('none');
      // The overview keeps the page canvas (wider than the list column).
      const overviewWidth = await root
        .locator('[data-fdt="detections-summary"]')
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(overviewWidth).toBeGreaterThan(wide.gridWidth);

      // Cards: a multi-column grid of raised cards (the `Card` look: border +
      // resting shadow), still no lift — hover never changes the shadow.
      await radio(panel, 'list').focus();
      await panel.keyboard.press('ArrowRight');
      await expect(radio(panel, 'cards')).toBeChecked();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'cards');
      await expect.poll(async () => (await geometry(panel)).lefts.length).toBeGreaterThan(1);
      await expect.poll(async () => (await chrome(linked)).border).toBe('1px');
      await panel.mouse.move(0, 0);
      await expect.poll(runningAnimations).toBe(0);
      const restingCard = await chrome(linked);
      expect(restingCard.shadow).not.toBe('none');
      await linked.hover();
      await expect.poll(runningAnimations).toBe(0);
      expect((await chrome(linked)).shadow).toBe(restingCard.shadow);

      // Arrow back (from the checked radio), then Space on a focused unchecked one.
      await panel.keyboard.press('ArrowLeft');
      await expect(radio(panel, 'list')).toBeChecked();
      await radio(panel, 'cards').focus();
      await panel.keyboard.press('Space');
      await expect(radio(panel, 'cards')).toBeChecked();
      await radio(panel, 'list').focus();
      await panel.keyboard.press('Space');
      await expect(radio(panel, 'list')).toBeChecked();
      // Reduced motion: a switch's class swap may start a color transition,
      // collapsed by the media rule (≤ 1 ms) and never left running.
      expect(
        await panel.evaluate(() =>
          document
            .getAnimations()
            .every((animation) => Number(animation.effect?.getComputedTiming().duration) <= 1)
        )
      ).toBe(true);
      await expect.poll(runningAnimations).toBe(0);

      await assertNoSidewaysScroll(panel, 'List');
      await panel.setViewportSize({ width: 768, height: 800 });
      await expect(group).toBeVisible();

      // A real soft refresh keeps List.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'Not detected');
      await expect(radio(panel, 'list')).toBeChecked();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'list');

      // A route round-trip keeps List (the choice is the shell's, not the page's).
      await panel.evaluate(() => {
        location.hash = '#/headers-cookies';
      });
      await expect(root).toHaveCount(0);
      await panel.evaluate(() => {
        location.hash = '#/detections';
      });
      await expect(radio(panel, 'list')).toBeChecked();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'list');

      // Narrow: the control hides and the page renders Grouped; the List choice
      // is kept and applies again once the panel is wide enough (auto-retrying
      // reads: the layout follows a measure taken after the resize).
      await panel.setViewportSize({ width: 320, height: 800 });
      await expect(group).toBeHidden();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'grouped');
      await expect(root.locator('[data-fdt="detections-group"]').first()).toBeVisible();
      await panel.setViewportSize({ width: 1280, height: 800 });
      await expect(grid).toHaveAttribute('data-fdt-layout', 'list');
      await expect(group).toBeVisible();
      await expect(radio(panel, 'list')).toBeChecked();

      // Cards and Grouped again: every width stays free of sideways scroll.
      await radio(panel, 'cards').focus();
      await panel.keyboard.press('Space');
      await expect(grid).toHaveAttribute('data-fdt-layout', 'cards');
      await assertNoSidewaysScroll(panel, 'Cards');
      await panel.setViewportSize({ width: 1280, height: 800 });
      await radio(panel, 'grouped').focus();
      await panel.keyboard.press('Space');
      await expect(grid).toHaveAttribute('data-fdt-layout', 'grouped');
      await assertNoSidewaysScroll(panel, 'Grouped');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
