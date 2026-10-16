/** Independent browser adversarial checks for exhausted inventories and request boundaries. */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

test('keeps keyboard focus after an asynchronous complete-source read', async ({ extension }) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { name: 'JavaScript', level: 1 })).toBeVisible();
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.evaluate(() => {
      const original = chrome.tabs.sendMessage;
      const loose = original as unknown as (
        tabId: number,
        message: { type: string },
        options: unknown,
        callback: (response: unknown) => void
      ) => unknown;
      chrome.tabs.sendMessage = ((
        tabId: number,
        message: { type: string },
        options: unknown,
        callback: (response: unknown) => void
      ) =>
        loose(
          tabId,
          message,
          options,
          message.type === 'getScriptSourceChunk'
            ? (response: unknown) => {
                setTimeout(() => {
                  callback(response);
                }, 150);
              }
            : callback
        )) as typeof original;
    });
    const copy = panel.getByRole('button', { name: 'Script URL — copy' });
    await copy.focus();
    await copy.press('Enter');
    await expect(copy).toHaveAttribute('aria-busy', 'true');
    await expect(panel.getByText('Script URL copied', { exact: true })).toBeVisible();
    await expect(copy).toBeFocused();
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('guards keyboard and mouse repeats without reclaiming focus moved during a source read', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { name: 'JavaScript', level: 1 })).toBeVisible();
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await panel.evaluate(() => {
      const original = chrome.tabs.sendMessage;
      const loose = original as unknown as (
        tabId: number,
        message: { type: string },
        options: unknown,
        callback: (response: unknown) => void
      ) => unknown;
      chrome.tabs.sendMessage = ((
        tabId: number,
        message: { type: string },
        options: unknown,
        callback: (response: unknown) => void
      ) => {
        if (message.type === 'getScriptSourceChunk') {
          document.documentElement.dataset.copyAuditRequests = String(
            Number(document.documentElement.dataset.copyAuditRequests ?? '0') + 1
          );
          return loose(tabId, message, options, (response: unknown) => {
            setTimeout(() => {
              callback(response);
            }, 1000);
          });
        }
        return loose(tabId, message, options, callback);
      }) as typeof original;
    });
    const copy = panel.getByRole('button', { name: 'Script URL — copy' });
    await copy.focus();
    await copy.press('Enter');
    await expect(copy).toHaveAttribute('aria-busy', 'true');
    await expect(copy).toHaveAttribute('aria-disabled', 'true');
    expect(await copy.evaluate((node) => node.hasAttribute('disabled'))).toBe(false);
    await copy.press('Enter');
    await copy.press('Space');
    const box = await copy.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) throw new Error('The script copy button has no mouse target.');
    await panel.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(copy).toHaveAttribute('aria-busy', 'true');
    const search = panel.getByRole('searchbox', { name: 'Search scripts' });
    await search.focus();
    await expect(panel.getByText('Script URL copied', { exact: true })).toBeVisible();
    await expect(search).toBeFocused();
    await expect(copy).not.toHaveAttribute('aria-busy', 'true');
    expect(await panel.evaluate(() => document.documentElement.dataset.copyAuditRequests)).toBe(
      '1'
    );
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('copies a row beyond the entire inventory text budget through the real clipboard', async ({
  extension
}) => {
  const origin = 'http://fdt-audit.test';
  const tail = '\n/* after inventory budget 🛰️... */\t ';
  const html =
    '<!doctype html><html lang="en"><head><title>Clipboard budget audit</title></head><body><h1>Clipboard budget audit</h1>' +
    Array.from(
      { length: 17 },
      () => '<script type="application/json">' + 'x'.repeat(512 * 1024) + '</script>'
    ).join('') +
    '<script type="application/json">' +
    tail +
    '</script></body></html>';
  await extension.browserContext.route(`${origin}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
  });
  const { panel, fixture } = await openPanelForFixture(extension, '/budget.html', {
    origin,
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { name: 'JavaScript', level: 1 })).toBeVisible();
    const captured = await extension.sendToTab<{
      scriptSnapshotId: string;
      wprDetections: { delay_js: { scripts: { content: string }[]; truncated: boolean } };
    }>(fixture.tabId, 'getFdtData');
    expect(captured.wprDetections.delay_js.truncated).toBe(true);
    expect(captured.wprDetections.delay_js.scripts).toHaveLength(18);
    expect(captured.wprDetections.delay_js.scripts[17]?.content).toBe('');
    const list = panel.getByRole('list', { name: 'Scripts' });
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    const row = panel.locator('[data-fdt="script-row"][aria-posinset="18"]');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Content not captured (size budget)');
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    await row.getByRole('button', { name: 'Inline script — copy' }).click();
    await expect(panel.getByText('Inline script copied', { exact: true })).toBeVisible();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).toBe(tail);

    for (const request of [
      { snapshotId: captured.scriptSnapshotId, scriptIndex: -1, offset: 0 },
      { snapshotId: captured.scriptSnapshotId, scriptIndex: 5000, offset: 0 },
      { snapshotId: captured.scriptSnapshotId, scriptIndex: 17, offset: -1 },
      { snapshotId: captured.scriptSnapshotId, scriptIndex: 17, offset: tail.length + 1 },
      { snapshotId: '00000000000000000000000000000000', scriptIndex: 17, offset: 0 }
    ])
      expect(await extension.sendToTab(fixture.tabId, 'getScriptSourceChunk', request)).toEqual({
        status: 'unavailable'
      });
    expect(
      await extension.sendToTab(fixture.tabId, 'getScriptSourceChunk', {
        snapshotId: captured.scriptSnapshotId,
        scriptIndex: 17,
        offset: tail.length
      })
    ).toEqual({ status: 'ok', text: '', total: tail.length });
  } finally {
    await panel.close();
    await fixture.page.close();
    await extension.browserContext.unroute(`${origin}/**`);
  }
});
