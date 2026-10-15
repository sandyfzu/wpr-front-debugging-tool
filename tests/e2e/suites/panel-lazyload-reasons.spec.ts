/** Browser regression for exclusion details across real detection refreshes. */
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/**
 * Serve identical images with optional lazyload footprints so only feature detection changes.
 *
 * @param present Whether to include both image-lazyload script footprints.
 * @returns A page with an excluded image, a plain image and an already-lazyloaded image.
 */
function imagePage(present: boolean): string {
  return `<!doctype html><html lang="en"><head><title>Lazyload reasons</title></head><body>
    <img src="/excluded.jpg" data-skip-lazy="1" data-wpr-fdt-excluded="lazyload" alt="Excluded">
    <img src="/plain.jpg" alt="Plain">
    <img data-lazy-src="/lazy.jpg" alt="Lazy">
    ${
      present
        ? `<script src="/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js"></script>
    <script>window.lazyLoadOptions={elements_selector:'img[data-lazy-src]'};</script>`
        : ''
    }
    </body></html>`;
}

test('shows reasons only while image lazyload is detected, including after page navigation', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/plain.html', {
    bootHash: '#/lazyload'
  });
  try {
    await fixture.page.route('**/pipeline/plain.html*', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: imagePage(new URL(route.request().url()).searchParams.get('lazyload') === '1')
      });
    });
    for (const present of [false, true, false, true]) {
      await fixture.page.goto(
        `http://localhost:8891/pipeline/plain.html?lazyload=${present ? '1' : '0'}`
      );
      const summary = panel.locator('[data-fdt="resource-summary"]');
      await expect(
        summary.getByText(present ? 'detected' : 'not detected', { exact: true })
      ).toBeVisible();
      await expect(
        panel.getByRole('list', { name: 'Images', exact: true }).getByRole('listitem')
      ).toHaveCount(3);
      await expect(panel.locator('[data-fdt="lazyload-reasons"]')).toHaveCount(present ? 2 : 0);
      await expect(panel.getByText('Excluded by FDT', { exact: true })).toHaveCount(
        present ? 1 : 0
      );
      await expect(panel.getByText('No reasons found', { exact: true })).toHaveCount(
        present ? 1 : 0
      );
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
