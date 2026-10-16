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
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(pattern);
  }
});
