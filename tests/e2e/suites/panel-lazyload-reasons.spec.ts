/** Browser regression for exclusion details across real detection refreshes. */
import { expect, test, ORIGIN_A } from '../helpers/extension';
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
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html?lazyload=${present ? '1' : '0'}`);
      const summary = panel.locator('[data-fdt="resource-summary"]');
      await expect(
        summary.getByText(present ? 'detected' : 'not detected', { exact: true })
      ).toBeVisible();
      await expect(
        panel.getByRole('list', { name: 'Images', exact: true }).getByRole('listitem')
      ).toHaveCount(3);
      await expect(panel.locator('[data-fdt="lazyload-reasons"]')).toHaveCount(present ? 2 : 0);
      // The FDT's marker is the row's Excluded chip, a row fact shown either way;
      // the page's own reason beside it follows the feature.
      await expect(panel.locator('[data-fdt="state-chip"][data-fdt-source="excluded"]')).toHaveText(
        ['Excluded']
      );
      await expect(panel.getByText('data-skip-lazy', { exact: true })).toHaveCount(present ? 1 : 0);
      // The lazy markup is WP Rocket's only while its LazyLoad is detected; else the page's own.
      await expect(
        panel.locator('[data-fdt="state-chip"][data-fdt-state="lazyloaded"]')
      ).toHaveAttribute('data-fdt-source', present ? 'wp-rocket' : 'page');
      await expect(panel.getByText('No reasons found', { exact: true })).toHaveCount(
        present ? 1 : 0
      );
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
