/**
 * A style's full CSS, read on demand on real Chromium: the Stylesheets
 * list answers with a snapshot id, a row's detail reads its element's CSS
 * from that snapshot through the real content script —
 * - a small style (with `>` and `&` in it) arrives whole and highlighted
 *   (the on-demand CSS grammar: `data-fdt-highlighted` + token classes);
 * - a style past one chunk and past the highlight limit arrives whole
 *   (several 64 KiB chunks joined), plain, and the detail says so;
 * - a style removed after the list was read reports it is gone;
 * - the critical-path style WP Rocket removed on load (a snapshot-only row)
 *   explains it has no CSS;
 * - the copy action puts the whole CSS on the clipboard.
 * The page is generated (routed): no network, deterministic sizes.
 */
import { expect, test } from '../helpers/extension';
import { closeScriptDetail, openScriptDetail } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';

/** The small style: real CSS with the characters a serializer escapes. */
const SMALL_CSS = '.nav > li a[href*="&x"] { color: red; }\n.nav > li:hover { color: blue; }';

/** The large style: past one 64 KiB chunk and past the 20,000-character highlight limit. */
const LARGE_CSS = Array.from(
  { length: 5_000 },
  (_, index) => `.rule-${String(index).padStart(4, '0')} { margin: ${String(index % 40)}px; }`
).join('\n');

/** The generated page (WP Rocket's critical style removed on load, as `cpcss-removal.js` does). */
function styleSourceHtml(): string {
  return `<!doctype html><html lang="en"><head><title>Style source fixture</title>
<style id="rocket-critical-css">body{margin:0}</style>
<style id="small-css">${SMALL_CSS}</style>
<style id="large-css">${LARGE_CSS}</style>
<style id="doomed-css">.doomed{display:none}</style>
<script>addEventListener('load', () => document.getElementById('rocket-critical-css')?.remove());</script>
</head><body><h1>Style source fixture</h1></body></html>`;
}

const PATTERN = '**/stylesheets/style-source.html*';

test('reads a style’s whole CSS on demand: highlighted, plain past the limit, gone, snapshot', async ({
  extension
}) => {
  expect(LARGE_CSS.length).toBeGreaterThan(2 * 64 * 1024);
  await extension.browserContext.route(PATTERN, async (route) => {
    await route.fulfill({ contentType: 'text/html', body: styleSourceHtml() });
  });
  const { panel, fixture } = await openPanelForFixture(
    extension,
    '/stylesheets/style-source.html',
    {
      bootHash: '#/stylesheets'
    }
  );
  try {
    await panel.setViewportSize({ width: 1280, height: 1000 });
    await fixture.page.waitForFunction(
      () => document.getElementById('rocket-critical-css') === null
    );
    const page = panel.locator('[data-fdt-page="stylesheets"]');
    const refresh = page.locator('[data-fdt="stylesheets-refresh"]');
    await refresh.click();
    await expect(refresh).not.toHaveAttribute('aria-busy', 'true');
    const row = (name: string) =>
      page.locator('[data-fdt="stylesheet-row"]').filter({
        has: panel.locator('[data-fdt="list-row-name"]', { hasText: name })
      });

    // Small: whole, highlighted as CSS, characters as the page wrote them.
    let detail = await openScriptDetail(panel, row('#small-css'));
    const small = detail.locator('[data-fdt="style-css"] [data-fdt="code-block"]');
    await expect(small).toHaveAttribute('data-fdt-highlighted', '');
    expect(await small.locator('[data-fdt-code-content]').textContent()).toBe(SMALL_CSS);
    expect(await small.locator('[class*="fdt-tk-"]').count()).toBeGreaterThan(0);
    await expect(detail.locator('[data-fdt="style-css-plain"]')).toHaveCount(0);

    // Large: every chunk joined, plain, said so (the block's own note too).
    detail = await openScriptDetail(panel, row('#large-css'));
    const large = detail.locator('[data-fdt="style-css"] [data-fdt="code-block"]');
    await expect
      .poll(async () => (await large.locator('[data-fdt-code-content]').textContent())?.length)
      .toBe(LARGE_CSS.length);
    expect(await large.locator('[data-fdt-code-content]').textContent()).toBe(LARGE_CSS);
    await expect(large).not.toHaveAttribute('data-fdt-highlighted', '');
    await expect(large.locator('[data-fdt-code-block-plain]')).toHaveText(
      'Not highlighted (too large)'
    );
    await expect(detail.locator('[data-fdt="style-css-plain"]')).toHaveText(
      'Over 20,000 characters: shown as plain text, without highlighting.'
    );

    // Copy: the whole CSS, read when copied.
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await detail.getByRole('button', { name: 'Inline style CSS — copy' }).click();
    await expect(panel.getByText('Inline style CSS copied', { exact: true })).toBeVisible();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(LARGE_CSS);

    // Removed after the list was read: the detail says it is gone.
    await closeScriptDetail(panel);
    await fixture.page.evaluate(() => document.getElementById('doomed-css')?.remove());
    detail = await openScriptDetail(panel, row('#doomed-css'));
    await expect(detail.locator('[data-fdt="style-css-note"]')).toHaveText(
      'This style is no longer on the page — refresh the list.'
    );
    await expect(detail.locator('[data-fdt="code-block"]')).toHaveCount(0);

    // The snapshot-only critical row: no CSS kept, said so.
    detail = await openScriptDetail(panel, row('#rocket-critical-css'));
    await expect(detail.locator('[data-fdt="style-snapshot-note"]')).toContainText(
      "Captured from the served HTML — its CSS isn't kept."
    );
    await expect(detail.locator('[data-fdt="style-css"]')).toHaveCount(0);

    // A refresh drops the removed style from the list.
    await closeScriptDetail(panel);
    await refresh.click();
    await expect(refresh).not.toHaveAttribute('aria-busy', 'true');
    await expect(row('#doomed-css')).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(PATTERN);
  }
});
