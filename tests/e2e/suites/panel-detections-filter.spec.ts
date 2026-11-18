/**
 * The Detections status filter over a real capture: All optimizations /
 * Active / Inactive chips with counts, only optimization cards narrow (page
 * facts stay), click and keyboard selection, the strip untouched, a real
 * soft refresh keeping the chip — including a refresh that empties the
 * selected bucket (the filtered-empty line and its way back to All, focus
 * on the All chip) — at 320 and 1280 px, both palettes, reduced motion.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Card ids that describe the page, never an optimization (they never narrow). */
const PAGE_FACT_IDS = [
  'wpr',
  'priority_elements_beacon',
  'mobile_cache',
  'server',
  'known-platform',
  'host-layers',
  'cached'
];

/** One chip of the status group. */
function chip(page: Page, id: 'all' | 'active' | 'inactive'): Locator {
  return page.locator(`[data-fdt="detections-controls"] [data-fdt-filter-chip="${id}"]`);
}

/** A chip's visible count, as a number. */
async function chipCount(page: Page, id: 'all' | 'active' | 'inactive'): Promise<number> {
  return Number(await chip(page, id).locator('[data-fdt-filter-count]').textContent());
}

/** The rendered card ids, in DOM order. */
function cardIds(page: Page): Promise<string[]> {
  return page.evaluate((): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')].map(
      (el) => el.dataset.fdtCardId ?? ''
    )
  );
}

/** The rendered page-fact card ids. */
async function pageFacts(page: Page): Promise<string[]> {
  return (await cardIds(page)).filter((id) => PAGE_FACT_IDS.includes(id));
}

/** The panel status strip's text (the refresh's observable). */
function stripText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null =>
      document.querySelector('[data-fdt="panel-status-bar"]')?.textContent ?? null
  );
}

/** Wait until the soft refresh landed the page whose strip contains `text`. */
async function awaitStrip(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => await stripText(page), { timeout: 15_000, intervals: [50, 100, 250] })
    .toContain(text);
}

/** Whether the document scrolls sideways (the 320 px rule). */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    (): boolean => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`filters a real capture and keeps the chip across soft refreshes (${colorScheme})`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      const group = root.getByRole('group', { name: 'Optimization status' });
      await expect(group).toBeVisible();
      await awaitStrip(panel, 'WP Rocket 3.20.1');
      const headline = root.locator('[data-fdt-summary-headline]');
      const headlineText = await headline.textContent();

      // Counts cover the optimization cards only, and add up.
      const all = await chipCount(panel, 'all');
      const active = await chipCount(panel, 'active');
      const inactive = await chipCount(panel, 'inactive');
      expect(active).toBeGreaterThan(0);
      expect(active + inactive).toBe(all);
      expect(headlineText).toContain(`${String(active)} of ${String(all)}`);
      await expect(chip(panel, 'all')).toHaveAttribute('aria-pressed', 'true');
      const everyCard = await cardIds(panel);
      const facts = await pageFacts(panel);
      expect(facts).toContain('wpr');
      expect(everyCard.length).toBe(all + facts.length);

      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        // Click: Active keeps the page facts and drops the inactive cards.
        await chip(panel, 'active').click();
        await expect(chip(panel, 'active')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await cardIds(panel)).length).toBe(active + facts.length);
        expect(await pageFacts(panel)).toEqual(facts);
        await expect(headline).toHaveText(headlineText ?? '');
        expect(await scrollsSideways(panel)).toBe(false);

        // Keyboard: Tab to the next chip, Space selects Inactive, Enter selects All.
        await chip(panel, 'active').focus();
        await panel.keyboard.press('Tab');
        await expect(chip(panel, 'inactive')).toBeFocused();
        await panel.keyboard.press('Space');
        await expect(chip(panel, 'inactive')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await cardIds(panel)).length).toBe(inactive + facts.length);
        expect(await pageFacts(panel)).toEqual(facts);
        await chip(panel, 'all').focus();
        await panel.keyboard.press('Enter');
        await expect(chip(panel, 'all')).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => await cardIds(panel)).toEqual(everyCard);
      }

      // A real soft refresh onto a page with no active optimization keeps
      // Active selected and says so; the page facts stay.
      await chip(panel, 'active').click();
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'Not detected');
      await expect(chip(panel, 'active')).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(panel, 'active')).toBeEnabled();
      const empty = root.locator('[data-fdt="detections-filtered-empty"]');
      await expect(empty).toContainText('"Active"');
      expect(await pageFacts(panel)).toContain('wpr');
      expect((await cardIds(panel)).every((id) => PAGE_FACT_IDS.includes(id))).toBe(true);

      // Back onto the plugin page: the chip held, the empty line is gone.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/markers.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'WP Rocket 3.20.1');
      await expect(chip(panel, 'active')).toHaveAttribute('aria-pressed', 'true');
      await expect(empty).toHaveCount(0);
      await expect.poll(async () => (await cardIds(panel)).length).toBe(active + facts.length);

      // Emptied again, the way back restores All and lands focus on its chip.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'Not detected');
      const back = empty.getByRole('button', { name: 'Show all optimizations' });
      await back.focus();
      await panel.keyboard.press('Enter');
      await expect(chip(panel, 'all')).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(panel, 'all')).toBeFocused();
      await expect(empty).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
