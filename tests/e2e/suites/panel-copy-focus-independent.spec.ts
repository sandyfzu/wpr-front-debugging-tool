/** Independent activation, pending-write, retry, and disposal challenges. */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

for (const activation of ['Space', 'mouse'] as const) {
  test(`preserves exact ${activation} focus during slow clipboard failure and retry`, async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
      bootHash: '#/javascript'
    });
    try {
      await expect(panel.getByRole('heading', { name: 'JavaScript', level: 1 })).toBeVisible();
      await panel.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: () =>
              new Promise<void>((resolve, reject) => {
                document.documentElement.dataset.auditWrites = String(
                  Number(document.documentElement.dataset.auditWrites ?? '0') + 1
                );
                document.addEventListener(
                  'audit-clipboard-settle',
                  (event) => {
                    if ((event as CustomEvent<string>).detail === 'reject')
                      reject(new Error('audit write rejection'));
                    else resolve();
                  },
                  { once: true }
                );
              })
          }
        });
      });
      const copy = panel.getByRole('button', { name: 'Script URL — copy' });
      await copy.focus();
      if (activation === 'Space') await copy.press('Space');
      else await copy.click();
      await expect
        .poll(() => panel.evaluate(() => document.documentElement.dataset.auditWrites))
        .toBe('1');
      await expect(copy).toBeFocused();
      await expect(copy).toHaveAttribute('aria-disabled', 'true');
      await expect(copy).toHaveAttribute('aria-busy', 'true');
      await copy.evaluate((node) => {
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await copy.press('Enter');
      await copy.press('Space');
      expect(await panel.evaluate(() => document.documentElement.dataset.auditWrites)).toBe('1');
      await panel.evaluate(() =>
        document.dispatchEvent(new CustomEvent('audit-clipboard-settle', { detail: 'reject' }))
      );
      await expect(panel.getByText('Copy failed', { exact: true })).toBeVisible();
      await expect(copy).toBeFocused();
      await expect(copy).not.toHaveAttribute('aria-busy', 'true');
      await copy.press('Enter');
      await expect
        .poll(() => panel.evaluate(() => document.documentElement.dataset.auditWrites))
        .toBe('2');
      await expect(copy).toBeFocused();
      await panel.evaluate(() =>
        document.dispatchEvent(new CustomEvent('audit-clipboard-settle', { detail: 'resolve' }))
      );
      await expect(panel.getByText('Script URL copied', { exact: true })).toBeVisible();
      await expect(copy).toBeFocused();
      await expect(copy).not.toHaveAttribute('aria-disabled', 'true');
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });
}

test('suppresses late clipboard feedback after a real page switch', async ({ extension }) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/clipboard/scripts.html', {
    bootHash: '#/javascript'
  });
  try {
    await expect(panel.getByRole('heading', { name: 'JavaScript', level: 1 })).toBeVisible();
    await panel.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () =>
            new Promise<void>((resolve) => {
              document.documentElement.dataset.auditWritePending = 'true';
              document.addEventListener(
                'audit-clipboard-settle',
                () => {
                  resolve();
                },
                { once: true }
              );
            })
        }
      });
    });
    await panel.getByRole('button', { name: 'Script URL — copy' }).click();
    await expect
      .poll(() => panel.evaluate(() => document.documentElement.dataset.auditWritePending))
      .toBe('true');
    await panel.evaluate(() => {
      location.hash = '#/detections';
    });
    await expect(panel.getByRole('heading', { name: 'Detections', level: 1 })).toBeVisible();
    await panel.evaluate(async () => {
      document.dispatchEvent(new CustomEvent('audit-clipboard-settle'));
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          })
        )
      );
    });
    await expect(panel.getByText('Script URL copied', { exact: true })).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
