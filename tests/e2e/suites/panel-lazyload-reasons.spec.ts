/**
 * Browser regression for exclusion details across real detection refreshes:
 * the open image's detail lists its page reasons only while image lazyload
 * is detected, and says no exclusion applies otherwise — following each
 * navigation of the inspected page with the detail kept open.
 */
import { expect, test, ORIGIN_A } from '../helpers/extension';
import { openScriptDetail } from '../helpers/javascript-page';
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
    await panel.setViewportSize({ width: 1280, height: 900 });
    await fixture.page.route('**/pipeline/plain.html*', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: imagePage(new URL(route.request().url()).searchParams.get('lazyload') === '1')
      });
    });
    const rows = panel.getByRole('list', { name: 'Images', exact: true }).getByRole('listitem');
    const summary = panel.locator('[data-fdt="resource-summary"] [data-fdt="status-badge"]');
    const pane = panel.locator('[data-fdt="detail-pane"]');
    /**
     * Assert the open detail's reasons section for one image.
     *
     * @param name The image's name.
     * @param present Whether image lazyload is detected.
     */
    const expectReasons = async (name: string, present: boolean): Promise<void> => {
      await expect(pane.locator('[data-fdt="detail-title"]')).toHaveText(name);
      const reasons = pane.locator('[data-fdt="lazyload-reasons"]');
      const off = pane.locator('[data-fdt="lazyload-reasons-off"]');
      if (present) {
        if (name === 'excluded.jpg') {
          // The page's own reason is listed; the FDT's marker never is (its chip says it).
          await expect(reasons.getByText('data-skip-lazy', { exact: true })).toHaveCount(1);
          await expect(reasons).not.toContainText('data-wpr-fdt-excluded');
        } else {
          await expect(reasons).toHaveText('Exclusion reasonsNo reasons found');
        }
        await expect(off).toHaveCount(0);
      } else {
        await expect(reasons).toHaveCount(0);
        await expect(off).toHaveText(
          "LazyLoad for images doesn't run on this page, so no exclusion applies."
        );
      }
    };
    for (const [round, present] of [false, true, false, true].entries()) {
      await fixture.page.goto(`${ORIGIN_A}/pipeline/plain.html?lazyload=${present ? '1' : '0'}`);
      await expect(summary).toHaveText(present ? 'Detected' : 'Not detected');
      await expect(rows).toHaveCount(3);
      // The image left open follows the refresh by key, its reasons with the feature.
      if (round > 0) await expectReasons('plain.jpg', present);
      // The rows never carry reasons; the detail does.
      await expect(rows.locator('[data-fdt="lazyload-reasons"]')).toHaveCount(0);
      // The FDT's marker is the row's Excluded chip, a row fact shown either way;
      // the page's own reason beside it follows the feature.
      await expect(rows.locator('[data-fdt="state-chip"][data-fdt-source="excluded"]')).toHaveText([
        'Excluded'
      ]);
      // The lazy markup is WP Rocket's only while its LazyLoad is detected; else the page's own.
      await expect(
        rows.locator('[data-fdt="state-chip"][data-fdt-state="lazyloaded"]')
      ).toHaveAttribute('data-fdt-source', present ? 'wp-rocket' : 'page');
      for (const name of ['excluded.jpg', 'plain.jpg']) {
        await openScriptDetail(
          panel,
          panel.locator('[data-fdt="lazyload-row"]', { hasText: name })
        );
        await expectReasons(name, present);
      }
    }
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});
