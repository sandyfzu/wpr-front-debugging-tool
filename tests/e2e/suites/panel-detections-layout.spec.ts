/**
 * The Detections layout modes over a real capture: the control absent at
 * 320 px (both modes paint the same rows there), Adaptive multi-column at
 * 1280 with an active link card lifting on hover, List one bounded column of
 * roomy rows with no card chrome and no lift on that same card,
 * radio keyboard (arrows, Space), the filter kept across a switch, and a
 * real soft refresh plus a route round-trip keeping the mode — at 320, 480,
 * 768 and 1280 px with no sideways scroll, both palettes, reduced motion
 * (no running animation after a switch).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The shared reading width the List column is bounded to (`max-w-4xl`, 56 rem). */
const LIST_MAX_WIDTH = 896;

/** One layout radio's hidden input. */
function radio(page: Page, value: 'adaptive' | 'list'): Locator {
  return page.locator(`[data-fdt="detections-controls"] input[type="radio"][value="${value}"]`);
}

/** The rendered card boxes' left edges and the grid's width. */
function geometry(page: Page): Promise<{ lefts: number[]; gridWidth: number }> {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')];
    const grid = document.querySelector<HTMLElement>('[data-fdt="detections-grid"]');
    return {
      lefts: [...new Set(cards.map((el) => Math.round(el.getBoundingClientRect().left)))],
      gridWidth: grid?.getBoundingClientRect().width ?? 0
    };
  });
}

/** One card's computed chrome (the List rule: none of its own). */
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

/** Whether the document scrolls sideways (the 320 px rule). */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    (): boolean => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

/** Wait until the soft refresh landed the page whose strip contains `text`. */
async function awaitStrip(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => document.querySelector('[data-fdt="panel-status-bar"]')?.textContent ?? null
        ),
      { timeout: 15_000, intervals: [50, 100, 250] }
    )
    .toContain(text);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`switches Adaptive / List over a real capture and keeps the mode (${colorScheme})`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/javascript/chips.html', {
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      const group = root.getByRole('radiogroup', { name: 'Detection layout' });
      const grid = root.locator('[data-fdt="detections-grid"]');
      const link = root.locator('a[data-fdt="status-card"]').first();
      /** How many document animations are still running (reduced motion: none should linger). */
      const runningAnimations = (): Promise<number> =>
        panel.evaluate(
          () =>
            document.getAnimations().filter((animation) => animation.playState === 'running').length
        );
      await awaitStrip(panel, 'WP Rocket 3.24');

      // Compact: no control (it could change nothing), no sideways scroll.
      await panel.setViewportSize({ width: 320, height: 800 });
      await expect(group).toBeHidden();
      expect(await scrollsSideways(panel)).toBe(false);

      // Wide Adaptive: a multi-column card grid, cards with their own chrome.
      await panel.setViewportSize({ width: 1280, height: 800 });
      await expect(group).toBeVisible();
      await expect(radio(panel, 'adaptive')).toBeChecked();
      // Polled: container queries settle a frame after the resize.
      await expect.poll(async () => (await geometry(panel)).lefts.length).toBeGreaterThan(1);
      await expect.poll(async () => (await chrome(link)).border).toBe('1px');

      // Filter first, so the switch is seen keeping it.
      const active = root.locator('[data-fdt-filter-chip="active"]');
      await active.click();
      await expect(active).toHaveAttribute('aria-pressed', 'true');
      const filtered = await root.locator('[data-fdt="status-card"]').count();

      // An active link card (the page's own Active filter says so) lifts on hover.
      const liftId = await root
        .locator('a[data-fdt="status-card"]')
        .first()
        .getAttribute('data-fdt-card-id');
      expect(liftId).not.toBeNull();
      const lifting = root.locator(
        `a[data-fdt="status-card"][data-fdt-card-id="${String(liftId)}"]`
      );
      await lifting.hover();
      await expect.poll(async () => (await chrome(lifting)).shadow).not.toBe('none');

      // Keyboard: an arrow moves the choice to List.
      await radio(panel, 'adaptive').focus();
      await panel.keyboard.press('ArrowRight');
      await expect(radio(panel, 'list')).toBeChecked();
      await expect(radio(panel, 'list')).toBeFocused();
      await expect(grid).toHaveAttribute('data-fdt-layout', 'list');
      await expect(active).toHaveAttribute('aria-pressed', 'true');
      await expect(root.locator('[data-fdt="status-card"]')).toHaveCount(filtered);
      await root.locator('[data-fdt-filter-chip="all"]').click();

      // List: one bounded column of roomy rows with no chrome, no lift on hover.
      await expect.poll(async () => (await geometry(panel)).lefts).toHaveLength(1);
      const wide = await geometry(panel);
      expect(wide.gridWidth).toBeLessThanOrEqual(LIST_MAX_WIDTH);
      const resting = await chrome(link);
      expect(resting.border).toBe('0px');
      expect(resting.radius).toBe('0px');
      expect(resting.paddingLeft).toBe('12px');
      // The card that lifted in Adaptive: hovered, settled, still flat.
      await lifting.hover();
      await expect.poll(runningAnimations).toBe(0);
      expect((await chrome(lifting)).shadow).toBe('none');
      // The strip keeps the page canvas (wider than the list column).
      const stripWidth = await root
        .locator('[data-fdt="detections-summary"]')
        .evaluate((el) => el.getBoundingClientRect().width);
      expect(stripWidth).toBeGreaterThan(wide.gridWidth);

      // Arrow back (from the checked radio), then Space on a focused unchecked one.
      await radio(panel, 'list').focus();
      await panel.keyboard.press('ArrowLeft');
      await expect(radio(panel, 'adaptive')).toBeChecked();
      await radio(panel, 'list').focus();
      await panel.keyboard.press('Space');
      await expect(radio(panel, 'list')).toBeChecked();
      // Reduced motion: a switch's class swap may start a card's color
      // transition, collapsed by the media rule (≤ 1 ms) and never left running.
      expect(
        await panel.evaluate(() =>
          document
            .getAnimations()
            .every((animation) => Number(animation.effect?.getComputedTiming().duration) <= 1)
        )
      ).toBe(true);
      await expect.poll(runningAnimations).toBe(0);

      for (const width of [320, 480, 768, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        await expect
          .poll(async () => await scrollsSideways(panel), `List at ${String(width)} px`)
          .toBe(false);
      }
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

      // Adaptive again: every width stays free of sideways scroll.
      await radio(panel, 'adaptive').focus();
      await panel.keyboard.press('Space');
      await expect(grid).toHaveAttribute('data-fdt-layout', 'adaptive');
      for (const width of [320, 480, 768, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        await expect
          .poll(async () => await scrollsSideways(panel), `Adaptive at ${String(width)} px`)
          .toBe(false);
      }
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
