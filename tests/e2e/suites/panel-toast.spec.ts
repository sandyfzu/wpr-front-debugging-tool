/** Real copy outcomes retain valid list semantics and accessible notification messages. */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** Dev-time accessibility engine evaluated outside the extension page's CSP. */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

for (const leavingFirst of ['pointer', 'focus'] as const) {
  test(`copy notification stays paused when ${leavingFirst} leaves before the other interaction`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
      const copy = panel.getByRole('button', { name: 'Copy report', exact: true });
      await copy.focus();
      await copy.press('Enter');
      const status = panel.getByRole('region', { name: 'Notifications' }).getByRole('status');
      await expect(status).toHaveText('Report copied');
      const dismiss = panel.getByRole('button', { name: 'Dismiss — Report copied' });
      if (leavingFirst === 'pointer') {
        await dismiss.hover();
        await dismiss.focus();
        await panel.mouse.move(0, 0);
        await expect(dismiss).toBeFocused();
      } else {
        await dismiss.focus();
        await dismiss.hover();
        await copy.focus();
        await expect(copy).toBeFocused();
      }
      // Outlive the success duration: either remaining interaction must prevent dismissal.
      await panel.waitForTimeout(4500);
      await expect(status).toBeVisible();
      if (leavingFirst === 'pointer') await copy.focus();
      else await panel.mouse.move(0, 0);
      await expect(status).toHaveCount(0, { timeout: 5000 });
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}

test('copy success and failure notifications preserve native list items and clean axe results', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
  try {
    await expect(panel.getByRole('heading', { name: 'Detections', level: 1 })).toBeVisible();
    await panel.emulateMedia({ reducedMotion: 'reduce' });
    await extension.browserContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const copy = panel.getByRole('button', { name: 'Copy report', exact: true });
    await copy.focus();
    await copy.press('Enter');
    await expect(panel.getByText('Report copied', { exact: true })).toBeVisible();
    await expect(copy).toBeFocused();
    expect(await panel.evaluate(() => navigator.clipboard.readText())).not.toBe('');

    // A browser-level clipboard denial exercises the shipped failure path, not a toast test hook.
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (): Promise<void> =>
            Promise.reject(new DOMException('Clipboard denied by test', 'NotAllowedError'))
        }
      });
    });
    await copy.press('Enter');
    await expect(panel.getByRole('alert')).toContainText('The report could not be copied');
    await expect(panel.getByRole('alert')).toContainText(
      'Click inside the panel, then copy again.'
    );
    await expect(copy).toBeFocused();

    // Hover keeps the shorter success notification present while the browser audits the stack.
    await panel.locator('[data-fdt="toast"]').first().hover();
    for (const theme of ['system', 'light', 'dark']) {
      await panel.evaluate((theme) => {
        document.documentElement.dataset['theme'] = theme;
      }, theme);
      await expect
        .poll(() =>
          panel.evaluate(
            () =>
              document.getAnimations().filter((animation) => animation.playState === 'running')
                .length
          )
        )
        .toBe(0);
      await panel.evaluate(AXE_SOURCE);
      const results = await panel.evaluate(async () => {
        const engine = (
          window as unknown as {
            axe: {
              run(context: Element): Promise<{
                violations: { id: string; nodes: { target: string[] }[] }[];
                incomplete: { id: string; nodes: { target: string[] }[] }[];
              }>;
            };
          }
        ).axe;
        const region = document.querySelector('[data-fdt="toasts"]');
        if (region === null) throw new Error('The notification region is missing');
        return await engine.run(region);
      });
      expect(results.violations).toEqual([]);
      expect(results.incomplete).toEqual([]);
    }

    const items = panel.getByRole('region', { name: 'Notifications' }).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0).getByRole('status')).toHaveText('Report copied');
    await expect(items.nth(1).getByRole('alert')).toContainText('The report could not be copied');
    for (const width of [320, 480, 768, 1280]) {
      await panel.setViewportSize({ width, height: 800 });
      expect(
        await panel.evaluate(
          () => document.documentElement.scrollWidth === document.documentElement.clientWidth
        )
      ).toBe(true);
    }
    const dismiss = items.nth(1).getByRole('button', {
      name: 'Dismiss — The report could not be copied'
    });
    await dismiss.focus();
    await dismiss.press('Enter');
    await expect(panel.getByRole('alert')).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
