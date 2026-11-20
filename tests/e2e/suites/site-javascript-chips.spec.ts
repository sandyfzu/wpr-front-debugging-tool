/**
 * The JavaScript page's state chips over WP Rocket's real output, on the
 * docker site's delay scenario (`/fdt/?fdt-delay=1`: Delay JS, Defer JS and
 * Minify JS on, the meta declares them). Ground truth is the served HTML:
 *
 * - each `cache/min/` script WP Rocket delayed and deferred reads exactly
 *   Delayed · Deferred · Minified, each WP Rocket's (rocket + soft fill): the
 *   row shows the first two and folds Minified into a WP Rocket "+1", its
 *   detail lists all three;
 * - a delayed module keeps its original type: it leads the row's preview and
 *   is the detail's "Original type" fact;
 * - the File facet's Minified value lists exactly the minified scripts,
 *   Combined has none (Combine JS off: the meta does not declare it);
 * - the page never scrolls sideways from 320 to 1280 px, and the row's
 *   chips + "+1" stay on one line from 420 px on.
 *
 * A Combine arm (Combine JavaScript files on, Delay JS off — WP Rocket forces
 * Combine off under Delay) proves Combine apart from Minify on the real
 * render: the meta declares Combine and refutes Minify JS, the bundle reads
 * Combined, never Minified. The suite restores the settings it found (purged
 * after, the hub page re-stored).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import {
  closeScriptDetail,
  facetCount,
  facetSegment,
  openScriptDetail,
  pickFacet
} from '../helpers/javascript-page';
import { devtoolsShim, panelPageUrl } from '../helpers/panel-data';
import { openSitePage, SITE_URL } from '../helpers/site';
import { readWprSettings, writeWprSettings, type WprSettings } from '../helpers/site-wpcli';

/** The delay scenario, never cached (each load is WP Rocket's fresh output). */
const PAGE = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1`;

/** The three mu-plugin fixture scripts WP Rocket minifies, delays and defers. */
const MINIFIED_SCRIPTS = [
  'fdt-delayed-reference.js',
  'fdt-delayed-lifecycle.js',
  'fdt-delayed-definer.js'
] as const;

/**
 * The row whose URL or code contains a text.
 *
 * @param panel The panel page.
 * @param text The text.
 */
function rowWith(panel: Page, text: string): Locator {
  return panel.locator('[data-fdt="script-row"]', { hasText: text });
}

/**
 * A row's visible state words, in order.
 *
 * @param row The row.
 */
async function stateWords(row: Locator): Promise<string[]> {
  return await row.locator('[data-fdt="state-chip"]').allTextContents();
}

/**
 * A row's visible chip sources, in order.
 *
 * @param row The row.
 */
async function stateSources(row: Locator): Promise<(string | undefined)[]> {
  return await row
    .locator('[data-fdt="state-chip"]')
    .evaluateAll((chips) => chips.map((chip) => (chip as HTMLElement).dataset.fdtSource));
}

/**
 * A File/Delay/… facet value's count text.
 *
 * @param panel The panel page.
 * @param id The value id.
 */
async function chipCount(panel: Page, id: string): Promise<string | null> {
  return await facetCount(panel, id).textContent();
}

/** WP Rocket's combined bundle: `cache/min/<blog id>/<md5>.js` (named by content hash). */
const COMBINED_BUNDLE = /\/cache\/min\/\d+\/[0-9a-f]{32}\.js(?:\?|$)/;

/** The settings found before the suite (restored after). */
let found: WprSettings | null = null;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ extension }) => {
  // Anonymous visitor: a site login from an earlier suite disables the optimizations.
  await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
  found = await readWprSettings();
});

test.afterAll(async () => {
  const snapshot = found;
  if (snapshot === null) return;
  await writeWprSettings(snapshot);
  // Re-store the hub page the restore purged (later suites' cached legs read it).
  const response = await fetch(`${SITE_URL}/fdt/`, {
    headers: { 'User-Agent': 'fdt-chips-probe' }
  });
  await response.text();
  if (response.status !== 200) throw new Error(`/fdt/ answered ${String(response.status)}`);
});

test('state chips and filters read WP Rocket’s real Delay, Defer and Minify JS output', async ({
  extension
}) => {
  const site = await openSitePage(extension, PAGE);
  const panel = await extension.browserContext.newPage();
  try {
    // Ground truth: the served tags carry the minify stamp under the minify cache.
    const served = await site.page.evaluate(() =>
      [...document.querySelectorAll('script[data-minify="1"]')].map(
        (script) => script.getAttribute('data-rocket-src') ?? ''
      )
    );
    expect(served.filter((src) => src.includes('/cache/min/'))).toHaveLength(
      MINIFIED_SCRIPTS.length
    );

    await panel.setViewportSize({ width: 1280, height: 2400 });
    await panel.addInitScript(devtoolsShim(site.tabId));
    await panel.goto(`${await panelPageUrl(extension)}#/javascript`, { waitUntil: 'load' });
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    await expect(rowWith(panel, MINIFIED_SCRIPTS[0])).toBeVisible();

    for (const name of MINIFIED_SCRIPTS) {
      const row = rowWith(panel, name);
      // Two chips on the row, the third folded into a WP Rocket "+1".
      expect(await stateWords(row), name).toEqual(['Delayed', 'Deferred']);
      expect(await stateSources(row), name).toEqual(['wp-rocket', 'wp-rocket']);
      const overflow = row.locator('[data-fdt="state-chip-overflow"]');
      await expect(overflow).toHaveText('+1');
      await expect(overflow).toHaveAttribute('data-fdt-hides-wp-rocket', '');
      // Negative states are no chips any more.
      await expect(row).not.toContainText('Not delayed');
      // The detail lists all three, each WP Rocket's.
      const detail = await openScriptDetail(panel, row);
      const all = detail.locator('[data-fdt="script-detail-chips"]');
      expect(await stateWords(all), name).toEqual(['Delayed', 'Deferred', 'Minified']);
      expect(await stateSources(all), name).toEqual(['wp-rocket', 'wp-rocket', 'wp-rocket']);
      await closeScriptDetail(panel);
    }

    // The core navigation module: delayed and deferred, not minified, its type kept.
    const module = rowWith(panel, 'block-library/navigation/view.min.js');
    expect(await stateWords(module)).toEqual(['Delayed', 'Deferred']);
    expect(await stateSources(module)).toEqual(['wp-rocket', 'wp-rocket']);
    await expect(module.locator('[data-fdt="state-chip-overflow"]')).toHaveCount(0);
    await expect(module.locator('[data-fdt="list-row-preview"]')).toHaveText(/^module · /);
    const moduleDetail = await openScriptDetail(panel, module);
    const facts = moduleDetail.locator('[data-fdt="script-facts"]');
    await expect(facts.locator('dt', { hasText: 'Original type' })).toHaveCount(1);
    await expect(facts.locator('dd', { hasText: /^module$/ })).toHaveCount(1);
    await closeScriptDetail(panel);

    // The facets cover every chip: Minified lists exactly the minified scripts.
    expect(await chipCount(panel, 'minified')).toBe(String(MINIFIED_SCRIPTS.length));
    expect(await chipCount(panel, 'combined')).toBe('0');
    await expect(facetSegment(panel, 'combined').locator('input')).toBeDisabled();
    await pickFacet(panel, 'minified');
    const shown = panel.locator('[data-fdt="script-row"]');
    await expect(shown).toHaveCount(MINIFIED_SCRIPTS.length);
    for (const name of MINIFIED_SCRIPTS) await expect(rowWith(panel, name)).toHaveCount(1);
    await pickFacet(panel, 'any', 'File');

    // No sideways scroll at any panel width; the row's chips stay on screen
    // at 320, and on one line (two chips + "+1", icons included) from the
    // narrow panel's 420 on — at 320 the compact chip line (≈ 140 px) is
    // narrower than the set (≈ 190 px) and wraps instead.
    const root = panel.locator('[data-fdt-page="javascript"]');
    for (const width of [320, 420, 480, 760, 768, 1100, 1280]) {
      await panel.setViewportSize({ width, height: 2400 });
      await expect
        .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
          message: `javascript must fit at ${String(width)}px`
        })
        .toBe(0);
      const chips = rowWith(panel, MINIFIED_SCRIPTS[0]).locator(
        '[data-fdt="state-chip"] [data-fdt="badge"], [data-fdt="state-chip-overflow"] [data-fdt="badge"]'
      );
      await expect(chips).toHaveCount(3);
      const right = await root.evaluate((element) => element.getBoundingClientRect().right);
      for (const box of await chips.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().right)
      )) {
        expect(box, `chip inside the page at ${String(width)}px`).toBeLessThanOrEqual(right + 0.5);
      }
      // One line: every chip starts above the bottom of every other one.
      const boxes = await chips.evaluateAll((elements) =>
        elements.map((element) => {
          const { top, bottom } = element.getBoundingClientRect();
          return { top, bottom };
        })
      );
      const oneLine =
        Math.max(...boxes.map((box) => box.top)) < Math.min(...boxes.map((box) => box.bottom));
      if (width >= 420)
        expect(oneLine, `chips on one line at ${String(width)}px: ${JSON.stringify(boxes)}`).toBe(
          true
        );
    }
  } finally {
    await panel.close();
    await site.page.close();
  }
});

test('Combine JavaScript files: the bundle reads Combined, never Minified; the meta refutes Minify JS', async ({
  extension
}) => {
  test.setTimeout(120_000);
  if (found === null) throw new Error('the settings snapshot is missing');
  await writeWprSettings({ ...found, delay_js: 0, minify_concatenate_js: 1 });
  const site = await openSitePage(extension, PAGE);
  const panel = await extension.browserContext.newPage();
  try {
    // Ground truth: WP Rocket served the fixture scripts as stamped bundles.
    const bundles = await site.page.evaluate((pattern: string) => {
      const shape = new RegExp(pattern);
      return [...document.querySelectorAll('script[data-minify="1"]')]
        .map((script) => script.getAttribute('src') ?? '')
        .filter((src) => shape.test(src));
    }, COMBINED_BUNDLE.source);
    expect(bundles.length, 'WP Rocket combined the page scripts').toBeGreaterThan(0);

    const served = await extension.sendToTab<Record<
      string,
      { present: boolean; source?: string }
    > | null>(site.tabId, 'getWprDetections');
    expect(served?.minify_concatenate_js).toEqual({ present: true, source: 'meta' });
    expect(served?.minify_js).toEqual({ present: false, source: 'meta' });

    await panel.setViewportSize({ width: 1280, height: 2400 });
    await panel.addInitScript(devtoolsShim(site.tabId));
    await panel.goto(`${await panelPageUrl(extension)}#/javascript`, { waitUntil: 'load' });
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    const bundleName = new URL(bundles[0] ?? '', SITE_URL).pathname.split('/').pop() ?? '';
    const row = rowWith(panel, bundleName);
    await expect(row).toBeVisible();
    // The detail lists every chip (a row may fold some into "+N").
    const chips = (await openScriptDetail(panel, row)).locator('[data-fdt="script-detail-chips"]');
    const words = await stateWords(chips);
    expect(words).toContain('Combined');
    expect(words).not.toContain('Minified');
    // WP Rocket built the bundle: the chip carries its source.
    await expect(chips.locator('[data-fdt-state="combined"]')).toHaveAttribute(
      'data-fdt-source',
      'wp-rocket'
    );
    expect(await chipCount(panel, 'combined')).toBe(String(bundles.length));
    expect(await chipCount(panel, 'minified')).toBe('0');
  } finally {
    await panel.close();
    await site.page.close();
  }
});
