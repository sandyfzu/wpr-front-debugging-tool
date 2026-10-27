/**
 * P4.3 suite 6 — Side-by-Side on genuinely cached pages.
 *
 * The fixture mechanics suite pins the overlay's open/refresh/scroll
 * behavior over fixture pages; this suite pins the REAL cache-state truths
 * only the WP Rocket site can produce: the two frames carry the correct
 * cached/bypassed URL pair, the cached frame's document is really the
 * cache-served page (the WP Rocket footprint comment + delay markers) while
 * the bypassed frame's document has none of it, per-side refresh
 * re-navigates real frames, the close restores the page's scroll, and a
 * host page that reloaded itself on the same URL continues the compare.
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

import { expect, type DriverPage, type ExtensionDriver } from '../helpers/extension';
import { openSitePage, SITE_URL, siteTest } from '../helpers/site';

/** Overlay host element (WXT shadow-root UI name). */
const OVERLAY_HOST = 'wpr-fdt-side-by-side';

/** The cached page every scenario compares (param-free → cache-served). */
const CACHED_PAGE_URL = `${SITE_URL}/fdt/`;

/** The page's reachable scroll depth at the harness viewport (verified live). */
const SCROLLABLE_TO_Y = 600;

/** One overlay frame's read: its `src` attribute plus its document's own truth. */
interface FrameTruth {
  /** The frame element's `src` attribute. */
  src: string | null;
  /** The document's own URL — the real page once committed, `about:blank` before. */
  href: string | null;
  /** The document's `readyState` (the load-settle signal). */
  readyState: string | null;
  /** The WP Rocket footprint comment sits at the document's root. */
  footprint: boolean;
  /** The document's delay-runtime script markers. */
  markers: number;
}

/**
 * Read the overlay's open state and both frames' identity + document truth.
 *
 * `href`/`readyState` are load-bearing: an about:blank first commit reads the
 * same footprint/markers as a bypassed page (none) — only the frame document's
 * own URL and load state distinguish that initial commit from the real page.
 *
 * @param page The page the overlay was opened on.
 */
async function readOverlay(page: Page): Promise<{
  open: boolean;
  cached: FrameTruth | null;
  bypassed: FrameTruth | null;
}> {
  return await page.evaluate((host: string) => {
    const shadow = document.querySelector(host)?.shadowRoot ?? null;
    const readSide = (title: string): FrameTruth | null => {
      const frame = shadow?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
      if (frame === null) return null;
      const doc = frame.contentDocument;
      return {
        src: frame.getAttribute('src'),
        href: doc?.location.href ?? null,
        readyState: doc?.readyState ?? null,
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
 * Wait until one side re-navigated to a NEW document that finished loading
 * on its real URL. A new `timeOrigin` alone only proves the commit: the
 * document can still be parsing (`readyState === 'loading'`), and WP Rocket's
 * footprint comment sits at the very end of the page, so a footprint read
 * then sees none (observed: the cached side read `loading`, no footprint, no
 * markers right after its new origin appeared).
 *
 * @param page The page the overlay was opened on.
 * @param sideTitle The frame's title attribute.
 * @param originBefore The side's document `timeOrigin` before the refresh.
 * @param href The side's real URL.
 */
async function waitForReloadedSide(
  page: Page,
  sideTitle: 'Cached' | 'Not cached',
  originBefore: number | null,
  href: string
): Promise<void> {
  await expect
    .poll(
      async () => {
        const origin = await readDocumentOrigin(page, sideTitle);
        const state = await readOverlay(page);
        const side = sideTitle === 'Cached' ? state.cached : state.bypassed;
        return (
          origin !== null &&
          origin > (originBefore ?? 0) &&
          side?.href === href &&
          side.readyState === 'complete'
        );
      },
      { timeout: 6_000, intervals: [250] }
    )
    .toBe(true);
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
    const bypassUrl = `${CACHED_PAGE_URL}?nowprocket=1`;
    const main = await openSitePage(extension, CACHED_PAGE_URL);
    await openOverlay(extension, main.tabId);

    // Wait until BOTH frames sit on their real, fully loaded documents: the
    // cached side's marker-carrying cache-served page AND the bypassed side
    // on its real `?nowprocket=1` URL, both `readyState === 'complete'`. A
    // cached-side-only settle masked a proven baseline race: an about:blank
    // first commit reads the same footprint/markers as the bypassed page
    // (none), so the bypassed frame's real document — the slower WordPress
    // bootstrap under full-tier load — could commit INSIDE the
    // baseline→assert window below, breaking the kept-document assert (and
    // false-passing the second refresh leg) with zero site misbehavior.
    // Gating both sides' real documents moves that commit ahead of the
    // baselines.
    await expect
      .poll(
        async () => {
          const state = await readOverlay(main.page);
          const { cached, bypassed } = state;
          return (
            state.open &&
            cached !== null &&
            cached.markers > 0 &&
            cached.href === CACHED_PAGE_URL &&
            cached.readyState === 'complete' &&
            bypassed !== null &&
            bypassed.href === bypassUrl &&
            bypassed.readyState === 'complete'
          );
        },
        { timeout: 10_000, intervals: [250] }
      )
      .toBe(true);

    // The host page must never see a click on the overlay: WP Rocket's
    // delay runtime saves a page's first interactions at the window and
    // replays them on their targets once its scripts load — a replayed
    // refresh click reloaded the cached side a second time.
    // Why this counter proves it: it is a bubbling-phase window listener,
    // the phase the delay runtime registers its own (`passive: false`, no
    // capture), and Playwright's clicks are real input events that bubble
    // from the overlay's button through its shadow root to the window. The
    // UI stops them at its shadow root, so the count stays 0; without that
    // isolation every overlay click reaches here (one per click).
    await main.page.evaluate(() => {
      const counter = window as unknown as { e2ePageClicks: number };
      counter.e2ePageClicks = 0;
      window.addEventListener('click', () => {
        counter.e2ePageClicks += 1;
      });
    });

    const cachedOriginBefore = await readDocumentOrigin(main.page, 'Cached');
    const bypassOriginBefore = await readDocumentOrigin(main.page, 'Not cached');
    expect(cachedOriginBefore, 'a loaded cached document').toBeTruthy();
    expect(bypassOriginBefore, 'a loaded bypassed document').toBeTruthy();

    // The cached side re-navigates (a real reload, same origin): a new
    // document, still the cache-served page.
    await main.page.getByRole('button', { name: 'Refresh the cached version' }).click();
    await waitForReloadedSide(main.page, 'Cached', cachedOriginBefore, CACHED_PAGE_URL);
    const afterCachedRefresh = await readOverlay(main.page);
    expect(
      afterCachedRefresh.cached?.footprint,
      'the reloaded cached frame still shows the cache-served page'
    ).toBe(true);
    expect(
      await readDocumentOrigin(main.page, 'Not cached'),
      'the bypassed side kept its loaded document'
    ).toBe(bypassOriginBefore);
    expect(
      afterCachedRefresh.bypassed?.href,
      'the bypassed side kept its real document URL (no about:blank strip)'
    ).toBe(bypassUrl);

    // ...and the bypassed side refreshes on its own, leaving the cached side.
    const cachedOriginAfterRefresh = await readDocumentOrigin(main.page, 'Cached');
    await main.page.getByRole('button', { name: 'Refresh the not-cached version' }).click();
    await waitForReloadedSide(main.page, 'Not cached', bypassOriginBefore, bypassUrl);
    const afterBypassedRefresh = await readOverlay(main.page);
    expect(
      afterBypassedRefresh.bypassed?.footprint,
      'the reloaded bypassed frame still shows the plain page'
    ).toBe(false);
    expect(await readDocumentOrigin(main.page, 'Cached'), 'the cached side kept its document').toBe(
      cachedOriginAfterRefresh
    );
    expect(
      afterBypassedRefresh.cached?.href,
      'the cached side kept its real document URL (no about:blank strip)'
    ).toBe(CACHED_PAGE_URL);
    expect(
      await main.page.evaluate(
        () => (window as unknown as { e2ePageClicks: number }).e2ePageClicks
      ),
      'the host page saw none of the overlay clicks'
    ).toBe(0);
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

  siteTest.describe('compare continuity across the page reloading itself', () => {
    /**
     * The session-rule ids read through the store: one id per live session,
     * each id equal to the tab it was derived from (the encoding the toggle
     * bug pinned at unit level; this row witnesses it end to end).
     */
    const sessionRuleIds = (extension: ExtensionDriver): Promise<number[]> =>
      extension.evaluateInWorker(
        async () => (await chrome.declarativeNetRequest.getSessionRules()).map((rule) => rule.id),
        undefined
      );

    /**
     * The persisted mobile target resets to the switch's default for this
     * describe: rows below persist toggles into the worker profile's
     * options, and one profile runs the whole tier (the stand's suite-level
     * cookie cleanse exists for exactly that sharing).
     *
     * @param extension The extension driver (the worker's options write).
     */
    const clearPersistedMobileTarget = (extension: ExtensionDriver): Promise<void> =>
      extension.evaluateInWorker(async () => {
        const stored = await chrome.storage.sync.get('options');
        const options = stored.options as
          { features?: { sbsMobileSim?: boolean } | undefined } | undefined;
        if (options?.features?.sbsMobileSim === true) {
          await chrome.storage.sync.set({
            options: { ...options, features: { ...options.features, sbsMobileSim: false } }
          });
        }
      }, undefined);

    siteTest.beforeAll(async ({ extension }) => {
      await clearPersistedMobileTarget(extension);
    });

    /**
     * Bring the mobile session up unless it is already engaged: the machine
     * can converge the persisted target to phone at the open itself (earlier
     * rows in a shared profile persist their toggles), in which case the
     * switch already reads checked and a blind click would flip it off.
     *
     * @param main The open page holding the overlay.
     */
    const engageMobileIfNeeded = async (main: DriverPage): Promise<void> => {
      const switchEl = main.page.locator(`${OVERLAY_HOST} input[role="switch"]`).nth(1);
      await switchEl.waitFor({ state: 'attached', timeout: 10_000 });
      if ((await switchEl.getAttribute('aria-checked')) !== 'true') {
        await switchEl.click();
      }
    };

    /**
     * The mobile session's settled outcome: the phone presentation online on
     * both halves, no failure note, the switch checked with the engaged
     * device named beside it, and exactly one session rule keyed by the
     * owning tab.
     *
     * @param extension The extension driver for the session-rule store read.
     * @param main The open page + tab id.
     */
    const expectPhoneSession = async (
      extension: ExtensionDriver,
      main: DriverPage
    ): Promise<void> => {
      await expect
        .poll(
          async () =>
            (await main.page.locator(`${OVERLAY_HOST} .sbs-half--phone`).count()) === 2 &&
            (await main.page.locator(`${OVERLAY_HOST} .sbs-note`).count()) === 0,
          { timeout: 15_000, intervals: [250] }
        )
        .toBe(true);
      const ids = await sessionRuleIds(extension);
      expect(ids.filter((id) => id === main.tabId)).toHaveLength(1);
      await expect(
        main.page.locator(`${OVERLAY_HOST} input[role="switch"]`).nth(1),
        'the mobile switch reflects the engaged session'
      ).toBeChecked();
      const deviceTag = main.page.locator(`${OVERLAY_HOST} .sbs-switch .sbs-mobile-tag`);
      await expect(deviceTag, 'the engaged device is named next to the mobile switch').toHaveCount(
        1
      );
      await expect(deviceTag).toHaveText('Generic Android phone');
      // The state's shipped visibility surface: both side labels carry the
      // · mobile mark while the session holds.
      await expect(
        main.page.locator(`${OVERLAY_HOST} .sbs-side-label .sbs-mobile-tag`),
        'both side labels mark the engaged session'
      ).toHaveCount(2);
    };

    siteTest(
      'a reload with the compare open continues it, phone session re-established',
      async ({ extension }) => {
        const main = await openSitePage(extension, CACHED_PAGE_URL);
        await openOverlay(extension, main.tabId);
        await main.page.locator(`${OVERLAY_HOST} input[role="switch"]`).nth(1).click();
        await expectPhoneSession(extension, main);

        // The host page re-navigating itself (responsive hosts reload at
        // breakpoints) must not strand the user: the next boot restores the
        // overlay and the machine converges the persisted mobile target.
        await main.page.reload({ waitUntil: 'load' });
        const openAgain = main.page.locator(`${OVERLAY_HOST} .sbs-overlay--open`);
        await expect
          .poll(async () => await openAgain.count(), { timeout: 15_000, intervals: [250] })
          .toBe(1);
        await expectPhoneSession(extension, main);
        await main.page.close();
      }
    );

    siteTest('a reload after a close leaves the page clear', async ({ extension }) => {
      const main = await openSitePage(extension, CACHED_PAGE_URL);
      await openOverlay(extension, main.tabId);
      await main.page.getByRole('button', { name: 'Close the side-by-side comparison' }).click();
      await main.page.reload({ waitUntil: 'load' });
      // The absence auto-wait is the settle moment the boot needed: the boot
      // fires before `load` completes, so a fixed sleep was the tier's only
      // raw wait. After it, the store read is readable.
      await expect(
        main.page.locator(`${OVERLAY_HOST} .sbs-overlay--open`),
        'the closed compare does not restore after its reload'
      ).toHaveCount(0, { timeout: 5_000 });
      // Tab-scoped on purpose: this row's contract is its own session's
      // rule, not the worker profile's global rule store.
      const remainingIds = await sessionRuleIds(extension);
      expect(remainingIds, 'the closed compare leaves no session rule behind').not.toContain(
        main.tabId
      );
      await main.page.close();
    });

    siteTest(
      'a squeezed window never strips a loaded frame src (the size gate latches)',
      async ({ extension }) => {
        const main = await openSitePage(extension, CACHED_PAGE_URL);
        await openOverlay(extension, main.tabId);
        // Engagement is conditional on purpose: the machine can converge the
        // persisted target to phone at the open itself (the helper's doc).
        await engageMobileIfNeeded(main);
        await expectPhoneSession(extension, main);

        /**
         * The two frames' `src` attributes as the shadow DOM reports them —
         * the latch's contract is exactly whether these survive a squeeze.
         */
        const frameSrcs = (): Promise<(string | null)[]> =>
          main.page
            .locator(`${OVERLAY_HOST} iframe.sbs-frame`)
            .evaluateAll((frames) =>
              frames.map((f) => (f as HTMLIFrameElement).getAttribute('src'))
            );
        const before = await frameSrcs();
        expect(before).toHaveLength(2);
        expect(
          before.every((src) => typeof src === 'string' && src.length > 0),
          'both halves sit on a real src before the squeeze'
        ).toBe(true);

        // Squeeze below any possible fit: an ungated live fit would remove
        // both `src` attributes here (blanking the frames into an
        // about:blank bounce and a re-navigation); the latch rides it out.
        const original = main.page.viewportSize();
        await main.page.setViewportSize({ width: 500, height: 320 });
        await expect.poll(frameSrcs, { timeout: 2_000, intervals: [150] }).toEqual(before);

        if (original) await main.page.setViewportSize(original);
        await expectPhoneSession(extension, main);
        await main.page.close();
      }
    );

    siteTest(
      'the engaged device is named next to the mobile switch, unnamed when disengaging',
      async ({ extension }) => {
        const main = await openSitePage(extension, CACHED_PAGE_URL);
        await openOverlay(extension, main.tabId);
        await engageMobileIfNeeded(main);
        // The engaged-side asserts live in expectPhoneSession; this row pins
        // the off branch it cannot cover: the name tag leaves the bar while
        // the switch itself stays rendered, the session rule retracts, and
        // the disengage actually re-navigates the halves (a fresh document —
        // the reload the session flip demands, not just a class swap: the
        // reload-keying regression class this row watches).
        const tokenBefore = await readDocumentOrigin(main.page, 'Cached');
        expect(tokenBefore, 'a loaded document origin before the disengage').toBeTruthy();
        const switchEl = main.page.locator(`${OVERLAY_HOST} input[role="switch"]`).nth(1);
        await switchEl.click();
        const deviceTag = main.page.locator(`${OVERLAY_HOST} .sbs-switch .sbs-mobile-tag`);
        await expect
          .poll(async () => await deviceTag.count(), { timeout: 5_000, intervals: [250] })
          .toBe(0);
        await expect(switchEl, 'the mobile switch itself stays rendered, unchecked').toBeChecked({
          checked: false
        });
        await expect
          .poll(async () => (await sessionRuleIds(extension)).includes(main.tabId), {
            timeout: 5_000,
            intervals: [250]
          })
          .toBe(false);
        // A fresh document rode the re-navigation: the time origin differs.
        await expect
          .poll(
            async (): Promise<boolean> => {
              const fresh = await readDocumentOrigin(main.page, 'Cached');
              return fresh !== null && fresh !== tokenBefore;
            },
            { timeout: 10_000, intervals: [250] }
          )
          .toBe(true);
        await main.page.close();
      }
    );
  });
});
