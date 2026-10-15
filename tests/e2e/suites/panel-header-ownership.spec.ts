/**
 * Header inventory ownership: Detections stays an overview, while the
 * dedicated Headers & Cookies route retains the real captured response.
 */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

test('keeps captured response headers on their dedicated page', async ({ extension }) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
  try {
    await expect(panel.getByRole('heading', { level: 1, name: 'Detections' })).toBeVisible();
    const served = await extension.sendToTab<{
      pageHeaders: { name: string; value?: string }[] | null;
    } | null>(fixture.tabId, 'getFdtData');
    expect(
      served?.pageHeaders?.some((header) => header.name.toLowerCase() === 'cache-control')
    ).toBe(true);
    await expect(panel.getByText('Response headers', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: /Response headers/ })).toHaveCount(0);
    await expect(panel.getByText('no-store', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Copy report' })).toBeVisible();

    await panel
      .getByRole('navigation', { name: 'WPR FDT pages' })
      .getByRole('link', { name: 'Headers & Cookies', exact: true })
      .click();
    await expect(panel.getByRole('heading', { level: 1, name: 'Headers & Cookies' })).toBeVisible();
    await expect(panel.getByText('cache-control', { exact: true })).toBeVisible();
    await expect(panel.getByText('no-store', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'All headers', exact: true })).toBeVisible();

    await panel
      .getByRole('navigation', { name: 'WPR FDT pages' })
      .getByRole('link', { name: 'Detections', exact: true })
      .click();
    await expect(panel.getByRole('heading', { level: 1, name: 'Detections' })).toBeVisible();
    await expect(panel.getByText('Response headers', { exact: true })).toHaveCount(0);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
