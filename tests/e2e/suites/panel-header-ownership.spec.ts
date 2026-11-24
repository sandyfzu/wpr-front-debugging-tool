/**
 * Header inventory ownership: Detections stays an overview, while the
 * dedicated Headers & Cookies route retains the real captured response; over
 * the local site's edge layer, one host-layer header reads the same on the
 * cache verdict, the Host layers card and its Headers-page row (group + hint).
 */
import { hostLayerMarker } from '../../../lib/detection/host-layers';
import { hostLayerHint } from '../../../lib/detection/host-layer-hints';
import { expect, test } from '../helpers/extension';
import {
  devtoolsShim,
  openPanelForFixture,
  panelPageUrl,
  showPanelRoute
} from '../helpers/panel-data';
import { openSitePage, SITE_ORIGIN, SITE_URL } from '../helpers/site';

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

/**
 * One edge-layer round on the local site: the `fdt-edge-header` flag the
 * edge fixture turns into one host header, with the signature stripped so
 * the cache verdict rests on that header alone.
 */
interface EdgeRound {
  /** The edge fixture's flag value. */
  readonly flag: 'sg' | 'cf' | 'cf-dynamic' | 'proxy';
  /** The header pair the edge sends. */
  readonly header: readonly [name: string, value: string];
  /** The Host layers card subtitle. */
  readonly card: string;
  /** The summary's cache fact (the cache chip). */
  readonly chip: string;
}

/** The edge fixture's four layers, read by the one vocabulary on every surface. */
const EDGE_ROUNDS: readonly EdgeRound[] = [
  {
    flag: 'sg',
    header: ['sg-f-cache', 'HIT'],
    card: 'SiteGround: cache hit',
    chip: 'Possibly cached'
  },
  {
    flag: 'cf',
    header: ['cf-cache-status', 'HIT'],
    card: 'Cloudflare: cache hit',
    chip: 'Possibly cached'
  },
  {
    flag: 'cf-dynamic',
    header: ['cf-cache-status', 'DYNAMIC'],
    card: 'Cloudflare: no cache hit',
    chip: 'Cache not detected'
  },
  {
    flag: 'proxy',
    header: ['x-proxy-cache', 'HIT'],
    card: 'Host proxy cache: cache hit',
    chip: 'Possibly cached'
  }
];

for (const round of EDGE_ROUNDS) {
  test(`edge ${round.flag}: the verdict, the Host layers card and the Headers row agree`, async ({
    extension
  }) => {
    const url = `${SITE_URL}/fdt/?fdt-edge-header=${round.flag}&fdt-edge-strip=1`;
    const site = await openSitePage(extension, url);
    const panel = await extension.browserContext.newPage();
    try {
      // The capture lands asynchronously after load: wait until the content
      // script serves the edge's header, so the panel boots on the full payload.
      await expect
        .poll(
          async () =>
            (
              await extension.sendToTab<{
                pageHeaders: { name: string; value?: string }[] | null;
              } | null>(site.tabId, 'getFdtData')
            )?.pageHeaders?.some((row) => row.name.toLowerCase() === round.header[0]) === true,
          { timeout: 15_000, intervals: [250, 500] }
        )
        .toBe(true);
      await panel.addInitScript(devtoolsShim(site.tabId, { origin: SITE_ORIGIN, resources: [] }));
      await panel.goto(`${await panelPageUrl(extension)}#/detections`, { waitUntil: 'load' });
      const layers = panel.locator('[data-fdt-card-id="host-layers"]');
      await expect(layers.locator('[data-fdt="tooltip-trigger"]')).toHaveText(round.card);
      await expect(panel.locator('[data-fdt-summary-fact="cache"]')).toHaveText(round.chip);
      const detectionsText = await panel.evaluate(() => document.body.textContent);

      await showPanelRoute(panel, 'headers-cookies');
      // Each header row with the section heading it renders under.
      const rows = await panel.evaluate(() => {
        let section = '';
        const found: { section: string; term: string; value: string }[] = [];
        for (const row of document.querySelectorAll('[data-fdt-inventory-row]')) {
          const kind = row.getAttribute('data-fdt-inventory-row');
          if (kind === 'section') section = row.textContent;
          if (kind !== 'header') continue;
          found.push({
            section,
            term: row.querySelector('[data-fdt-key-value-term]')?.textContent ?? '',
            value: row.querySelector('[data-fdt-key-value-value]')?.textContent ?? ''
          });
        }
        return found;
      });
      const [name, value] = round.header;
      const row = rows.find((candidate) => candidate.term === name);
      const read = hostLayerMarker(name)?.marker.read(value);
      const hint = read === null || read === undefined ? null : hostLayerHint(name, read);
      // A real hint, never a vacuous pass on null: the round's value must be
      // a documented form with copy.
      if (hint === null) throw new Error(`${name}: ${value} has no vocabulary hint`);
      expect(hint.length, `${name}: ${value} hint copy`).toBeGreaterThan(0);
      expect(row?.section, `${name} is caching evidence`).toMatch(/^Caching evidence/);
      expect(row?.value.startsWith(value), `${name} value`).toBe(true);
      expect(row?.value, `${name} hint`).toContain(hint);
      if (round.flag === 'proxy') {
        // The generic proxy header is its own layer on every surface.
        const headersText = await panel.evaluate(() => document.body.textContent);
        expect(`${detectionsText} ${headersText}`).not.toContain('SiteGround');
      }
    } finally {
      await panel.close();
      await site.page.close();
    }
  });
}
