/**
 * The LCP & Vitals page over a real page: the panel asks the
 * fixture tab for its LCP facts and this visit's vitals and renders them —
 * the hero image as the LCP after the heading's text candidate, the four
 * parts summing to the total, the vitals read on open (LCP measured, INP
 * after a real click + Refresh); the opt-in frame appears on the page and
 * leaves after its 5 s, and an element that left the page reads
 * "unavailable". The page is screenshotted in both palettes at the compact
 * floor and a wide size (no horizontal overflow at either).
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The frame's host element on the inspected page. */
const HIGHLIGHT_HOST = 'wpr-fdt-lcp-highlight';

/** Open the LCP & Vitals route and wait for the vitals' first read. */
async function openPage(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    location.hash = '#/lcp-vitals';
  });
  await expect(panel.getByRole('heading', { level: 1, name: 'LCP & Vitals' })).toBeVisible();
  await expect(panel.locator('[data-fdt-vital="lcp"]')).toBeVisible();
}

/**
 * Toggle a switch the way a pointer does: its track (the input is visually hidden).
 *
 * @param panel The panel page.
 * @param name The switch's label.
 */
async function toggle(panel: Page, name: string): Promise<void> {
  const id = await panel.getByRole('switch', { name }).getAttribute('id');
  if (id === null) throw new Error(`The ${name} switch has no id`);
  await panel.locator(`[id="${id.replace(/-input$/, '-control')}"]`).click();
}

/** Parse a shown `1,234 ms` value. */
function ms(text: string | null): number {
  const match = /([\d,]+) ms/.exec(text ?? '');
  if (match === null) throw new Error(`no ms value in ${String(text)}`);
  return Number(match[1]?.replaceAll(',', ''));
}

test('analyses the LCP and reads this visit’s vitals on a real page', async ({
  extension
}, info) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/lcp/hero.html');
  try {
    await openPage(panel);
    await expect(panel.locator('[data-fdt-vital="lcp"]')).toHaveAttribute(
      'data-fdt-vital-state',
      'measured'
    );
    const outcome = panel.locator('[data-fdt="lcp-outcome"]');

    await panel.locator('[data-fdt-lcp-analyse]').click();
    await expect(outcome).toHaveAttribute('data-fdt-lcp-outcome', 'analysed');
    await expect(outcome).toContainText(/LCP at [\d,]+ ms/);
    const candidates = panel.locator('[data-fdt-lcp-candidate]');
    const last = candidates.last();
    await expect(last).toContainText('img#hero.hero.wide');
    await expect(last).toContainText('/lcp/hero.png');
    await expect(last).toContainText('LCP');
    // The four parts add up to the total (each shown rounded: allow 2 ms).
    const parts = await panel.locator('[data-fdt-lcp-part]').allTextContents();
    expect(parts).toHaveLength(4);
    const total = ms(await panel.locator('[data-fdt-lcp-total]').textContent());
    const sum = parts.reduce((acc, text) => acc + ms(text), 0);
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(2);
    // The image came from this server: its download timing was found (no note).
    await expect(outcome).not.toContainText('kept no download timing');

    // The frame: asked, shown on the page, gone after its 5 s.
    await toggle(panel, 'Frame the LCP element on the page (5 s)');
    await panel.locator('[data-fdt-lcp-analyse]').click();
    await expect(outcome).toContainText(
      'The LCP element was framed on the page for 5 s when this analysis ran.'
    );
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(1);
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(0, { timeout: 8_000 });

    // A real interaction, then Refresh: INP is measured from it.
    // (The entry reaches the page's observer a frame or so later: refresh until it lands.)
    await fixture.page.locator('#act').click();
    const inp = panel.locator('[data-fdt-vital="inp"]');
    await expect(async () => {
      await panel.locator('[data-fdt-vitals-refresh]').click();
      await expect(inp).toHaveAttribute('data-fdt-vital-state', 'measured', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    await expect(inp).toContainText(/From \d+ interactions?\./);

    for (const scheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 900 });
        const overflow = await panel
          .locator('[data-fdt="panel-content"]')
          .evaluate((element) => element.scrollWidth - element.clientWidth);
        expect(overflow, `horizontal overflow at ${String(width)} px (${scheme})`).toBe(0);
        await info.attach(`lcp-vitals-${scheme}-${String(width)}`, {
          body: await panel.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
      }
    }

    // The LCP element leaves the page: a framed analysis reads unavailable.
    await fixture.page.evaluate(() => document.getElementById('hero')?.remove());
    await panel.locator('[data-fdt-lcp-analyse]').click();
    await expect(outcome).toContainText("Couldn't frame the LCP element");
    await expect(candidates.last()).toContainText('Element no longer on the page');
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
