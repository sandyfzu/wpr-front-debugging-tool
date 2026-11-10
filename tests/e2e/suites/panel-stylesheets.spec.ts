/**
 * The Stylesheets page on real Chromium.
 *
 * Round 1 — the source-derived fixture (`fixtures/stylesheets/chips.html`):
 * WP Rocket's `cpcss-removal.js` removes `#rocket-critical-css` on load, so
 * the Critical chip sits on one snapshot row (the DOMContentLoaded capture
 * saw the style); the async-swapped links read Async (one also Minified),
 * the self-hosted font link Font, `#wpr-usedcss` RUCSS, the two live
 * background-lazyload styles Lazy BG; the `<noscript>` fallbacks are never
 * listed; filters count every chip, search narrows, and the page never
 * scrolls sideways from 320 to 1280 px in either palette. A reload of the
 * inspected page re-reads on its own.
 *
 * Round 2 — D-7: a generated page with 5,000 styles (the list cut at its
 * 2,000-entry cap, said so) stays inside the long-task (none > 50 ms) and
 * TBT (< 200 ms) budget through a filter change, a typed search and a
 * Refresh.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** One expected row: a text it shows (URL part or `#id`) and its chips in order. */
interface ExpectedRow {
  readonly text: string;
  readonly chips: readonly string[];
}

/** The fixture's rows after load, in list order (the snapshot row leads). */
const FIXTURE_ROWS: readonly ExpectedRow[] = [
  { text: '#rocket-critical-css', chips: ['Critical'] },
  { text: 'block-library.css', chips: ['Async'] },
  {
    text: 'cache/min/1/wp-content/themes/twentytwentyfive/style.css',
    chips: ['Async', 'Minified']
  },
  { text: 'print.css', chips: [] },
  { text: '012fixture.css', chips: ['Font'] },
  { text: '#wpr-usedcss', chips: ['RUCSS'] },
  { text: '#wpr-lazyload-bg-container', chips: ['Lazy BG'] },
  { text: '#wpr-lazyload-bg-exclusion', chips: ['Lazy BG'] },
  { text: '#page-own-inline-css.theme-extra', chips: [] }
];

/**
 * A filter chip's count text.
 *
 * @param page The Stylesheets page root.
 * @param id The chip id.
 */
function chipCount(page: Locator, id: string): Locator {
  return page.locator(`[data-fdt-filter-chip="${id}"] [data-fdt-filter-count]`);
}

/**
 * Every rendered row's text and chips, in order.
 *
 * @param panel The panel page.
 */
async function renderedRows(panel: Page): Promise<{ text: string; chips: string[] }[]> {
  return await panel.locator('[data-fdt="stylesheet-row"]').evaluateAll((rows) =>
    rows.map((row) => ({
      text: row.textContent,
      chips: [...row.querySelectorAll('[data-fdt="state-chip"]')].map((chip) =>
        chip.textContent.trim()
      )
    }))
  );
}

/**
 * Read the page again and wait for the read to land.
 *
 * @param panel The panel page.
 */
async function refreshList(panel: Page): Promise<void> {
  const refresh = panel.locator('[data-fdt="stylesheets-refresh"]');
  await refresh.click();
  await expect(refresh).not.toHaveAttribute('aria-busy', 'true');
}

test('chips, filters and search over WP Rocket’s stylesheet markup; Critical from the snapshot', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/stylesheets/chips.html', {
    bootHash: '#/stylesheets'
  });
  try {
    await panel.setViewportSize({ width: 1280, height: 1600 });
    const page = panel.locator('[data-fdt-page="stylesheets"]');
    await expect(panel.getByRole('heading', { level: 1, name: 'Stylesheets' })).toBeVisible();
    // The plugin's own script removed the critical style once the async sheets loaded.
    await fixture.page.waitForFunction(
      () => document.getElementById('rocket-critical-css') === null
    );
    await expect(page.locator('[data-fdt="stylesheet-row"]').first()).toBeVisible();
    await refreshList(panel);

    await expect(page.locator('[data-fdt="stylesheets-total"]')).toHaveText('9 styles');
    // Every style state is WP Rocket's: the legend names that source alone.
    await expect(page.locator('[data-fdt="state-source-legend"]')).toHaveText('WP Rocket');
    const rows = await renderedRows(panel);
    expect(rows.map((row) => row.chips)).toEqual(FIXTURE_ROWS.map((row) => row.chips));
    FIXTURE_ROWS.forEach((expected, index) => {
      expect(rows[index]?.text, expected.text).toContain(expected.text);
    });
    // The default media says nothing; any other media is named.
    expect(rows[1]?.text).not.toContain('media:');
    expect(rows[3]?.text).toContain('media: print');
    await expect(page.locator('[data-fdt="style-snapshot-note"]')).toHaveText(
      'No longer on the page'
    );
    // Never the <noscript> fallbacks (their ids), never the nostyle background style.
    await expect(page).not.toContainText('theme-css');
    await expect(page).not.toContainText('wpr-lazyload-bg-nostyle');

    const counts: Record<string, string> = {
      all: '9',
      critical: '1',
      rucss: '1',
      'lazy-bg': '2',
      async: '2',
      minified: '1',
      font: '1',
      inline: '5',
      external: '4'
    };
    for (const [id, count] of Object.entries(counts)) {
      await expect(chipCount(page, id), id).toHaveText(count);
    }
    await page.locator('[data-fdt-filter-chip="async"]').click();
    await expect(page.locator('[data-fdt="stylesheet-row"]')).toHaveCount(2);
    await page.locator('[data-fdt-filter-chip="all"]').click();
    await page.locator('input[type="search"]').fill('usedcss');
    await expect(page.locator('[data-fdt="stylesheet-row"]')).toHaveCount(1);
    await expect(page.locator('[data-fdt="stylesheet-row"]')).toContainText('#wpr-usedcss');
    await page.locator('input[type="search"]').fill('');
    await expect(page.locator('[data-fdt="stylesheet-row"]')).toHaveCount(9);

    for (const colorScheme of ['light', 'dark'] as const) {
      await panel.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      // D-2: under reduced motion nothing runs (the shell's page entrance,
      // played before the emulation, stays listed as finished — not ours).
      await expect
        .poll(() =>
          panel.evaluate(
            () => document.getAnimations().filter((a) => a.playState === 'running').length
          )
        )
        .toBe(0);
      for (const width of [320, 480, 768, 1280]) {
        await panel.setViewportSize({ width, height: 1600 });
        await expect
          .poll(() => page.evaluate((element) => element.scrollWidth - element.clientWidth), {
            message: `stylesheets must fit at ${String(width)}px (${colorScheme})`
          })
          .toBe(0);
        const right = await page.evaluate((element) => element.getBoundingClientRect().right);
        for (const box of await page
          .locator('[data-fdt="state-chip"] [data-fdt="badge"]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().right)
          )) {
          expect(box, `chip inside the page at ${String(width)}px`).toBeLessThanOrEqual(
            right + 0.5
          );
        }
      }
    }

    // A reload is a new page load: the page re-reads it on its own.
    await panel.setViewportSize({ width: 1280, height: 1600 });
    await fixture.page.reload({ waitUntil: 'load' });
    await fixture.page.waitForFunction(
      () => document.getElementById('rocket-critical-css') === null
    );
    await expect(page.locator('[data-fdt="stylesheets-total"]')).toHaveText('9 styles');
    await expect(chipCount(page, 'critical')).toHaveText('1');
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

/** Styles on the generated page (half inline, half links). */
const STYLES = 5_000;

/** The generated page: deterministic styles, links on data URLs (no network). */
function largeStylesHtml(): string {
  const tags = Array.from({ length: STYLES }, (_, index) => {
    const token = `style-${String(index).padStart(4, '0')}`;
    return index % 2 === 0
      ? `<style id="${token}">.${token}{color:#${String(index % 1000).padStart(3, '0')}}</style>`
      : `<link rel="stylesheet" id="${token}" ${index % 10 === 1 ? 'data-rocket-async="style" ' : ''}href="data:text/css,/*${token}*/">`;
  });
  return `<!doctype html><html lang="en"><head><title>Stylesheets perf fixture</title>${tags.join('')}</head><body><h1>Stylesheets perf fixture</h1></body></html>`;
}

const PERF_PATTERN = '**/stylesheets/perf.html*';

/** The long-task collector, armed before the panel's module graph (measurement only). */
const PERF_OBSERVER = `(() => {
  if (!PerformanceObserver.supportedEntryTypes.includes('longtask'))
    throw new Error('Long-task observation unavailable');
  const collector = { phase: 'cold', tasks: [], tbtByPhase: {} };
  collector.setPhase = (next) => { collector.phase = next; };
  collector.observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      collector.tasks.push({ phase: collector.phase, duration: entry.duration });
      collector.tbtByPhase[collector.phase] =
        (collector.tbtByPhase[collector.phase] ?? 0) + Math.max(0, entry.duration - 50);
    }
  });
  collector.observer.observe({ type: 'longtask', buffered: false });
  window.__fdtPerf = collector;
})();
`;

/** Shape of the collector (for the TS view). */
interface PerfState {
  tasks: { phase: string; duration: number }[];
  tbtByPhase: Record<string, number>;
  observer: PerformanceObserver;
  setPhase(next: string): void;
}

test('5,000 styles: a capped, virtualized list inside the long-task and TBT budget', async ({
  extension
}, info) => {
  await extension.browserContext.route(PERF_PATTERN, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: largeStylesHtml() });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/stylesheets/perf.html', {
    bootHash: '#/stylesheets',
    panelInit: PERF_OBSERVER
  });
  try {
    await panel.setViewportSize({ width: 1280, height: 900 });
    const page = panel.locator('[data-fdt-page="stylesheets"]');
    await expect(page.locator('[data-fdt="stylesheets-cut"]')).toHaveText(
      'Showing the first 2,000 of 5,000 styles.'
    );
    await expect(page.locator('[data-fdt="stylesheets-total"]')).toHaveText('2,000+ styles');
    await expect(chipCount(page, 'all')).toHaveText('2,000');
    // Virtualized: a viewport's worth of rows, never the whole list.
    expect(await page.locator('[data-fdt="stylesheet-row"]').count()).toBeLessThan(100);

    await panel.evaluate(() => {
      (window as unknown as { __fdtPerf: PerfState }).__fdtPerf.setPhase('warm');
    });
    await page.locator('[data-fdt-filter-chip="async"]').click();
    await expect(page.locator('[data-fdt="resource-results-status"]')).toHaveText(
      'Showing 200 of 2,000 styles'
    );
    await page.locator('[data-fdt-filter-chip="all"]').click();
    await page.locator('input[type="search"]').fill('style-1999');
    await expect(page.locator('[data-fdt="stylesheet-row"]')).toHaveCount(1);
    await page.locator('input[type="search"]').fill('');
    await refreshList(panel);
    await expect(chipCount(page, 'all')).toHaveText('2,000');

    const audit = await panel.evaluate(() => {
      const perf = (window as unknown as { __fdtPerf: PerfState }).__fdtPerf;
      perf.observer.disconnect();
      return { tasks: perf.tasks, tbtByPhase: perf.tbtByPhase };
    });
    await info.attach('stylesheets-longtasks.json', {
      body: JSON.stringify(audit.tasks),
      contentType: 'application/json'
    });
    const warmOver50 = audit.tasks.filter((task) => task.phase === 'warm' && task.duration > 50);
    expect(warmOver50, `warm long tasks over 50 ms: ${JSON.stringify(warmOver50)}`).toEqual([]);
    expect(audit.tbtByPhase['warm'] ?? 0).toBeLessThan(200);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(PERF_PATTERN);
  }
});
