/**
 * The Exclusion Builder modifier on the real panel's Detections cards, over
 * a page carrying the builder marker (as a rewritten document does): Delay
 * JS off, Defer JS off for the page, LazyLoad rows excluded. Each card keeps
 * WP Rocket's served verdict and adds its modifier badge (icon + words);
 * the summary counts the two turned-off features as inactive. Checked at
 * the panel floor and a wide size, in both palettes, with reduced motion:
 * no horizontal scroll, keyboard reach, strict axe.
 *
 * Set `FDT_SHOTS_DIR` to save a screenshot per palette × width there (the
 * owner's visual receipt; nothing is written otherwise).
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { BUILDER_MARKER_META_NAME } from '../../../lib/wp-rocket/constants';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The accessibility engine, injected into the panel page under test. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The fixture path the route serves the marked page at. */
const FIXTURE_PATH = '/pipeline/builder-modifier.html';

/** A WP Rocket page as the builder's rewrite leaves it: the served declaration plus the marker. */
const MARKED_PAGE = `<!doctype html><html lang="en"><head><title>Builder modifier fixture</title>
<meta name="generator" content="WP Rocket 3.23.5.1" data-wpr-features="wpr_delay_js wpr_defer_js wpr_lazyload_images">
<meta name="${BUILDER_MARKER_META_NAME}" content="v1 delay_js=off defer_all_js=page-off lazyload=excluded:3">
</head><body><h1>Builder modifier fixture</h1>
<img src="/a.gif" data-lazy-src="/real-a.jpg" alt="A"><img src="/b.jpg" alt="B" data-wpr-fdt-excluded="lazyload">
</body></html>`;

/** Each changed card: its id, its modifier kind and the words its badge shows. */
const CASES = [
  { id: 'delay_js', kind: 'off', chip: 'Disabled in this tab' },
  { id: 'defer_all_js', kind: 'off', chip: 'Off on this page' },
  { id: 'lazyload', kind: 'excluded', chip: '3 excluded' }
] as const;

/** Run axe over the panel page; violations and incomplete checks, by rule id. */
async function axeAudit(panel: Page): Promise<unknown> {
  await panel.evaluate(AXE_SOURCE);
  return await panel.evaluate(async () => {
    await document.fonts.ready;
    const axe = (
      window as unknown as {
        axe: {
          run: () => Promise<{ violations: { id: string }[]; incomplete: { id: string }[] }>;
        };
      }
    ).axe;
    const result = await axe.run();
    return {
      violations: result.violations.map((rule) => rule.id),
      incomplete: result.incomplete.map((rule) => rule.id)
    };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`the Detections cards carry the builder modifiers (${colorScheme})`, async ({
    extension
  }) => {
    await extension.browserContext.route(`**${FIXTURE_PATH}*`, async (route) => {
      await route.fulfill({ contentType: 'text/html', body: MARKED_PAGE });
    });
    const { panel, fixture } = await openPanelForFixture(extension, FIXTURE_PATH, {
      bootHash: '#/detections',
      emulation: { colorScheme, reducedMotion: 'reduce' }
    });
    try {
      const root = panel.locator('[data-fdt-page="detections"]');
      for (const { id, kind, chip } of CASES) {
        const card = root.locator(`[data-fdt-card-id="${id}"]`);
        const badge = card.locator('[data-fdt-card-modifier]');
        await expect(badge, id).toHaveAttribute('data-fdt-card-modifier', kind);
        await expect(badge, id).toContainText(chip);
        await expect(badge.locator('svg'), id).toHaveCount(1);
        // The served verdict stays.
        await expect(card.locator('[data-fdt="status-badge"]'), id).toHaveText('Active');
      }
      // O-N3: the two features turned off in this tab are not counted active.
      const headline = root.locator('[data-fdt-summary-headline]');
      // Delay, Defer and LazyLoad are declared; only LazyLoad (rows excluded) still runs.
      await expect(headline).toHaveText(/^\s*1\s+of\s+\d+\s+optimizations active\s*$/);

      for (const width of [320, 1280]) {
        await panel.setViewportSize({ width, height: 900 });
        await expect
          .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
            message: `no horizontal scroll at ${String(width)} px (${colorScheme})`
          })
          .toBe(0);
        for (const { id } of CASES) {
          await expect(
            root.locator(`[data-fdt-card-id="${id}"] [data-fdt-card-modifier]`),
            id
          ).toBeVisible();
        }
        const shots = process.env['FDT_SHOTS_DIR'];
        if (shots !== undefined && shots !== '') {
          mkdirSync(shots, { recursive: true });
          await panel.screenshot({
            path: join(shots, `detections-${colorScheme}-${String(width)}.png`),
            fullPage: true
          });
        }
      }

      // Keyboard: the changed link cards stay reachable with Tab; the badge adds no stop.
      await root.getByRole('heading', { level: 1 }).focus();
      const delay = root.locator('[data-fdt-card-id="delay_js"]');
      let reached = false;
      for (let step = 0; step < 40 && !reached; step++) {
        await panel.keyboard.press('Tab');
        reached = await delay.evaluate((element) => element === document.activeElement);
      }
      expect(reached, 'Tab reaches the Delay JS card').toBe(true);
      await expect(delay.locator('[tabindex], button, a')).toHaveCount(0);

      // Reduced motion: nothing animates after mount.
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState === 'running')
                .length
          )
        )
        .toBe(0);
      expect(await axeAudit(panel)).toEqual({ violations: [], incomplete: [] });
    } finally {
      await panel.close();
      await fixture.page.close();
      await extension.browserContext.unroute(`**${FIXTURE_PATH}*`);
    }
  });
}
