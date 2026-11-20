/**
 * The page capture keeps inline script text as the page wrote it, on real
 * Chromium: the content script snapshots the document with `XMLSerializer`
 * (which escapes `&`, `<`, `>` in text) and re-parses it as HTML (which
 * never decodes raw-text elements), and the pass restores that text — so an
 * inline script holding `a > b && c < d` (and the literal entity text
 * `&lt;`) shows exactly those characters in the JavaScript row's preview,
 * its detail's code and its copy, never `&gt;`/`&amp;`/`&amp;lt;`.
 */
import { expect, test } from '../helpers/extension';
import { openScriptDetail, scriptRowNamed } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';

/** The inline script: comparison and logical operators, plus an entity-shaped string. */
const SCRIPT = 'if (a > b && c < d) { window.fdtProbe = "&lt;"; }';

const PATTERN = '**/javascript/raw-text.html*';

test('inline script text keeps > & < through the capture: preview, detail and copy', async ({
  extension
}) => {
  await extension.browserContext.route(PATTERN, async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><title>Raw text</title><script>var a = 2, b = 1, c = 0, d = 1;</script><script>${SCRIPT}</script></head><body><h1>Raw text</h1></body></html>`
    });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/javascript/raw-text.html', {
    bootHash: '#/javascript'
  });
  try {
    await panel.setViewportSize({ width: 1280, height: 900 });
    // The page's own text, for the record: what the capture must equal.
    expect(
      await fixture.page.evaluate(() => document.querySelectorAll('script')[1]?.textContent)
    ).toBe(SCRIPT);
    const row = scriptRowNamed(panel, 'Inline script #2');
    await expect(row.locator('[data-fdt="list-row-preview"]')).toHaveText(SCRIPT);
    await expect(row).not.toContainText('&gt;');
    const detail = await openScriptDetail(panel, row);
    const code = detail.locator('[data-fdt="script-source"] [data-fdt-code-content]');
    await expect(code).toHaveText(SCRIPT);
    expect(await code.textContent()).toBe(SCRIPT);

    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await detail.getByRole('button', { name: 'Inline script — copy' }).click();
    await expect(panel.getByText('Inline script copied', { exact: true })).toBeVisible();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(SCRIPT);
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(PATTERN);
  }
});
