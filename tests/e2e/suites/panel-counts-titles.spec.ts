/**
 * Grouped filter names and bounded titles over real captured inventories:
 * the JavaScript, Lazyload and Preloaded pages' facets (each first facet's
 * "Any" segment counts every row), their rows' bounded name titles and
 * their detail's source-link tile and copy.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Locator } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { facetSegment, openScriptDetail } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
test.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/** Debugger injection keeps the accessibility engine outside extension CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** Full URL exceeds the title limit but remains below capture's URL limit. */
const LONG_URL = `https://example.test/${'x'.repeat(400)}.js?exact=%20#tail`;

/** The capped title of {@link LONG_URL}. */
const LONG_TITLE = `${LONG_URL.slice(0, 300)}…`;

/** The long URL's file name (its rows' name). */
const LONG_NAME = `${'x'.repeat(400)}.js`;

/** The capped title of {@link LONG_NAME}. */
const LONG_NAME_TITLE = `${LONG_NAME.slice(0, 300)}…`;

/** Each list's first facet, its rows' hook and its detail's copy name. */
const LISTS = {
  javascript: { facet: 'Delay', row: '[data-fdt="script-row"]', copy: 'Script URL' },
  lazyload: { facet: 'Lazyload', row: '[data-fdt="lazyload-row"]', copy: 'Image URL' },
  'preloaded-resources': { facet: 'Source', row: '[data-fdt="hint-row"]', copy: 'Hint URL' }
} as const;

/**
 * The search field's and its row's widths, plus the 20 rem cap (rem resolves
 * against the root font size, not the field's own `text-xs`, so a density
 * move fails as the changed cap, not as a stale pixel count). The JavaScript
 * page's row is its facet bar, whose compact form keeps the Filters button
 * beside the field (its width + the bar's gap are reported as `beside`).
 *
 * @param root The page root.
 */
async function searchGeometry(
  root: Locator
): Promise<{ row: number; field: number; cap: number; beside: number } | null> {
  return await root.evaluate((page) => {
    const bar = page.querySelector('[data-fdt="facet-bar"]');
    const input = page.querySelector<HTMLInputElement>('input[type="search"]');
    if (!(bar instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return null;
    const filters = bar.querySelector('[data-fdt="facet-filters-button"]');
    const gap = parseFloat(getComputedStyle(bar.firstElementChild ?? bar).columnGap) || 0;
    return {
      row: bar.clientWidth,
      field: input.getBoundingClientRect().width,
      cap: parseFloat(getComputedStyle(document.documentElement).fontSize) * 20,
      beside: filters === null ? 0 : filters.getBoundingClientRect().width + gap
    };
  });
}

/**
 * Build inert inventories without remote requests or a large committed fixture.
 * @returns Exactly 5,000 scripts, images and preload links, with long first URLs.
 */
function inventoryPage(): string {
  const rows = Array.from({ length: 5000 }, (_, index) => {
    const url = index === 0 ? LONG_URL : `https://example.test/${String(index)}.js`;
    const footprint =
      index === 0
        ? 'src="/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"'
        : '';
    return `<script type="rocketlazyloadscript" data-rocket-src="${url}" ${footprint}></script>
      <img data-lazy-src="${url}" alt="Fixture ${String(index)}">
      <link rel="preload" data-rocket-preload as="image" href="${url}">`;
  });
  return `<!doctype html><html lang="en"><head><title>Count and title fixture</title></head>
    <body><h1>Count and title fixture</h1>${rows.join('')}</body></html>`;
}

test('keeps grouped names, bounded titles and full copy/link values on all list pages', async ({
  extension
}) => {
  const pattern = '**/pipeline/counts-titles.html*';
  await extension.browserContext.route(pattern, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: inventoryPage() });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/counts-titles.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(fixture.page.locator('script')).toHaveCount(5000);
    await expect(fixture.page.locator('img')).toHaveCount(5000);
    await expect(fixture.page.locator('link[data-rocket-preload]')).toHaveCount(5000);
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    for (const theme of ['system', 'light', 'dark']) {
      await extension.evaluateInWorker(async (appearance: string) => {
        await chrome.storage.sync.set({ options: { appearance, improvements: {}, features: {} } });
      }, theme);
      if (theme === 'system') {
        await expect(panel.locator('html')).not.toHaveAttribute('data-theme');
      } else {
        await expect(panel.locator('html')).toHaveAttribute('data-theme', theme);
      }
      for (const id of ['javascript', 'lazyload', 'preloaded-resources'] as const) {
        await panel.evaluate((id) => {
          location.hash = `#/${id}`;
        }, id);
        const root = panel.locator(`[data-fdt-page="${id}"]`);
        const scripts = id === 'javascript';
        const list = LISTS[id];
        // The "all rows" filter: the list's first facet's Any.
        const chip = facetSegment(root, 'any', list.facet);
        await expect(chip.locator('input')).toHaveAccessibleName(/5,000$/);
        await expect(chip.locator('[data-fdt-choice-count]')).toHaveText('5,000');
        await expect(chip.locator('input')).toBeChecked();
        // The row's name is the file name, its title bounded.
        const name = root.locator(list.row).first().locator('[data-fdt="list-row-name"]');
        await expect(name).toHaveText(LONG_NAME);
        await expect(name).toHaveAttribute('title', LONG_NAME_TITLE);
        for (const width of [320, 480, 768, 1280]) {
          await panel.setViewportSize({ width, height: 800 });
          // The list's tier follows its measured width (a resize observer):
          // two frames let the measure land before the tier is read.
          await panel.evaluate(
            () =>
              new Promise<void>((done) => {
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    done();
                  });
                });
              })
          );
          // A compact facet bar folds its facets into the Filters button.
          const compactFacets =
            (await root.locator('[data-fdt="facet-bar"]').getAttribute('data-fdt-compact')) !==
            null;
          await expect(
            compactFacets ? root.locator('[data-fdt="facet-filters-button"]') : chip
          ).toBeVisible();
          await expect
            .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
              message: `${id} must fit at ${String(width)}px`
            })
            .toBe(0);
          if (width === 320 || width === 1280) {
            // The shared filter field: bounded to 20 rem from the regular
            // tier, its full row below it (beside the Filters button on a
            // compact facet bar) — no per-page width cap, real geometry.
            const sample = await searchGeometry(root);
            if (sample === null) throw new Error('facet bar or search field missing');
            if (width === 1280) {
              expect(sample.field).toBeLessThanOrEqual(sample.cap + 1);
              expect(sample.field).toBeLessThan(sample.row - 10);
            } else {
              expect(sample.field).toBeGreaterThanOrEqual(sample.row - sample.beside - 2);
            }
          }
        }
        // Route focus lands on h1; native Tab enters the first grouped filter
        // (on JavaScript after its view tabs: the selected tab is one stop).
        await root.getByRole('heading', { level: 1 }).focus();
        if (scripts) {
          await panel.keyboard.press('Tab');
          await expect(root.getByRole('tab', { selected: true })).toBeFocused();
        }
        await panel.keyboard.press('Tab');
        await expect(chip.locator('input')).toBeFocused();
        // The full URL and its copy live in the row's detail.
        const detail = await openScriptDetail(panel, root.locator(list.row).first());
        const tile = detail.locator('[data-fdt="source-link-open"]');
        await expect(tile).toHaveAttribute('title', LONG_TITLE);
        await expect(detail.locator('[data-fdt="source-link"] a[href]').first()).toHaveAttribute(
          'href',
          LONG_URL
        );
        const copy = detail.getByRole('button', { name: `${list.copy} — copy` });
        await panel.evaluate(() => navigator.clipboard.writeText('not copied'));
        await copy.press('Enter');
        await expect
          .poll(() => panel.evaluate(() => navigator.clipboard.readText()))
          .toBe(LONG_URL);
        // Audit the list, not a stack of transient copy confirmations from earlier routes.
        await panel.getByRole('button', { name: /^Dismiss — .* copied$/ }).click();
        await expect(panel.locator('[data-fdt="toast"]')).toHaveCount(0);
        await panel.evaluate(AXE_SOURCE);
        const audit = await panel.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((done) => {
            requestAnimationFrame(() => {
              done();
            });
          });
          const axe = (
            window as unknown as {
              axe: {
                run: () => Promise<{
                  violations: { id: string }[];
                  incomplete: {
                    id: string;
                    nodes: { target: unknown; failureSummary: string }[];
                  }[];
                }>;
              };
            }
          ).axe;
          const result = await axe.run();
          return {
            violations: result.violations.map((rule) => rule.id),
            incomplete: result.incomplete.map((rule) => ({
              id: rule.id,
              nodes: rule.nodes.map((node) => ({
                target: node.target,
                reason: node.failureSummary
              }))
            }))
          };
        });
        expect(audit).toEqual({ violations: [], incomplete: [] });
        await expect
          .poll(() =>
            panel.evaluate(
              () =>
                document.getAnimations().filter((animation) => animation.playState === 'running')
                  .length
            )
          )
          .toBe(0);
      }
    }
    // The field's Esc rule on a real page (the field's own rule — the
    // find-bar relay is the search-relay suite): a query narrows the list
    // and lands on the shared count line, Esc clears field and store, the
    // full list comes back. The lightweight a11y engine must pass over it.
    await panel.setViewportSize({ width: 1280, height: 800 });
    await panel.evaluate(() => {
      location.hash = '#/javascript';
    });
    const jsRoot = panel.locator('[data-fdt-page="javascript"]');
    const searchField = jsRoot.locator('input[type="search"]');
    await searchField.fill('example.test/4');
    const status = jsRoot.locator('[data-fdt="resource-results-status"]');
    await expect(status).toHaveText(/Showing \d[\d,]* of 5,000 scripts/);
    await searchField.press('Escape');
    await expect(searchField).toHaveValue('');
    await expect(status).toHaveText('Showing all 5,000 scripts');
    // The facets are untouched by the field's Esc: every one still on Any.
    await expect(facetSegment(jsRoot, 'any', 'Delay').locator('input')).toBeChecked();
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(pattern);
  }
});
