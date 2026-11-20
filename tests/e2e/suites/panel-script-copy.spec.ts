/** Real content capture → bounded inventory → full source → system clipboard regressions. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, openFixturePage, test } from '../helpers/extension';
import { openScriptDetail, scriptDetail, scriptRows } from '../helpers/javascript-page';
import { openPanelForFixture } from '../helpers/panel-data';

/** Dev-time accessibility engine, evaluated outside the extension page's CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

test('copies full inline content and URL beyond transport preview caps after live DOM changes', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    const inline = '/*full-copy*/' + 'a'.repeat(600000) + '🛰️\n// actual tail...';
    const url = '/script.js?q=' + 'x'.repeat(5000) + '&exact=%20#tail...';
    const captured = await extension.sendToTab<{
      scriptSnapshotId: string;
      wprDetections: {
        delay_js: { truncated?: true; scripts: { content?: string; src?: string }[] };
      };
    }>(fixture.tabId, 'getFdtData');
    expect(captured.wprDetections.delay_js.truncated).toBe(true);
    expect(captured.wprDetections.delay_js.scripts[1]?.content?.length).toBe(512 * 1024);
    expect(captured.wprDetections.delay_js.scripts[2]?.src?.length).toBe(4096);

    // Clipboard reads are a browser-test permission only; the real button performs the write.
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await fixture.page.evaluate(() => {
      const inline = document.getElementById('copy-inline');
      const external = document.getElementById('copy-external');
      if (inline === null || external === null) throw new Error('Missing copy fixtures');
      inline.textContent = 'changed after capture';
      external.setAttribute('data-rocket-src', '/wrong-after-capture.js');
    });

    // Each copy lives in its row's detail header.
    const rows = scriptRows(panel);
    const inlineDetail = await openScriptDetail(panel, rows.nth(1));
    const copyInline = inlineDetail.getByRole('button', { name: 'Inline script — copy' });
    await copyInline.focus();
    await expect(copyInline).toBeFocused();
    await copyInline.press('Enter');
    await expect(panel.getByText('Inline script copied', { exact: true })).toBeVisible();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(inline);
    const externalDetail = await openScriptDetail(panel, rows.nth(2));
    const copyUrl = externalDetail.getByRole('button', { name: 'Script URL — copy' });
    await copyUrl.click();
    await expect(panel.getByText('Script URL copied', { exact: true })).toBeVisible();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(url);

    for (const width of [320, 480, 768, 1280]) {
      await panel.setViewportSize({ width, height: 800 });
      expect(
        await panel.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
        )
      ).toBe(true);
    }
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['system', 'light', 'dark']) {
      await panel.evaluate((theme) => {
        document.documentElement.dataset['theme'] = theme;
      }, theme);
      // Back at 1280 px the pane shows the same row again, its copy with it.
      await expect(
        scriptDetail(panel).getByRole('button', { name: 'Script URL — copy' })
      ).toBeVisible();
    }
    await panel.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            done();
          });
        });
      });
    });
    await expect
      .poll(() =>
        panel.evaluate(
          () =>
            document.getAnimations().filter((animation) => animation.playState === 'running').length
        )
      )
      .toBe(0);
    // A different capture identity cannot address this tab's inventory.
    const other = await openFixturePage(extension, '/pipeline/plain.html');
    const foreign = await extension.sendToTab(other.tabId, 'getScriptSourceChunk', {
      snapshotId: captured.scriptSnapshotId,
      scriptIndex: 1,
      offset: 0
    });
    expect(foreign).toEqual({ status: 'unavailable' });
    await other.page.close();
    await fixture.page.reload();
    const fresh = await extension.sendToTab<{ scriptSnapshotId: string }>(
      fixture.tabId,
      'getFdtData'
    );
    expect(fresh.scriptSnapshotId).not.toBe(captured.scriptSnapshotId);
    const stale = await extension.sendToTab(fixture.tabId, 'getScriptSourceChunk', {
      snapshotId: captured.scriptSnapshotId,
      scriptIndex: 1,
      offset: 0
    });
    expect(stale).toEqual({ status: 'unavailable' });
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('creates and serves an exact script capture on an ordinary insecure HTTP origin', async ({
  extension
}) => {
  const origin = 'http://fdt-copy.test';
  const html = readFileSync(new URL('../fixtures/clipboard/scripts.html', import.meta.url), 'utf8');
  await extension.browserContext.route(`${origin}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: html });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    origin,
    bootHash: '#/javascript'
  });
  try {
    expect(await fixture.page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await fixture.page.evaluate(() => typeof crypto.randomUUID)).toBe('undefined');
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    const captured = await extension.sendToTab<{ scriptSnapshotId: string }>(
      fixture.tabId,
      'getFdtData'
    );
    expect(captured.scriptSnapshotId).toMatch(/^[\da-f]{32}$/);
    const chunk = await extension.sendToTab(fixture.tabId, 'getScriptSourceChunk', {
      snapshotId: captured.scriptSnapshotId,
      scriptIndex: 2,
      offset: 0
    });
    expect(chunk).toEqual({
      status: 'ok',
      text: '/script.js?q=' + 'x'.repeat(5000) + '&exact=%20#tail...',
      total: ('/script.js?q=' + 'x'.repeat(5000) + '&exact=%20#tail...').length
    });
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(`${origin}/**`);
  }
});

test('copy success feedback keeps valid live-region accessibility semantics', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { level: 1, name: 'JavaScript' })).toBeVisible();
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const detail = await openScriptDetail(panel, scriptRows(panel).nth(2));
    await detail.getByRole('button', { name: 'Script URL — copy' }).click();
    await expect(panel.getByText('Script URL copied', { exact: true })).toBeVisible();
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await panel.evaluate(async () => {
      await document.fonts.ready;
    });
    await panel.evaluate(AXE_SOURCE);
    const axe = await panel.evaluate(async () => {
      const engine = (
        window as unknown as {
          axe: {
            run(): Promise<{
              violations: { id: string; nodes: { target: string[]; html: string }[] }[];
            }>;
          };
        }
      ).axe;
      return await engine.run();
    });
    expect(axe.violations).toEqual([]);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
