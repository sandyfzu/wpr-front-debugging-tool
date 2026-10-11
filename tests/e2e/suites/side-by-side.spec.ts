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
});
