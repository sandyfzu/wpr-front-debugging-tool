/**
 * Suite 5 — Processed-page pipeline.
 *
 * Every page the content script processes reports itself: the mandated
 * timing log line (`[WPR FDT] Page data processed in X ms` — the master
 * §1.3 format), the organized page-analysis print that follows it, and the
 * best-effort summary push, observable at the service-worker seam as the
 * toolbar badge state for that tab.
 *
 * Assert surfaces (named per assert below): the page console (Playwright
 * console events, content-script source attributed), and the `chrome.action`
 * badge state evaluated in the SW (the push's receiving surface; the panel
 * chain renders it later in its own phase).
 */

import { expect, openFixturePage, test } from '../helpers/extension';

/** The log prefix every extension-owned console line starts with. */
const LOG_PREFIX = '[WPR FDT]';

/** The mandated timing log's exact shape (the master plan's format contract). */
const TIMED_LOG_PATTERN = /^\[WPR FDT\] Page data processed in \d+(?:\.\d+)? ms$/;

/** The badge dot glyph — presence is in its color, not in text. */
const BADGE_DOT = '●';

/** Transparent tile: the background action color (fixed browser-chrome value). */
const TRANSPARENT_TILE: [number, number, number, number] = [0, 0, 0, 0];

/** Console info lines about page processing. */
interface ConsoleLine {
  type: string;
  text: string;
}

/**
 * Normalize the badge color API's answer to a canonical `r-g-b` string.
 *
 * @param color The `chrome.action` color answer (an RGBA array per the
 *   committed `@types/chrome`; the suite trips hard on any other shape).
 */
function canonicalRgb(color: readonly number[]): string {
  const [r, g, b] = color;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`Badge color answer had fewer than three channels: ${JSON.stringify(color)}`);
  }
  return `${String(r)}-${String(g)}-${String(b)}`;
}

/** Standard polling profile for the badge seam (post-processing delivery). */
const POLLED_BADGE_OPTIONS: { timeout: number; intervals: number[] } = {
  timeout: 8_000,
  intervals: [100, 100, 250, 500]
};

test.describe('processed-page pipeline', () => {
  test('the timing log prints in the mandated format exactly once per page', async ({
    extension
  }) => {
    /** @type {ConsoleLine[]} */
    const consoleInfo: ConsoleLine[] = [];
    await openFixturePage(extension, '/pipeline/markers.html', undefined, (page) => {
      page.on('console', (message) => {
        if (message.type() === 'info' && message.text().startsWith(LOG_PREFIX)) {
          consoleInfo.push({ type: message.type(), text: message.text() });
        }
      });
    });

    const timingLog = consoleInfo.filter((line) => TIMED_LOG_PATTERN.test(line.text));
    expect(
      timingLog,
      `one "[WPR FDT] Page data processed in X ms" line (got: ${consoleInfo.map((l) => l.text).join(' | ')})`
    ).toHaveLength(1);

    // The organized page-analysis print rides the same pass (info level).
    expect(
      consoleInfo.some((line) => line.text.startsWith(`${LOG_PREFIX} Page analysis`)),
      'the page-analysis console print follows the timing line'
    ).toBe(true);
  });

  test('the summary push lands at the SW badge seam with per-page state', async ({ extension }) => {
    const markerFixture = await openFixturePage(extension, '/pipeline/markers.html');
    const plainFixture = await openFixturePage(extension, '/pipeline/plain.html');

    // The marker page's engine output reports WP Rocket present and served
    // cached, so the push must arrive at the background for the marker tab.
    const fdt = await extension.sendToTab<{
      wprDetections?: { wpr?: { present?: boolean; cached?: boolean } };
    } | null>(markerFixture.tabId, 'getFdtData');
    expect(fdt?.wprDetections?.wpr?.present, 'engine reads WP Rocket on the marked fixture').toBe(
      true
    );
    expect(fdt?.wprDetections?.wpr?.cached, 'the cached debug marker reports cached').toBe(true);

    // Badge seam (SW state): a dot was rendered for the marker tab...
    await expect
      .poll(
        async () =>
          await extension.evaluateInWorker(
            async (tabId: number) => await chrome.action.getBadgeText({ tabId }),
            markerFixture.tabId
          ),
        POLLED_BADGE_OPTIONS
      )
      .toBe(BADGE_DOT);

    // ...its color is the cached state, over the transparent tile...
    const markerColor = await extension.evaluateInWorker(
      async (tabId: number) => await chrome.action.getBadgeTextColor({ tabId }),
      markerFixture.tabId
    );
    const markerTile = await extension.evaluateInWorker(
      async (tabId: number) => await chrome.action.getBadgeBackgroundColor({ tabId }),
      markerFixture.tabId
    );
    expect(markerTile, 'badge tile stays transparent (the dot glyph carries the color)').toEqual(
      TRANSPARENT_TILE
    );

    // ...and the unmarked page reports its absence state with a DIFFERENT dot
    // color (every processed page states itself; the color is the state).
    await expect
      .poll(
        async () =>
          await extension.evaluateInWorker(
            async (tabId: number) => await chrome.action.getBadgeText({ tabId }),
            plainFixture.tabId
          ),
        POLLED_BADGE_OPTIONS
      )
      .toBe(BADGE_DOT);
    const plainColor = await extension.evaluateInWorker(
      async (tabId: number) => await chrome.action.getBadgeTextColor({ tabId }),
      plainFixture.tabId
    );
    expect(canonicalRgb(markerColor), 'the cached state reads green').toBe('26-127-55');
    expect(canonicalRgb(plainColor), 'the no-rocket state reads gray').toBe('110-119-129');
  });
});
