/**
 * P4.3 suite 6 — Side-by-Side on genuinely cached pages.
 *
 * The fixture mechanics suite pins the overlay's open/refresh/scroll
 * behavior over fixture pages; this suite pins the REAL cache-state truths
 * only the WP Rocket site can produce: the two frames carry the correct
 * cached/bypassed URL pair, the cached frame's document is really the
 * cache-served page (the WP Rocket footprint comment + delay markers) while
 * the bypassed frame's document has none of it, per-side refresh
 * re-navigates real frames, and the close restores the page's scroll.
 *
 * Assert surfaces (named per assert): the shadow-DOM probe (open overlay,
 * frame srcs, per-frame document truth) and Playwright frame navigation
 * events (the reload proof).
 *
 * Cached-page fact (verified live): browsers carrying revalidators get 304s
 * back, so within one profile a page's document is stable across
 * reloads — the cached frame keeps showing the cache-served body.
 */

import type { Page } from '@playwright/test';

import { expect, type ExtensionDriver } from '../helpers/extension';
import { openSitePage, SITE_URL, siteTest } from '../helpers/site';

/** Overlay host element (WXT shadow-root UI name). */
const OVERLAY_HOST = 'wpr-fdt-side-by-side';

/** The cached page every scenario compares (param-free → cache-served). */
const CACHED_PAGE_URL = `${SITE_URL}/fdt/`;

/** The page's reachable scroll depth at the harness viewport (verified live). */
const SCROLLABLE_TO_Y = 600;

/**
 * Read the overlay's open state and both frames' identity + document truth.
 *
 * @param page The page the overlay was opened on.
 */
async function readOverlay(page: Page): Promise<{
  open: boolean;
  cached: { src: string | null; footprint: boolean; markers: number } | null;
  bypassed: { src: string | null; footprint: boolean; markers: number } | null;
}> {
  return await page.evaluate((host: string) => {
    const shadow = document.querySelector(host)?.shadowRoot ?? null;
    const readSide = (title: string) => {
      const frame = shadow?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
      if (frame === null) return null;
      const doc = frame.contentDocument;
      return {
        src: frame.getAttribute('src'),
        footprint:
          doc !== null &&
          [...doc.childNodes].some(
            (node) =>
              node.nodeType === Node.COMMENT_NODE &&
              typeof node.textContent === 'string' &&
              /Performance optimized by WP Rocket/.test(node.textContent)
          ),
        markers: doc?.querySelectorAll('script[type$="rocketlazyloadscript"]').length ?? 0
      };
    };
    return {
      open: shadow?.querySelector('.sbs-overlay--open') !== null,
      cached: readSide('Cached'),
      bypassed: readSide('Not cached')
    };
  }, OVERLAY_HOST);
}

/**
 * Read one overlay side's document identity: a re-navigation creates a new
 * document whose `performance.timeOrigin` differs — unchanged means the
 * frame kept its loaded document.
 *
 * @param page The page the overlay was opened on.
 * @param sideTitle The frame's title attribute.
 */
async function readDocumentOrigin(page: Page, sideTitle: string): Promise<number | null> {
  return await page.evaluate((title: string) => {
    const frame =
      document
        .querySelector('wpr-fdt-side-by-side')
        ?.shadowRoot?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
    return frame?.contentWindow?.performance.timeOrigin ?? null;
  }, sideTitle);
}

/**
 * Open the overlay on a page through the background's exact message row.
 *
 * @param driver The extension driver.
 * @param tabId The target tab.
 */
async function openOverlay(driver: ExtensionDriver, tabId: number): Promise<void> {
  const opened = await driver.sendToTab<boolean>(tabId, 'openSideBySide');
  expect(opened, 'the content script acknowledged the open').toBe(true);
}

siteTest.describe('site side-by-side', () => {
  // These suites run as a NORMAL VISITOR: WP Rocket serves logged-in users
  // plain pages (no cache or optimization), which would invalidate every
  // cached-frame truth below. Earlier suite files in the run may have logged
  // in on the same shared worker profile — clear the site's cookies first.
  siteTest.beforeAll(async ({ extension }) => {
    const siteHost = new URL(SITE_URL).hostname;
    await extension.browserContext.clearCookies({ domain: siteHost });
  });

  siteTest(
    'the open on the cached page loads both cache states with real content',
    async ({ extension }) => {
      const main = await openSitePage(extension, CACHED_PAGE_URL);
      await openOverlay(extension, main.tabId);

      const overlay = main.page.locator(`${OVERLAY_HOST} .sbs-overlay.sbs-overlay--open`);
      await expect(overlay, 'the open-state overlay exists in the shadow DOM').toHaveCount(1);

      await expect
        .poll(async () => await readOverlay(main.page).then((s) => s.open), {
          timeout: 10_000,
          intervals: [250]
        })
        .toBe(true);
      await expect
        .poll(async () => await readOverlay(main.page).then((s) => s.cached?.markers ?? 0), {
          timeout: 10_000,
          intervals: [250]
        })
        .toBeGreaterThan(0);
      const read = await readOverlay(main.page);
      expect(read.cached?.src, 'the cached side is the page URL verbatim').toBe(CACHED_PAGE_URL);
      expect(read.bypassed?.src, 'the bypassed side is the URL plus nowprocket=1').toBe(
        `${CACHED_PAGE_URL}?nowprocket=1`
      );

      // The REAL cache-state truth, read through each frame's own document.
      expect(read.cached?.footprint, 'the cached frame really is the cache-served page').toBe(true);
      expect(
        read.cached?.markers ?? 0,
        'the cached frame carries the delay runtime'
      ).toBeGreaterThan(0);
      expect(read.bypassed?.footprint, 'the bypassed frame has no footprint').toBe(false);
      expect(read.bypassed?.markers, 'the bypassed frame has no delay runtime').toBe(0);
      await main.page.close();
    }
  );

  siteTest('the open on a bypassed visit swaps the pair around', async ({ extension }) => {
    const bypassUrl = `${CACHED_PAGE_URL}?nowprocket=1`;
    const main = await openSitePage(extension, bypassUrl);
    await openOverlay(extension, main.tabId);

    await expect
      .poll(
        async () => {
          const state = await readOverlay(main.page);
          return state.open && (state.cached?.footprint ?? false);
        },
        { timeout: 10_000, intervals: [250] }
      )
      .toBe(true);
    const read = await readOverlay(main.page);
    expect(read.cached?.src, 'the cached side lost the bypass tag').toBe(CACHED_PAGE_URL);
    expect(read.bypassed?.src, 'the bypassed side is the visit itself').toBe(bypassUrl);
    expect(read.cached?.footprint, 'the cached frame really is the cache-served page').toBe(true);
    await main.page.close();
  });

  siteTest('per-side refresh re-navigates the real frames independently', async ({ extension }) => {
    const main = await openSitePage(extension, CACHED_PAGE_URL);
    await openOverlay(extension, main.tabId);

    // Wait until the cached frame's initial navigation has COMPLETED (a
    // loaded, footprint-carrying document), so the identity baselines below
    // belong to the loaded documents.
    await expect
      .poll(
        async () => {
          const state = await readOverlay(main.page);
          return state.open && (state.cached?.markers ?? 0) > 0;
        },
        { timeout: 8_000, intervals: [250] }
      )
      .toBe(true);

    const cachedOriginBefore = await readDocumentOrigin(main.page, 'Cached');
    const bypassOriginBefore = await readDocumentOrigin(main.page, 'Not cached');
    expect(cachedOriginBefore, 'a loaded cached document').toBeTruthy();
    expect(bypassOriginBefore, 'a loaded bypassed document').toBeTruthy();

    // The cached side re-navigates (a real reload, same origin): a new
    // document, still the cache-served page.
    await main.page.getByRole('button', { name: 'Refresh the cached version' }).click();
    await expect
      .poll(async () => await readDocumentOrigin(main.page, 'Cached'), {
        timeout: 6_000,
        intervals: [250]
      })
      .toBeGreaterThan(cachedOriginBefore ?? 0);
    expect(
      (await readOverlay(main.page)).cached?.footprint,
      'the reloaded cached frame still shows the cache-served page'
    ).toBe(true);
    expect(
      await readDocumentOrigin(main.page, 'Not cached'),
      'the bypassed side kept its loaded document'
    ).toBe(bypassOriginBefore);

    // ...and the bypassed side refreshes on its own, leaving the cached side.
    const cachedOriginAfterRefresh = await readDocumentOrigin(main.page, 'Cached');
    await main.page.getByRole('button', { name: 'Refresh the not-cached version' }).click();
    await expect
      .poll(async () => await readDocumentOrigin(main.page, 'Not cached'), {
        timeout: 6_000,
        intervals: [250]
      })
      .toBeGreaterThan(bypassOriginBefore ?? 0);
    expect(
      (await readOverlay(main.page)).bypassed?.footprint,
      'the reloaded bypassed frame still shows the plain page'
    ).toBe(false);
    expect(await readDocumentOrigin(main.page, 'Cached'), 'the cached side kept its document').toBe(
      cachedOriginAfterRefresh
    );
    await main.page.close();
  });

  siteTest('close restores the page scroll and inline overflow', async ({ extension }) => {
    const main = await openSitePage(extension, CACHED_PAGE_URL);
    await main.page.evaluate((toY: number) => {
      window.scrollTo(0, toY);
    }, SCROLLABLE_TO_Y);
    const scrollYBefore = await main.page.evaluate(() => window.scrollY);
    expect(scrollYBefore, 'the page actually scrolled (a grounded baseline)').toBe(SCROLLABLE_TO_Y);

    await openOverlay(extension, main.tabId);
    const locked = await main.page.evaluate(() => ({
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
      scrollY: window.scrollY
    }));
    expect(locked, 'the overlay locks the page scroll while open').toMatchObject({
      html: 'hidden',
      body: 'hidden'
    });

    await main.page.getByRole('button', { name: 'Close the side-by-side comparison' }).click();
    const restored = await main.page.evaluate(() => ({
      html: document.documentElement.style.overflow,
      body: document.body.style.overflow,
      scrollY: window.scrollY
    }));
    expect(restored, 'inline overflow restored and the scroll position preserved').toEqual({
      html: '',
      body: '',
      scrollY: scrollYBefore
    });
    await main.page.close();
  });
});
