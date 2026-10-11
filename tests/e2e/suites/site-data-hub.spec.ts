/**
 * P4.3 suite 4 — the data hub on real WP Rocket pages.
 *
 * The fixture pipeline suite pins the log contract over fixture pages; this
 * suite re-proves it over the real site's optimized pages and covers the
 * two flows the fixtures cannot produce: the WP Rocket runtime's
 * `rocket-allScriptsLoaded` window event and the real site's scripted
 * undefined-reference capture round trip.
 *
 * Assert surfaces (named per assert): the page console (Playwright console
 * events) for the log contract, and the `getFdtData` payload for the served
 * flag/words.
 *
 * Real-page facts (verified against the live stack): `/fdt/` is cache-served
 * with the WP Rocket optimization runtime, whose delay queue waits for the
 * first user interaction before `rocket-allScriptsLoaded` dispatches;
 * `?fdt-error=reference` pages throw a scripted ReferenceError at load; a
 * unique `fdt-delay` value makes a cacheable URL that is first-hit
 * (live-optimized) for exactly this run.
 */

import { expect, test } from '../helpers/extension';
import { openSitePage, SITE_URL } from '../helpers/site';

/** The log prefix every extension-owned console line starts with. */
const LOG_PREFIX = '[WPR FDT]';

/** The mandated timing log's exact shape (the master plan's format contract). */
const TIMED_LOG_PATTERN = /^\[WPR FDT\] Page data processed in \d+(?:\.\d+)? ms$/;

/** The page's distinctive content marker (must never appear in our logs). */
const PAGE_HEADING = 'Debug fixture hub';

/** Console lines collected from one page. */
interface ConsoleLine {
  type: string;
  text: string;
}

test.describe('site data hub', () => {
  test('the real site page prints the mandated timing log once, then the analysis', async ({
    extension
  }) => {
    const consoleInfo: ConsoleLine[] = [];
    const page = await openSitePage(extension, `${SITE_URL}/fdt/`, (p) => {
      p.on('console', (message) => {
        if (message.type() === 'info' && message.text().startsWith(LOG_PREFIX)) {
          consoleInfo.push({ type: message.type(), text: message.text() });
        }
      });
    });

    const timingLog = consoleInfo.filter((line) => TIMED_LOG_PATTERN.test(line.text));
    expect(
      timingLog,
      `one exact timing line (got: ${consoleInfo.map((l) => l.text).join(' | ')})`
    ).toHaveLength(1);
    expect(
      consoleInfo.some((line) => line.text.startsWith(`${LOG_PREFIX} Page analysis`)),
      'the organized page-analysis print follows on the real page'
    ).toBe(true);
    await page.page.close();
  });

  test('extension console output stays whitelisted: only non-content lines', async ({
    extension
  }) => {
    const ourLines: string[] = [];
    const pageErrors: string[] = [];
    // A unique cacheable value → a real, live-optimized page for this run.
    const sweepUrl = `${SITE_URL}/fdt/?fdt-delay=${String(Date.now())}`;
    const page = await openSitePage(extension, sweepUrl, (p) => {
      p.on('console', (message) => {
        if (message.text().startsWith(LOG_PREFIX)) ourLines.push(message.text());
      });
      p.on('pageerror', (error) => pageErrors.push(error.message));
    });

    // Every OUR line is one of the two whitelisted shapes...
    for (const text of ourLines) {
      const whitelisted =
        TIMED_LOG_PATTERN.test(text) || text.startsWith(`${LOG_PREFIX} Page analysis`);
      if (!whitelisted) {
        throw new Error(`Un-whitelisted extension console line: ${text}`);
      }
    }
    expect(ourLines.length, 'the two mandated lines did print').toBeGreaterThanOrEqual(2);

    // ...and none carries page content (the page's heading, or markup).
    for (const text of ourLines) {
      expect(
        text.includes(PAGE_HEADING),
        `our console output must not carry page content: ${text}`
      ).toBe(false);
      expect(text.includes('<'), `our console output must not carry markup: ${text}`).toBe(false);
    }
    // A healthy, live-optimized page also throws nothing of its own.
    expect(pageErrors, 'the healthy page threw no errors').toEqual([]);
    await page.page.close();
  });

  test('the rocket-allScriptsLoaded window event flips the served flag', async ({ extension }) => {
    const page = await openSitePage(extension, `${SITE_URL}/fdt/`);
    const pullFlag = async (): Promise<boolean | null> =>
      await extension
        .sendToTab<{ allScriptsLoaded: boolean } | null>(page.tabId, 'getFdtData')
        .then((fdt) => fdt?.allScriptsLoaded ?? null);
    expect(await pullFlag(), 'the flag starts false (no event yet)').toBe(false);

    // The delay runtime's queue waits for the first user interaction; a real
    // dispatched mousedown triggers it, the delayed scripts run, and the
    // runtime dispatches rocket-allScriptsLoaded on the window. No devtools
    // panel is open: the served flag is the observable (the push to the
    // panels is expected to skip at debug level).
    await page.page.mouse.move(300, 300);
    await page.page.mouse.down();
    await page.page.mouse.up();
    await expect.poll(pullFlag, { timeout: 10_000, intervals: [250, 500] }).toBe(true);
    await page.page.close();
  });

  test('the real site error page delivers its undefined references through the hub', async ({
    extension
  }) => {
    // Same flag set as the fixture round, on the real site: the MAIN-world
    // capture → window bridge → hub merge → served words.
    const flaggedUrl = `${SITE_URL}/?fdt-error=reference&fdt-delay=${String(Date.now())}`;
    const page = await openSitePage(extension, flaggedUrl);
    const pullWords = async (): Promise<string[] | null> =>
      await extension
        .sendToTab<{ undefinedReferencesOnPage: string[] } | null>(page.tabId, 'getFdtData')
        .then((fdt) => fdt?.undefinedReferencesOnPage ?? null);
    await expect
      .poll(async () => (await pullWords())?.includes('fdtFixtureReference') ?? false, {
        timeout: 10_000,
        intervals: [250, 500]
      })
      .toBe(true);
    await page.page.close();
  });
});
