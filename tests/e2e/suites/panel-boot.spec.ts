/**
 * The panel's boot through the devtools-contract data path: with a real
 * inspected tab and its content-script-processed page, the panel renders its
 * ready state from the fixture's real detection output — the page body, the
 * honest first-paint strip, the nav rows' live state — and nothing of the
 * error state.
 *
 * The harness's seam (`helpers/panel-data.ts`) writes only the value Chrome
 * itself provides inside a real DevTools window (`devtools.inspectedWindow.
 * tabId`); everything the assertions read below is shipped panel code talking
 * to a real content script over the real runtime contract. The seam's one
 * writable value is also what keeps the deep-link and reload legs here
 * honest: the hash and the reload are the browser's own, and the boot flight
 * re-resolves both itself.
 *
 * The error boot's RENDER is the standing `panel-nav` suite's pin (the
 * standalone boot's recorded error); this suite adds the missing leg of the
 * same surface — the retry control actually re-running the flight — on a
 * seamless standalone page (no inspected tab ⇒ the same recorded error, so
 * the affordance is exercised where its failure mode lives). Note on the
 * strip's exact values: the depth of the four segments (ages, stamps,
 * navigation) is the status-bar suite's row; this suite pins "the ready boot
 * renders real answers from the data path".
 */
import type { Page } from '@playwright/test';
import { expect, panelPageUrl, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';

/** The route body's single heading (the ready body's first observable). */
function h1(panel: Page): Promise<string | null> {
  return panel.evaluate(
    (): string | null => document.querySelector('[data-fdt-page] h1')?.textContent ?? null
  );
}

/** The strip's rendered answers (boot-honest answers are whole strings). */
function stripText(page: Page): Promise<string | null> {
  return page.evaluate(
    (): string | null =>
      document.querySelector('[data-fdt="panel-status-bar"]')?.textContent ?? null
  );
}

test.describe('panel ready boot (the devtools-contract data path)', () => {
  test('renders the ready state from the fixture page’s real detections', async ({ extension }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      // The settle: the boot flight resolves into the requested page's tab —
      // the poll ends only on the ready body (a hung flight fails here).
      await expect
        .poll(async () => await h1(panel), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toBe('Detections');

      // No error view anywhere: the ready state is the whole answer.
      expect(await panel.getByText("Couldn't load page data").count()).toBe(0);

      // The machine announces the ready settle through the live region.
      expect(
        await panel.evaluate(
          (): string | null =>
            document.querySelector<HTMLElement>('[data-fdt="panel-status"]')?.textContent ?? null
        )
      ).toBe('Detections loaded');

      // The first-paint strip answers from the fixture's real detection: the
      // marked fixture carries the generator meta (version) plus the served
      // cache-debug comment (cached) — the engine's own facts, never injected.
      expect(await stripText(panel)).toContain('WP Rocket 3.20.1');
      expect(await stripText(panel)).toContain('Cached');

      // The nav's live-state selectors see the same data: the fixture never
      // dispatches the all-scripts-loaded event, so the undefined-references
      // row's chip honestly reads "Monitoring" until it does.
      await panel.getByRole('link', { name: 'Undefined References' }).focus();
      const tooltip = panel.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      await expect(tooltip).toContainText('Monitoring');

      // The "Monitoring" chip rides the panel's own machine state: the panel
      // received the served payload (false flag; the event lands on real
      // WP Rocket–served pages, not on this fixture).
      const served = await extension.sendToTab<{
        wprDetections: {
          wpr: {
            present: boolean;
            version: string | null;
            cacheMarkerFound: boolean;
            cached: boolean;
            timeStamp: number | null;
          };
        };
        allScriptsLoaded: boolean;
      } | null>(fixture.tabId, 'getFdtData');
      expect(served?.wprDetections.wpr).toEqual({
        present: true,
        version: '3.20.1',
        cacheMarkerFound: true,
        cached: true,
        timeStamp: 1791342253
      });
      expect(served?.allScriptsLoaded).toBe(false);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('boots on a deep link and stays the fixture’s data across the route swap', async ({
    extension
  }) => {
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    try {
      await expect
        .poll(async () => await h1(panel), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toBe('Detections');

      // Scoped to the nav: page bodies may carry links naming the same page
      // (e.g. the Detections cards' "Open Lazyload").
      await panel
        .getByRole('navigation', { name: 'WPR FDT pages' })
        .getByRole('link', { name: 'Lazyload' })
        .click();
      await panel.waitForURL(/#\/lazyload$/);
      await expect.poll(async () => await h1(panel)).toBe('Lazyload');

      // The strip is shell-owned: the route swap never resets its answers.
      expect(await stripText(panel)).toContain('WP Rocket 3.20.1');
      expect(await stripText(panel)).toContain('Cached');
      expect(await panel.getByText("Couldn't load page data").count()).toBe(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('a hash deep link boots into its route and survives a panel-document reload', async ({
    extension
  }) => {
    // Bookmarked/reshared panel links: the boot parses the hash first
    // (never the default route), and reloading the panel document — the
    // devtools re-attach shape — lands the same route with fresh data.
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      bootHash: '#/lazyload'
    });
    try {
      await expect
        .poll(async () => await h1(panel), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toBe('Lazyload');
      expect(
        await panel.evaluate(
          (): string | null =>
            document.querySelector('[aria-current="page"]')?.getAttribute('href') ?? null
        )
      ).toBe('#/lazyload');

      // The devtools re-attach: a real document reload — the browser keeps
      // the hash, the boot parses it again, and the flight re-resolves. The
      // settle must land the SAME route from the hash, never the default.
      await panel.reload({ waitUntil: 'load' });
      await expect
        .poll(async () => await h1(panel), {
          timeout: 15_000,
          intervals: [50, 100, 250]
        })
        .toBe('Lazyload');
      expect(
        await panel.evaluate(
          (): string | null =>
            document.querySelector('[aria-current="page"]')?.getAttribute('href') ?? null
        )
      ).toBe('#/lazyload');
      expect(await panel.getByText("Couldn't load page data").count()).toBe(0);
    } finally {
      await panel.close();
      await fixture.page.close();
    }
  });

  test('the error state’s retry control re-runs the boot flight (and settles honestly)', async ({
    extension
  }) => {
    // The standalone boot: no inspected tab ⇒ no data source reachable — the
    // recorded error state with its retry affordance.
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      const errorTitle = page.getByText("Couldn't load page data");
      await expect(errorTitle).toBeVisible();

      // The retry: a real click, a real re-flight that settles IN PLACE —
      // the JS realm survives (data errors keep their in-page recovery;
      // only a contract-validation failure reloads), and the error view is
      // rendered again with one of the store's two in-flight causes. Which
      // of them is not this tier's fact: the runtime's classification
      // depends on the service worker's listener-registration race at the
      // first broadcast (both render the same actionable view; the
      // classification per failure shape is pinned in the store's unit
      // tests).
      const realm = await page.evaluate(
        (): number => ((window as { __e2eRealm?: number }).__e2eRealm = Date.now())
      );
      await page.getByRole('button', { name: 'Retry' }).click();
      await expect(errorTitle).toBeVisible();
      expect(
        await page.evaluate(
          (value: number): boolean => (window as { __e2eRealm?: number }).__e2eRealm === value,
          realm
        )
      ).toBe(true);
      const cause = await page.evaluate((): string => document.body.textContent);
      expect(
        cause.includes('The inspected page has no data source reachable') ||
          cause.includes('The page could not be reached for its data.'),
        `the error view carries one of the two in-flight causes (${cause.slice(0, 200)})`
      ).toBe(true);
    } finally {
      await page.close();
    }
  });
});
