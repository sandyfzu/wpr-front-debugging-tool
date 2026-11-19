/**
 * The Detections status filter over a real capture (Grouped, the default
 * layout): All / Active / Collecting / Off segments with counts that add up
 * and equal the score tile, only optimization rows narrow (page-context rows
 * stay), click and radio-keyboard selection, the top bar untouched, a real
 * soft refresh keeping the segment — including a refresh that empties the
 * selected bucket (the filtered-empty line and its way back to All, focus
 * on the All segment) — at 320 and 1280 px, both palettes, reduced motion.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Row ids that describe the page, never an optimization (they never narrow). */
const PAGE_FACT_IDS = [
  'wpr',
  'priority_elements_beacon',
  'mobile_cache',
  'server',
  'known-platform',
  'host-layers',
  'cached'
];

/** A status filter id. */
type FilterId = 'all' | 'active' | 'collecting' | 'off';

/** One segment's radio of the status group. */
function segment(page: Page, id: FilterId): Locator {
  return page.locator(`[data-fdt="detections-filter"] input[type="radio"][value="${id}"]`);
}

/** One segment's visible label (what a pointer clicks). */
function segmentLabel(page: Page, id: FilterId): Locator {
  return page.locator(`[data-fdt="detections-filter"] [data-fdt-choice-value="${id}"] label`);
}

/** A segment's visible count, as a number. */
async function segmentCount(page: Page, id: FilterId): Promise<number> {
  return Number(
    await page
      .locator(
        `[data-fdt="detections-filter"] [data-fdt-choice-value="${id}"] [data-fdt-choice-count]`
      )
      .textContent()
  );
}

/** The rendered row ids, in DOM order. */
function cardIds(page: Page): Promise<string[]> {
  return page.evaluate((): string[] =>
    [...document.querySelectorAll<HTMLElement>('[data-fdt="status-card"]')].map(
      (el) => el.dataset.fdtCardId ?? ''
    )
  );
}

/** The rendered page-context row ids. */
async function pageFacts(page: Page): Promise<string[]> {
  return (await cardIds(page)).filter((id) => PAGE_FACT_IDS.includes(id));
}

/** The panel top bar's text (the refresh's observable). */
function barText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null => document.querySelector('[data-fdt="panel-top-bar"]')?.textContent ?? null
  );
}

/** Wait until the soft refresh landed the page whose top bar contains `text`. */
async function awaitStrip(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => await barText(page), { timeout: 15_000, intervals: [50, 100, 250] })
    .toContain(text);
}

/** Whether the document scrolls sideways (the 320 px rule). */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    (): boolean => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`filters a real capture and keeps the segment across soft refreshes (${colorScheme})`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      const group = root.getByRole('radiogroup', { name: 'Optimization status' });
      await expect(group).toBeVisible();
      await awaitStrip(panel, 'WP Rocket 3.20.1');
      const headline = root.locator('[data-fdt-summary-headline]');
      const headlineText = await headline.textContent();

      // Counts cover the optimization rows only, add up, and equal the score tile.
      const all = await segmentCount(panel, 'all');
      const active = await segmentCount(panel, 'active');
      const collecting = await segmentCount(panel, 'collecting');
      const off = await segmentCount(panel, 'off');
      expect(active).toBeGreaterThan(0);
      expect(off).toBeGreaterThan(0);
      expect(active + collecting + off).toBe(all);
      expect(headlineText).toContain(`${String(active)} of ${String(all)}`);
      await expect(segment(panel, 'all')).toBeChecked();
      const everyCard = await cardIds(panel);
      const facts = await pageFacts(panel);
      // The plugin identity is the WP Rocket tile's, the beacon a Features row.
      expect(facts).not.toContain('wpr');
      expect(facts).toContain('priority_elements_beacon');
      await expect(root.locator('[data-fdt-overview-tile="wpr"]')).toBeAttached();
      expect(everyCard.length).toBe(all + facts.length);
      // The bucket right of Active a radio arrow reaches (an empty one is skipped).
      const next: FilterId = collecting > 0 ? 'collecting' : 'off';
      const nextCount = collecting > 0 ? collecting : off;

      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 800 });
        // Click: Active keeps the page facts and drops the other rows.
        await segmentLabel(panel, 'active').click();
        await expect(segment(panel, 'active')).toBeChecked();
        await expect.poll(async () => (await cardIds(panel)).length).toBe(active + facts.length);
        expect(await pageFacts(panel)).toEqual(facts);
        await expect(headline).toHaveText(headlineText ?? '');
        await expect.poll(async () => await scrollsSideways(panel)).toBe(false);

        // Keyboard: an arrow selects the next bucket, Space on a focused All selects it.
        await segment(panel, 'active').focus();
        await panel.keyboard.press('ArrowRight');
        await expect(segment(panel, next)).toBeChecked();
        await expect(segment(panel, next)).toBeFocused();
        await expect.poll(async () => (await cardIds(panel)).length).toBe(nextCount + facts.length);
        expect(await pageFacts(panel)).toEqual(facts);
        await segment(panel, 'all').focus();
        await panel.keyboard.press('Space');
        await expect(segment(panel, 'all')).toBeChecked();
        await expect.poll(async () => await cardIds(panel)).toEqual(everyCard);
      }

      // A real soft refresh onto a page with no active optimization keeps
      // Active selected and says so; the page facts stay.
      await segmentLabel(panel, 'active').click();
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'Not detected');
      await expect(segment(panel, 'active')).toBeChecked();
      await expect(segment(panel, 'active')).toBeEnabled();
      const empty = root.locator('[data-fdt="detections-filtered-empty"]');
      await expect(empty).toContainText('"Active"');
      expect(await pageFacts(panel)).toContain('priority_elements_beacon');
      expect((await cardIds(panel)).every((id) => PAGE_FACT_IDS.includes(id))).toBe(true);

      // Back onto the plugin page: the segment held, the empty line is gone.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/markers.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'WP Rocket 3.20.1');
      await expect(segment(panel, 'active')).toBeChecked();
      await expect(empty).toHaveCount(0);
      await expect.poll(async () => (await cardIds(panel)).length).toBe(active + facts.length);

      // Emptied again, the way back restores All and lands focus on its segment.
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html`, { waitUntil: 'load' });
      await awaitStrip(panel, 'Not detected');
      const back = empty.getByRole('button', { name: 'Show all optimizations' });
      await back.focus();
      await panel.keyboard.press('Enter');
      await expect(segment(panel, 'all')).toBeChecked();
      await expect(segment(panel, 'all')).toBeFocused();
      await expect(empty).toHaveCount(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}
