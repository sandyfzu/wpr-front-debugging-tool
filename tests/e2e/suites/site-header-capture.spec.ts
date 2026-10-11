/**
 * P4.3 suite 1 — Header capture over real main-frame responses (the
 * permanent pin).
 *
 * The P2 audit caught the capture glue dead ONCE (a built worker that never
 * called the capture store — invisible to every unit gate). This suite is
 * the deliberate re-run of that BLOCKER check against real site navigations:
 * if the glue ever unwires again, the content script's served `pageHeaders`
 * turns null here and the suite fails.
 *
 * Assert surfaces (named per assert): the content script's served payload
 * (the `getFdtData` pull, whose `pageHeaders` is the same rows the panel
 * would render) and the background handler's answer to a tabless sender.
 *
 * Real-URL facts (verified against the live stack, recorded here so the
 * asserts are readable):
 * - cache-served pages (`/fdt/`) replay NO `Link` header; WordPress-served
 *   pages (every URL with an uncached query, incl. `?nowprocket=1` and
 *   first-hit flagged URLs) carry three `Link` rows.
 * - the fixture server answers `cache-control: no-store` on everything.
 */

import { expect, openFixturePage, test } from '../helpers/extension';
import { openSitePage, SITE_URL } from '../helpers/site';

/** The headers whose presence/absence distinguishes the two serve paths. */
const SITE_URL_NO_LINK = `${SITE_URL}/fdt/`;

test.describe('site header capture', () => {
  test('real main-frame responses are captured and served as validated row pairs', async ({
    extension
  }) => {
    // The permanent pin: a real navigation → real captured rows → served.
    const sitePage = await openSitePage(extension, SITE_URL_NO_LINK);
    const siteFdt = await extension.sendToTab<{
      pageHeaders: { name: string; value?: string }[] | null;
    } | null>(sitePage.tabId, 'getFdtData');
    const siteRows = siteFdt?.pageHeaders;
    expect(siteRows, 'the site page served captured header rows (the P2 BLOCKER pin)').toBeTruthy();
    expect(Array.isArray(siteRows), 'the served shape is the P1 row-pair array').toBe(true);
    expect(siteRows?.length ?? 0).toBeGreaterThan(0);
    for (const row of siteRows ?? []) {
      expect(
        Object.keys(row).every((key) => key === 'name' || key === 'value'),
        `row keys stay name/value: ${JSON.stringify(row)}`
      ).toBe(true);
      expect(typeof row.name, 'row name is a string').toBe('string');
      expect(row.value === undefined || typeof row.value === 'string').toBe(true);
    }
    expect(
      siteRows?.find((row) => row.name.toLowerCase() === 'server')?.value?.startsWith('Apache'),
      'a real Apache response row is served'
    ).toBe(true);

    // The same capture over the fixture server's plain origin.
    const fixturePage = await openFixturePage(extension, '/pipeline/plain.html');
    const fixtureFdt = await extension.sendToTab<{
      pageHeaders: { name: string; value?: string }[] | null;
    } | null>(fixturePage.tabId, 'getFdtData');
    expect(
      fixtureFdt?.pageHeaders?.some(
        (row) => row.name.toLowerCase() === 'cache-control' && row.value === 'no-store'
      ),
      'the fixture server no-store row is served'
    ).toBe(true);
    await sitePage.page.close();
    await fixturePage.page.close();
  });

  test('rows are tab-scoped and a navigation supersedes the tab set', async ({ extension }) => {
    const sitePage = await openSitePage(extension, SITE_URL_NO_LINK);
    const fixturePage = await openFixturePage(extension, '/pipeline/plain.html');

    const hasLinkRow = (rows: { name: string }[] | null): boolean =>
      rows?.some((row) => row.name.toLowerCase() === 'link') === true;
    const pullSiteRows = async (): Promise<{ name: string }[] | null> =>
      await extension
        .sendToTab<{ pageHeaders: { name: string }[] | null } | null>(sitePage.tabId, 'getFdtData')
        .then((fdt) => fdt?.pageHeaders ?? null);

    expect(hasLinkRow(await pullSiteRows()), 'the cache-served page carries no Link rows').toBe(
      false
    );

    // The other tab keeps its OWN rows while this tab navigates (tab-scoped);
    // its no-Link fact is re-read after the navigation below.

    // Supersede: a WordPress-served (uncached) navigation brings Link rows.
    const flaggedUrl = `${SITE_URL}/?fdt-error=reference&fdt-delay=${String(Date.now())}`;
    await sitePage.page.goto(flaggedUrl, { waitUntil: 'load' });
    await expect
      .poll(async () => hasLinkRow(await pullSiteRows()), {
        timeout: 8_000,
        intervals: [100, 250, 500]
      })
      .toBe(true);
    expect(
      hasLinkRow(
        await extension
          .sendToTab<{ pageHeaders: { name: string }[] | null } | null>(
            fixturePage.tabId,
            'getFdtData'
          )
          .then((fdt) => fdt?.pageHeaders ?? null)
      ),
      'the untouched tab still carries its own set (no Link rows)'
    ).toBe(false);

    // Back to the cached page: the flagged set must not survive the return.
    await sitePage.page.goto(SITE_URL_NO_LINK, { waitUntil: 'load' });
    await expect.poll(async () => hasLinkRow(await pullSiteRows()), { timeout: 8_000 }).toBe(false);
    await sitePage.page.close();
    await fixturePage.page.close();
  });

  test('a tabless sender is ignored: null served, no tab targeted', async ({ extension }) => {
    // The popup page opened as a tab is a real extension context WITHOUT a
    // page tab: its runtime send reaches the background with no
    // `sender.tab`, so the handler must answer null (the SW side never
    // serves another tab's rows to it).
    const worker = await extension.serviceWorker();
    const popupPage = await extension.browserContext.newPage();
    await popupPage.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const reply = await popupPage.evaluate(
      async () =>
        await new Promise<unknown>((resolve) => {
          chrome.runtime.sendMessage(
            { id: 1, type: 'getPageHeaders', data: undefined, timestamp: Date.now() },
            (answer) => {
              resolve(answer);
            }
          );
        })
    );
    expect(reply, 'the tabless sender got the handler null answer').toEqual({ res: null });
    await popupPage.close();
  });

  test('a main frame over the validation caps leaves the tab with no rows', async ({
    extension
  }) => {
    // 300 filler rows exceed the 256-row capture cap: the P1 reject-whole
    // policy rejects the capture wholesale, and the served result is null —
    // never the previous page's rows, never a partial list.
    const floodPage = await openFixturePage(extension, '/__e2e/header-flood');
    const floodFdt = await extension.sendToTab<{
      pageHeaders: unknown;
    } | null>(floodPage.tabId, 'getFdtData');
    expect(floodFdt, 'the flood page processed normally').toBeTruthy();
    expect(floodFdt?.pageHeaders, 'the over-cap capture served null (wholesale reject)').toBeNull();
    await floodPage.page.close();
  });
});
