/** Grouped chip names and bounded titles over real captured inventories. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Debugger injection keeps the accessibility engine outside extension CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** Full URL exceeds the title limit but remains below capture's URL limit. */
const LONG_URL = `https://example.test/${'x'.repeat(400)}.js?exact=%20#tail`;

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
      <link data-rocket-preload as="image" href="${url}">`;
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
      for (const id of ['javascript', 'lazyload', 'preloaded-resources']) {
        await panel.evaluate((id) => {
          location.hash = `#/${id}`;
        }, id);
        const root = panel.locator(`[data-fdt-page="${id}"]`);
        const chip = root.locator('[data-fdt-filter-chip="all"]');
        await expect(chip).toHaveAccessibleName(/5,000 matching$/);
        await expect(chip.locator('[data-fdt-filter-count]')).toHaveText('5,000');
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        const link = root.locator('[data-fdt="external-link"]').first();
        await expect(link).toHaveAttribute('href', LONG_URL);
        await expect(link.locator('.truncate')).toHaveAttribute(
          'title',
          `${LONG_URL.slice(0, 300)}…`
        );
        await expect(link.locator('.truncate')).toHaveText(LONG_URL);
        for (const width of [320, 480, 768, 1280]) {
          await panel.setViewportSize({ width, height: 800 });
          await expect(chip).toBeVisible();
          await expect
            .poll(() => root.evaluate((element) => element.scrollWidth - element.clientWidth), {
              message: `${id} must fit at ${String(width)}px`
            })
            .toBe(0);
          if (width === 320 || width === 1280) {
            // The shared filter field: bounded to 20 rem from the regular
            // tier, full row below it — no per-page width cap, real geometry.
            const sample = await root.evaluate((page) => {
              const bar = page.querySelector('[data-fdt="filter-bar"]');
              const input = page.querySelector<HTMLInputElement>('input[type="search"]');
              if (!(bar instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
                return null;
              }
              return {
                row: bar.clientWidth,
                field: input.getBoundingClientRect().width,
                // The tier cap is 20 rem; rem resolves against the root font
                // size (not the field's own — that is the 0.75 rem `text-xs`
                // token), so the cap is derived from it and a density move
                // fails as the changed cap, not as a stale pixel count.
                cap: parseFloat(getComputedStyle(document.documentElement).fontSize) * 20
              };
            });
            if (sample === null) throw new Error('filter bar or search field missing');
            if (width === 1280) {
              expect(sample.field).toBeLessThanOrEqual(sample.cap + 1);
              expect(sample.field).toBeLessThan(sample.row - 10);
            } else {
              expect(sample.field).toBeGreaterThanOrEqual(sample.row - 2);
            }
          }
        }
        // Route focus lands on h1; native Tab enters the first grouped chip.
        await root.getByRole('heading', { level: 1 }).focus();
        await panel.keyboard.press('Tab');
        await expect(chip).toBeFocused();
        const copy = root.getByRole('button', { name: /URL.*— copy$/ }).first();
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
    const status = jsRoot.locator('[data-fdt="script-results-status"]');
    await expect(status).toHaveText(/Showing \d[\d,]* of 5,000 scripts/);
    await searchField.press('Escape');
    await expect(searchField).toHaveValue('');
    await expect(status).toHaveText('Showing all 5,000 scripts');
    await expect(jsRoot.locator('[data-fdt-filter-chip][aria-pressed="true"]')).toBeVisible();
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(pattern);
  }
});
