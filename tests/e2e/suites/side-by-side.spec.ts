/**
 * Suite 4 — Side-by-Side mechanics (message-driven, no real context menus).
 *
 * The harness opens the compare overlay the same way the context-menu
 * dispatch does: the background's `openSideBySide` protocol row, sent from
 * the service worker to the fixture tab. Everything below asserts the
 * overlay's real page state (shadow-DOM probes + per-frame body tokens); its
 * own comment names the surface each assert reads.
 *
 * Context-menu CLICKS stay manual: native browser menus are not
 * Playwright-reachable (the right click opens OS-level chrome). The click
 * dispatch tree is unit-pinned (P2), the PSI entry URL construction by the
 * P3 URL unit suite; the open itself is asserted here over the same SW
 * message that click sends. The manual remainder is recorded in
 * tests/e2e/README.md and in the phase docs.
 */

import type { Page } from '@playwright/test';
import { expect, openFixturePage, test } from '../helpers/extension';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
test.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/** Overlay host element (WXT shadow-root UI name, feature-scoped). */
const OVERLAY_HOST_NAME = 'wpr-fdt-side-by-side';

/** How long a refresh's re-navigation may take (local server, real reload). */
const RELOAD_TIMEOUT = 4_000;

/** The inline overflow baselines the fixture page itself pins (plain literals). */
const FIXTURE_OVERFLOW_BASELINE = { html: 'auto', body: 'scroll' } as const;

/** Page scroll position the suite drives to before the overlay opens. */
const SCROLLED_TO_Y = 640;

/** The page's inline-overflow + scroll state (the overlay's restore contract). */
interface ScrollState {
  html: string;
  body: string;
  scrollY: number;
}

/** One compare half's scroll facts, read through the open shadow root and its frame. */
interface HalfScroll {
  /** The half's current scrollTop. */
  y: number;
  /** The half's scrollable range (`scrollHeight − clientHeight`). */
  range: number;
}

/**
 * Read one half's scroll facts through the open shadow root (the genuine
 * main-world probe; same-document halves must agree after a mapped sync).
 *
 * @param page The fixture page with the overlay open.
 * @param frameTitle Which overlay frame to read.
 */
async function readHalfScroll(page: Page, frameTitle: string): Promise<HalfScroll> {
  return await page.evaluate((title: string): HalfScroll => {
    const frame =
      document
        .querySelector('wpr-fdt-side-by-side')
        ?.shadowRoot?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
    if (frame === null) throw new Error(`the ${title} frame is not in the shadow root`);
    const win = frame.contentWindow;
    if (win === null) throw new Error(`the ${title} frame has no window yet`);
    const scrolling = win.document.scrollingElement ?? win.document.documentElement;
    return { y: scrolling.scrollTop, range: scrolling.scrollHeight - scrolling.clientHeight };
  }, frameTitle);
}

/**
 * Read the overflow state the page actually carries (inline styles — the
 * overlay's save/restore contract), plus the scroll position.
 *
 * @param page The fixture page.
 */
async function readScrollState(page: Page): Promise<ScrollState> {
  return await page.evaluate((): ScrollState => ({
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
    scrollY: window.scrollY
  }));
}

/**
 * The page's per-request token, read through the overlay's open shadow root
 * and its same-origin frame (the genuine main-world page-DOM probe — same
 * read as the user's devtools would take).
 *
 * @param page The fixture page.
 * @param frameTitle Which overlay frame to read.
 */
async function readFrameToken(page: Page, frameTitle: string): Promise<string | null> {
  return await page.evaluate((title: string) => {
    const host = document.querySelector('wpr-fdt-side-by-side');
    const frame =
      host?.shadowRoot?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
    if (frame === null) return null;
    const document_ = frame.contentDocument;
    return document_?.getElementById('frame-token')?.textContent ?? null;
  }, frameTitle);
}

/**
 * A half's in-frame desktop media-query state, read through the open shadow
 * root (the genuine main-world probe: the frame's content box IS its
 * viewport, so this is what the page's CSS resolves against).
 *
 * @param page The fixture page with the overlay open.
 * @param frameTitle Which overlay frame to read.
 */
async function readFrameMedia(page: Page, frameTitle: string): Promise<boolean> {
  return await page.evaluate((title: string): boolean => {
    const frame =
      document
        .querySelector('wpr-fdt-side-by-side')
        ?.shadowRoot?.querySelector<HTMLIFrameElement>(`iframe[title="${title}"]`) ?? null;
    if (frame === null) throw new Error(`the ${title} frame is not in the shadow root`);
    const win = frame.contentWindow;
    if (win === null) throw new Error(`the ${title} frame has no window yet`);
    return win.matchMedia('(min-width: 1280px)').matches;
  }, frameTitle);
}

/** One phone device's border-box rect, in page coordinates. */
interface DeviceRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The phone pair's live geometry, probed through the open shadow root. */
interface PairGeometry {
  /** The cached half's device wrapper. */
  cached: DeviceRect;
  /** The bypassed half's device wrapper. */
  bypassed: DeviceRect;
  /** The frames row both devices letterbox inside. */
  frames: DeviceRect;
}

/**
 * The phone pair's geometry through the open shadow root: the two device
 * wrappers' border-box rects plus the frames row's rect. The wrappers are
 * never transformed (the scale transform lives on the frames inside them),
 * so their rects are the layout truth.
 *
 * @param page The fixture page with the overlay open.
 * @returns The geometry, or null while the phone dress is not on both halves.
 */
async function readPairGeometry(page: Page): Promise<PairGeometry | null> {
  return await page.evaluate((): PairGeometry | null => {
    const shadow = document.querySelector('wpr-fdt-side-by-side')?.shadowRoot ?? null;
    const frames = shadow?.querySelector('.sbs-frames') ?? null;
    const devices = shadow?.querySelectorAll('.sbs-viewport--phone') ?? null;
    if (frames === null || devices === null || devices.length !== 2) return null;
    const rect = (el: Element): DeviceRect => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const cached = devices[0];
    const bypassed = devices[1];
    if (cached === undefined || bypassed === undefined) return null;
    return { cached: rect(cached), bypassed: rect(bypassed), frames: rect(frames) };
  });
}

/**
 * The phone pair's gathered contract at its current window size: the devices
 * sit a small fixed step apart (the facing borders' 8px), the pair is
 * centered over the frames row on both axes, and neither device leaves the
 * row. The tolerances carry subpixel rounding only.
 *
 * @param pair The geometry as probed.
 */
function pairIsGathered(pair: PairGeometry): boolean {
  const gap = pair.bypassed.left - pair.cached.right;
  const pairCenterX = (pair.cached.left + pair.bypassed.right) / 2;
  const pairCenterY = (pair.cached.top + pair.cached.bottom) / 2;
  const framesCenterX = (pair.frames.left + pair.frames.right) / 2;
  const framesCenterY = (pair.frames.top + pair.frames.bottom) / 2;
  return (
    gap >= 7.5 &&
    gap <= 8.5 &&
    Math.abs(pairCenterX - framesCenterX) <= 1 &&
    Math.abs(pairCenterY - framesCenterY) <= 1 &&
    pair.cached.left >= pair.frames.left - 0.5 &&
    pair.bypassed.right <= pair.frames.right + 0.5
  );
}

test.describe('side-by-side mechanics', () => {
  test('message-driven open mounts the shadow overlay with the two cache states', async ({
    extension
  }) => {
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    const pageUrl = fixture.page.url();

    // The background's open row, driven from the SW — the context-menu
    // dispatch's exact message path (page state from here out).
    const opened = await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    expect(opened, 'the content script acknowledged the open').toBe(true);

    const overlay = fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`);
    await expect(overlay, 'the open-state overlay exists in the shadow DOM').toHaveCount(1);
    await expect(overlay, 'the overlay covers the viewport').toBeInViewport();

    // URL rules (page state): without the bypass tag, cached = the page URL
    // verbatim and bypassed = the same URL plus `nowprocket=1` (appended to
    // whatever search the page already carries — the harness's own tab
    // identity suffix included).
    expect(await fixture.page.getAttribute('iframe[title="Cached"]', 'src')).toBe(pageUrl);
    expect(await fixture.page.getAttribute('iframe[title="Not cached"]', 'src')).toBe(
      `${pageUrl}&nowprocket=1`
    );
  });

  test('each side refreshes independently; the other side keeps its body', async ({
    extension
  }) => {
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');

    // The frames keep loading after the open resolves; poll until both have
    // bodies (the server generates a fresh token per request) and keep the
    // captured values as the refresh probes' before-baselines.
    /** @type {string | null} */
    let cachedTokenBefore: string | null = null;
    /** @type {string | null} */
    let bypassedTokenBefore: string | null = null;
    await expect
      .poll(
        async (): Promise<boolean> => {
          cachedTokenBefore = await readFrameToken(fixture.page, 'Cached');
          bypassedTokenBefore = await readFrameToken(fixture.page, 'Not cached');
          return cachedTokenBefore !== null && bypassedTokenBefore !== null;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    expect(cachedTokenBefore, 'a body in the cached frame').toBeTruthy();
    expect(bypassedTokenBefore, 'a body in the bypassed frame').toBeTruthy();

    // Cached-side refresh: its own body goes fresh; the other side's stays.
    await fixture.page.getByRole('button', { name: 'Refresh the cached version' }).click();
    // A mid-reload read reports a vanished document (null contentDocument) —
    // "not the old token" is not a new body; demand a fresh truthy body.
    await expect
      .poll(
        async (): Promise<boolean> => {
          const token = await readFrameToken(fixture.page, 'Cached');
          return token !== null && token !== cachedTokenBefore;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    expect(await readFrameToken(fixture.page, 'Not cached'), 'bypassed body untouched').toBe(
      bypassedTokenBefore
    );

    // Bypassed-side refresh: same independence, mirrored — the cached frame's
    // body is not merely still there but still the EXACT body the cached
    // refresh left (no re-navigation onto the untouched side).
    const cachedBodyAfterRefresh = await readFrameToken(fixture.page, 'Cached');
    expect(cachedBodyAfterRefresh, 'the cached body the refresh left behind').toBeTruthy();
    await fixture.page.getByRole('button', { name: 'Refresh the not-cached version' }).click();
    await expect
      .poll(
        async (): Promise<boolean> => {
          const token = await readFrameToken(fixture.page, 'Not cached');
          return token !== null && token !== bypassedTokenBefore;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    expect(
      await readFrameToken(fixture.page, 'Cached'),
      'cached body untouched by the other refresh'
    ).toBe(cachedBodyAfterRefresh);
  });

  test('close restores html/body overflow and scroll exactly; re-show keeps the frames', async ({
    extension
  }) => {
    const fixture = await openFixturePage(extension, '/side-by-side.html');

    // Fixture baseline (native page state): the inline values the page set.
    const before = await readScrollState(fixture.page);
    expect(before).toMatchObject(FIXTURE_OVERFLOW_BASELINE);

    await fixture.page.evaluate((toY) => {
      window.scrollTo(0, toY);
    }, SCROLLED_TO_Y);
    expect((await readScrollState(fixture.page)).scrollY).toBe(SCROLLED_TO_Y);

    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    const locked = await readScrollState(fixture.page);
    expect(locked, 'the overlay locks page scroll while open').toMatchObject({
      html: 'hidden',
      body: 'hidden'
    });
    // The token is the frame's body identifier; the re-open comparison uses
    // the captured value as the before-state.
    /** @type {string | null} */
    let cachedTokenOpen: string | null = null;
    await expect
      .poll(
        async (): Promise<boolean> => {
          cachedTokenOpen = await readFrameToken(fixture.page, 'Cached');
          return cachedTokenOpen !== null;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    expect(cachedTokenOpen, 'a loaded body behind the open overlay').toBeTruthy();

    // The scroll position just before close is the one the close must
    // preserve (the extension must never reset scroll; the browser's own
    // reflow during the open/lock may clamp the position, so it is
    // re-measured here instead of reusing the pre-open value).
    const scrollYBeforeClose = (await readScrollState(fixture.page)).scrollY;

    await fixture.page.getByRole('button', { name: 'Close the side-by-side comparison' }).click();
    const restored = await readScrollState(fixture.page);
    expect(
      restored,
      'inline overflow restored exactly (html and body), scroll position preserved'
    ).toEqual({
      html: FIXTURE_OVERFLOW_BASELINE.html,
      body: FIXTURE_OVERFLOW_BASELINE.body,
      scrollY: scrollYBeforeClose
    });

    // Re-open shows the previously loaded frames: the overlay mounts once and
    // later opens only reveal it — the cached frame's token must be the exact
    // same body (no re-navigation, so no fresh server token).
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1);
    const cachedTokenAfterReopen = await readFrameToken(fixture.page, 'Cached');
    expect(cachedTokenAfterReopen, 're-open reveals the previous frames (same loaded body)').toBe(
      cachedTokenOpen
    );
  });

  test('scroll sync runs from the open itself — no switch interaction', async ({ extension }) => {
    // The seed mirrors the user's persisted profile (the setting is on, its
    // default): the overlay's OPEN must arm the engine itself. The reported
    // regression: the open path started the engine before the view's render
    // had registered the frames, leaving a "running" session with no
    // listeners — a working sync only after a switch off/on cycle.
    await extension.evaluateInWorker(
      (seed: Record<string, unknown>) => {
        void chrome.storage.sync.set({ options: seed });
      },
      { improvements: {}, features: { sbsScrollSync: true } }
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1);

    // Both halves load their own bodies (and the listener re-adopt runs on
    // the frame load). The untouched half must sit at the top of a real
    // range — sync is the only thing that may move it.
    await expect
      .poll(
        async (): Promise<boolean> => {
          const cached = await readHalfScroll(fixture.page, 'Cached');
          const bypassed = await readHalfScroll(fixture.page, 'Not cached');
          return cached.range > 0 && bypassed.range > 0;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    const atRest = await readHalfScroll(fixture.page, 'Not cached');
    expect(
      atRest.y,
      'the unscrolled half rests at its top — any motion below is sync'
    ).toBeLessThan(atRest.range);

    // Drive ONLY the cached half to its bottom: the user's gesture. Proportional
    // mapping (same document, same frame size ⇒ equal ranges) must deliver the
    // bypassed half to its exact own bottom — rounded, without any toggle.
    await fixture.page.evaluate(() => {
      const frame = document
        .querySelector('wpr-fdt-side-by-side')
        ?.shadowRoot?.querySelector<HTMLIFrameElement>('iframe[title="Cached"]');
      const win = frame?.contentWindow;
      if (frame === null || win === null || win === undefined)
        throw new Error('the cached half is not driveable');
      win.scrollTo(0, win.document.documentElement.scrollHeight);
    });
    await expect
      .poll(
        async (): Promise<boolean> => {
          const half = await readHalfScroll(fixture.page, 'Not cached');
          return half.range > 0 && half.y === half.range;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
  });

  test('the desktop dress gives each half a real desktop-width viewport, live and without navigation', async ({
    extension
  }) => {
    await extension.evaluateInWorker(
      (seed: Record<string, unknown>) => {
        void chrome.storage.sync.set({ options: seed });
      },
      { improvements: {}, features: { sbsDesktopWidth: false, sbsScrollSync: false } }
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1);

    // Fluid dress first: the frame's content box is the half column, well
    // below the desktop floor.
    const cachedToken = (): Promise<string | null> => readFrameToken(fixture.page, 'Cached');
    await expect
      .poll(async () => {
        const cached = await readFrameMedia(fixture.page, 'Cached');
        const bypassed = await readFrameMedia(fixture.page, 'Not cached');
        return !cached && !bypassed && (await cachedToken()) !== null;
      })
      .toBe(true);
    const tokenBeforeDress = await cachedToken();

    // The toggle dress adopts live: both halves' media queries flip to the
    // desktop width without navigation (the body token must survive).
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(2).click();
    await expect
      .poll(
        async (): Promise<boolean> => {
          const cached = await readFrameMedia(fixture.page, 'Cached');
          const bypassed = await readFrameMedia(fixture.page, 'Not cached');
          return cached && bypassed;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
    expect(await cachedToken(), 'the dress reflowed the frames without reloading them').toBe(
      tokenBeforeDress
    );

    // The floor regime is transform-only: a squeezed window rescales without
    // re-navigation, and the in-frame viewport stays at the desktop width.
    const viewportBefore = fixture.page.viewportSize();
    await fixture.page.setViewportSize({ width: 500, height: 320 });
    await expect
      .poll(
        async () =>
          (await readFrameMedia(fixture.page, 'Cached')) &&
          (await readFrameMedia(fixture.page, 'Not cached'))
      )
      .toBe(true);
    expect(await cachedToken(), 'a squeeze below the floor never reloads').toBe(tokenBeforeDress);
    if (viewportBefore) await fixture.page.setViewportSize(viewportBefore);

    // Off restores the fluid dress just as live (matchMedia back to false).
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(2).click();
    await expect
      .poll(
        async (): Promise<boolean> => {
          const cached = await readFrameMedia(fixture.page, 'Cached');
          const bypassed = await readFrameMedia(fixture.page, 'Not cached');
          return !cached && !bypassed;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
  });

  test('the desktop switch yields to the mobile session and returns per the persisted option', async ({
    extension
  }) => {
    await extension.evaluateInWorker(
      (seed: Record<string, unknown>) => {
        void chrome.storage.sync.set({ options: seed });
      },
      { improvements: {}, features: { sbsDesktopWidth: true, sbsScrollSync: false } }
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1);

    // Dressed by the persisted option at the open itself.
    await expect
      .poll(async () => await readFrameMedia(fixture.page, 'Cached'), { timeout: RELOAD_TIMEOUT })
      .toBe(true);

    // Mobile comparison engages: the desktop switch is NOT on the bar at all
    // (never hidden-but-disabled) — sync and mobile are the only switches.
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(1).click();
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`),
      'the desktop switch is gone while the phone session holds'
    ).toHaveCount(2, { timeout: RELOAD_TIMEOUT });

    // Releasing the session re-applies the persisted dress: the preserved
    // choice re-opens the dress willingly — the switch returns and the
    // halves resolve their desktop media queries again.
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(1).click();
    await expect
      .poll(async () => await readFrameMedia(fixture.page, 'Not cached'), {
        timeout: RELOAD_TIMEOUT
      })
      .toBe(true);
    await expect
      .poll(
        () =>
          fixture.page
            .locator(`${OVERLAY_HOST_NAME} input[role="switch"]`)
            .evaluateAll((switches: Element[]) => switches.length),
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(3);
  });

  test('the phone devices gather as a centered pair with a small fixed step, live across resizes', async ({
    extension
  }) => {
    await extension.evaluateInWorker(
      (seed: Record<string, unknown>) => {
        void chrome.storage.sync.set({ options: seed });
      },
      { improvements: {}, features: { sbsDesktopWidth: false, sbsScrollSync: false } }
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1);

    // Engage the mobile session: the phone dress is the pair's context. The
    // halves hold their navigation until both fits exist, so a settled dress
    // is a measured one (the geometry below reads the fitted boxes).
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(1).click();
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-half--phone`),
      'the phone dress holds both halves'
    ).toHaveCount(2, { timeout: RELOAD_TIMEOUT });

    /**
     * Wait out the pair's rescale at the current window size, then assert
     * the gathered contract on a settled read: a small fixed step between
     * the devices (the facing borders' 8px), the pair centered over the
     * frames row on both axes, and neither device leaving it. The poll
     * rides the rescale: a measurement lands a frame after each class or
     * window change, and the transient can read one frame wide.
     */
    const assertGatheredPair = async (): Promise<void> => {
      await expect
        .poll(async () => {
          const pair = await readPairGeometry(fixture.page);
          return pair !== null && pairIsGathered(pair);
        })
        .toBe(true);
      const pair = await readPairGeometry(fixture.page);
      if (pair === null) throw new Error('the phone pair left the DOM between poll and read');
      const gap = pair.bypassed.left - pair.cached.right;
      expect(gap, 'the devices sit the small fixed step apart').toBeGreaterThanOrEqual(7.5);
      expect(gap, 'the step stays small at every window size').toBeLessThanOrEqual(8.5);
      expect(
        Math.abs(
          (pair.cached.left + pair.bypassed.right) / 2 - (pair.frames.left + pair.frames.right) / 2
        ),
        'the pair is centered over the frames row'
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(
          (pair.cached.top + pair.cached.bottom) / 2 - (pair.frames.top + pair.frames.bottom) / 2
        ),
        "the devices ride the frames row's vertical center"
      ).toBeLessThanOrEqual(1);
      expect(
        pair.cached.left,
        'the cached device stays inside the frames row (no overflow at the squeeze)'
      ).toBeGreaterThanOrEqual(pair.frames.left - 0.5);
      expect(
        pair.bypassed.right,
        'the bypassed device stays inside the frames row (no overflow at the squeeze)'
      ).toBeLessThanOrEqual(pair.frames.right + 0.5);
    };

    await assertGatheredPair();
    const viewportBefore = fixture.page.viewportSize();
    // Wide (the old letterboxing spread the pair apart here), mid, and the
    // tier's standing squeeze: the gathered contract holds at all of them.
    for (const size of [
      { width: 1600, height: 900 },
      { width: 1000, height: 700 },
      { width: 500, height: 320 }
    ]) {
      await fixture.page.setViewportSize(size);
      await assertGatheredPair();
    }
    if (viewportBefore) await fixture.page.setViewportSize(viewportBefore);

    // Disengage before the close: the mobile target persists in the worker's
    // options and the tier shares one profile — a later row's open must not
    // converge to the phone dress.
    await fixture.page.locator(`${OVERLAY_HOST_NAME} input[role="switch"]`).nth(1).click();
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-half--phone`),
      'the disengage returns the halves to the sessionless dress'
    ).toHaveCount(0, { timeout: RELOAD_TIMEOUT });
    await fixture.page.close();
  });

  test('the persisted desktop dress survives the fixture page reloading itself (the restore path)', async ({
    extension
  }) => {
    await extension.evaluateInWorker(
      (seed: Record<string, unknown>) => {
        void chrome.storage.sync.set({ options: seed });
      },
      { improvements: {}, features: { sbsDesktopWidth: true, sbsScrollSync: false } }
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect
      .poll(async () => await readFrameMedia(fixture.page, 'Cached'), { timeout: RELOAD_TIMEOUT })
      .toBe(true);

    // The host reloaded itself: the next boot restores the overlay (no switch
    // interaction) and the open re-reads the persisted dress before the
    // reveal — the halves are desktop-width again.
    await fixture.page.reload({ waitUntil: 'load' });
    await expect(
      fixture.page.locator(`${OVERLAY_HOST_NAME} .sbs-overlay.sbs-overlay--open`)
    ).toHaveCount(1, { timeout: RELOAD_TIMEOUT });
    await expect
      .poll(
        async (): Promise<boolean> => {
          const cached = await readFrameMedia(fixture.page, 'Cached');
          const bypassed = await readFrameMedia(fixture.page, 'Not cached');
          return cached && bypassed;
        },
        { timeout: RELOAD_TIMEOUT }
      )
      .toBe(true);
  });
});
