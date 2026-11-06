/**
 * LCP & Vitals browser acceptance (P14.1 box 2), in Chromium:
 *
 * - golden + live: the panel's candidates and parts equal the browser's own
 *   entries for the same visit (read in the page: candidate count, order,
 *   element, URL, size, time; total = the last candidate; Time to first byte
 *   = the navigation's `responseStart`; Resource load time = the image's
 *   download), and the parts add up to the total;
 * - the opt-in frame leaves the page exactly as it was (markup, the LCP
 *   element's attributes and box) after its 5 s, and — in a browser of this
 *   suite's own — at once when the extension context is invalidated (an
 *   extension reload), where the injected beacon runner also reports itself
 *   dead;
 * - vitals reducer states: INP "No data" before any interaction, CLS measured
 *   from a real layout shift;
 * - a real back/forward-cache restore (own browser, cache kept): the panel
 *   reads the restored page again, LCP is not re-measured; a missing restore
 *   fails with the browser's not-restored reasons (the extension must never
 *   block the cache) — and a real prerender activation, as far as this
 *   Chromium performs it (the browser's own reason recorded when it does not).
 */
import { rmSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { expect, test, ExtensionDriver } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import { probePage, toggleSwitch } from '../helpers/live-tools';

/** The frame's host element on the inspected page. */
const HIGHLIGHT_HOST = 'wpr-fdt-lcp-highlight';

/** The opt-in switch's label. */
const FRAME_SWITCH = 'Frame the LCP element on the page (5 s)';

/**
 * Back/forward-cache "not restored" reasons proven to come from the host
 * environment, never from the extension: Chromium reports exactly these two
 * when the browser runs with `--disable-back-forward-cache` (Playwright's
 * default switch) and neither when it is dropped. Only a miss whose every
 * reason is in this set may skip (annotated); any other reason fails.
 */
const HOST_ENVIRONMENT_BFCACHE_REASONS: ReadonlySet<string> = new Set([
  'BackForwardCacheDisabled',
  'BackForwardCacheDisabledByCommandLine'
]);

/** One node of Chromium's `Page.backForwardCacheNotUsed` explanation tree. */
interface NotRestoredTree {
  readonly explanations?: readonly { readonly reason: string }[];
  readonly children?: readonly NotRestoredTree[];
}

/**
 * Every reason in a not-restored explanation tree (the frame and its children).
 *
 * @param node The tree's root.
 */
function notRestoredReasons(node: NotRestoredTree): string[] {
  return [
    ...(node.explanations ?? []).map((item) => item.reason),
    ...(node.children ?? []).flatMap(notRestoredReasons)
  ];
}

/** One LCP entry as the page's own observer reports it. */
interface PageLcpEntry {
  readonly element: string | null;
  readonly url: string;
  readonly size: number;
  readonly startTime: number;
}

/** What the page itself measured: its LCP entries, navigation and the LCP image's download. */
interface PageTruth {
  readonly entries: readonly PageLcpEntry[];
  readonly responseStart: number;
  readonly imageLoad: number | null;
}

/**
 * Read the page's own LCP entries and timings (main world, the browser's buffered entries).
 *
 * @param page The fixture page.
 */
async function pageTruth(page: Page): Promise<PageTruth> {
  return await page.evaluate(
    () =>
      new Promise<PageTruth>((resolve) => {
        new PerformanceObserver((list, observer) => {
          observer.disconnect();
          const entries = (list.getEntries() as LargestContentfulPaint[]).map((entry) => ({
            element: entry.element === null ? null : entry.element.tagName.toLowerCase(),
            url: entry.url,
            size: entry.size,
            startTime: entry.startTime
          }));
          const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
          const last = entries.at(-1);
          const image = performance
            .getEntriesByType('resource')
            .filter((entry) => last !== undefined && entry.name === last.url)
            .at(-1) as PerformanceResourceTiming | undefined;
          resolve({
            entries,
            responseStart: nav.responseStart,
            imageLoad: image === undefined ? null : image.responseEnd - image.requestStart
          });
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      })
  );
}

/**
 * Parse a shown `1,234 ms` value.
 *
 * @param text The shown text.
 */
function ms(text: string | null): number {
  const match = /([\d,]+) ms/.exec(text ?? '');
  if (match === null) throw new Error(`no ms value in ${String(text)}`);
  return Number(match[1]?.replaceAll(',', ''));
}

/** Open the LCP & Vitals route and wait for the vitals' first read. */
async function openPage(panel: Page): Promise<void> {
  await panel.evaluate(() => {
    location.hash = '#/lcp-vitals';
  });
  await expect(panel.getByRole('heading', { level: 1, name: 'LCP & Vitals' })).toBeVisible();
  await expect(panel.locator('[data-fdt-vital="lcp"]')).toBeVisible();
}

/** Analyse and wait for the outcome. */
async function analyse(panel: Page): Promise<void> {
  await panel.locator('[data-fdt-lcp-analyse]').click();
  await expect(panel.locator('[data-fdt-lcp-analyse]')).toBeEnabled();
  await expect(panel.locator('[data-fdt="lcp-outcome"]')).toBeVisible();
}

/** The page's markup and the hero's own state, as one comparable snapshot. */
async function heroState(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const hero = document.getElementById('hero');
    const box = hero?.getBoundingClientRect();
    // The page's own markup: the extension's shadow hosts (`wpr-fdt-*`) left out.
    const page = document.documentElement.cloneNode(true) as HTMLElement;
    for (const host of page.querySelectorAll('*')) {
      if (host.tagName.toLowerCase().startsWith('wpr-fdt-')) host.remove();
    }
    return JSON.stringify({
      html: page.outerHTML,
      attributes:
        hero === null
          ? null
          : hero.getAttributeNames().map((name) => [name, hero.getAttribute(name)]),
      style: hero?.style.cssText ?? null,
      box: box === undefined ? null : [box.x, box.y, box.width, box.height]
    });
  });
}

/**
 * A suite-owned browser (its extension can be reloaded or its cache kept without
 * touching the shared one).
 *
 * @param backForwardCache Keep Chromium's back/forward cache.
 */
async function ownBrowser(backForwardCache: boolean): Promise<ExtensionDriver> {
  return await ExtensionDriver.launch(
    (profileDir) => {
      rmSync(profileDir, { recursive: true, force: true });
    },
    { backForwardCache }
  );
}

test('golden + live: candidates and parts equal the page’s own entries; the frame restores exactly', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/lcp/hero.html');
  try {
    await openPage(panel);
    await analyse(panel);
    await expect(panel.locator('[data-fdt="lcp-outcome"]')).toHaveAttribute(
      'data-fdt-lcp-outcome',
      'analysed'
    );
    const truth = await pageTruth(fixture.page);

    // Golden: the hero image is this fixture's LCP (the heading's text paints
    // first; when both land in one frame Chromium reports the larger only).
    expect(truth.entries.at(-1)?.element).toBe('img');
    const rows = panel.locator('[data-fdt-lcp-candidate]');
    await expect(rows).toHaveCount(truth.entries.length);
    await expect(rows.last()).toContainText('img#hero.hero.wide');
    await expect(rows.last()).toContainText('LCP');
    if (truth.entries.length > 1) {
      await expect(rows.first()).toContainText('h1');
      await expect(rows.first()).toContainText('Text');
    }

    // Live: every shown value is the browser's own for this visit.
    for (const [index, entry] of truth.entries.entries()) {
      const row = rows.nth(index);
      await expect(row).toContainText(`${Math.round(entry.size).toLocaleString('en-US')} px²`);
      const shownTime = ms(await row.locator('.tabular-nums').nth(1).textContent());
      expect(Math.abs(shownTime - entry.startTime)).toBeLessThanOrEqual(1);
      if (entry.url !== '') await expect(row).toContainText(new URL(entry.url).pathname);
    }
    const last = truth.entries.at(-1);
    if (last === undefined) throw new Error('the page reported no LCP entry');
    const total = ms(await panel.locator('[data-fdt-lcp-total]').textContent());
    expect(Math.abs(total - last.startTime)).toBeLessThanOrEqual(1);
    const part = async (key: string): Promise<number> =>
      ms(await panel.locator(`[data-fdt-lcp-part="${key}"]`).textContent());
    const keys = await panel
      .locator('[data-fdt-lcp-part]')
      .evaluateAll((parts) => parts.map((element) => element.getAttribute('data-fdt-lcp-part')));
    expect(keys).toHaveLength(4);
    const [ttfbKey, , loadKey] = keys;
    expect(Math.abs((await part(String(ttfbKey))) - truth.responseStart)).toBeLessThanOrEqual(1);
    if (truth.imageLoad === null) throw new Error('the hero kept no resource timing');
    expect(Math.abs((await part(String(loadKey))) - truth.imageLoad)).toBeLessThanOrEqual(1);
    let sum = 0;
    for (const key of keys) sum += await part(String(key));
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(2);

    // The frame: shown, then gone after its 5 s, the page exactly as before.
    const before = await heroState(fixture.page);
    await toggleSwitch(panel, FRAME_SWITCH);
    await analyse(panel);
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(1);
    const shownAt = Date.now();
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(0, { timeout: 8_000 });
    expect(Date.now() - shownAt).toBeGreaterThanOrEqual(4_000);
    expect(await heroState(fixture.page)).toBe(before);
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('vitals reducer states on a real page: INP no data before input, CLS from a real shift', async ({
  extension
}) => {
  const { panel, fixture } = await openPanelForFixture(extension, '/lcp/shift.html');
  try {
    // The panel tab hid the page: a hidden page renders nothing, so it shifts nothing.
    await fixture.page.bringToFront();
    await expect
      .poll(
        () =>
          fixture.page.evaluate(() =>
            document.getElementById('inserted') !== null ? 'inserted' : document.readyState
          ),
        { timeout: 10_000 }
      )
      .toBe('inserted');
    await openPage(panel);
    const cls = panel.locator('[data-fdt-vital="cls"]');
    const inp = panel.locator('[data-fdt-vital="inp"]');
    await expect(async () => {
      await panel.locator('[data-fdt-vitals-refresh]').click();
      await expect(cls).toHaveAttribute('data-fdt-vital-state', 'measured', { timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
    const shown = Number(/(\d+\.\d+)/.exec((await cls.textContent()) ?? '')?.[1]);
    const truth = await fixture.page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          new PerformanceObserver((list, observer) => {
            observer.disconnect();
            resolve(
              (
                list.getEntries() as (PerformanceEntry & {
                  value: number;
                  hadRecentInput: boolean;
                })[]
              )
                .filter((entry) => !entry.hadRecentInput)
                .reduce((sum, entry) => sum + entry.value, 0)
            );
          }).observe({ type: 'layout-shift', buffered: true });
        })
    );
    expect(truth).toBeGreaterThan(0);
    expect(Math.abs(shown - truth)).toBeLessThanOrEqual(0.001);
    await expect(inp).toHaveAttribute('data-fdt-vital-state', 'no-data');
    await expect(panel.locator('[data-fdt-vital="lcp"]')).toHaveAttribute(
      'data-fdt-vital-state',
      'measured'
    );
  } finally {
    await panel.close();
    await fixture.page.close();
  }
});

test('extension reload: the shown frame leaves at once, the injected runner reports itself dead', async () => {
  const own = await ownBrowser(false);
  try {
    const { panel, fixture } = await openPanelForFixture(own, '/lcp/hero.html');
    const probe = await probePage(fixture.page, await own.extensionId());
    const before = await heroState(fixture.page);

    // Inject the beacon runner (a real run), then show the frame.
    await own.evaluateInWorker(
      () =>
        chrome.storage.local.set({
          'beacon-test-settings': {
            aboveTheFold: true,
            lazyRender: false,
            widthThreshold: '1000',
            heightThreshold: '600'
          }
        }),
      undefined
    );
    await panel.evaluate(() => {
      location.hash = '#/beacon-tester';
    });
    await panel.locator('[data-fdt-beacon-run]').click();
    await expect(panel.locator('[data-fdt="beacon-outcome"]')).toHaveAttribute(
      'data-fdt-beacon-outcome',
      'completed'
    );
    expect(await probe.inIsolatedWorld<boolean>('globalThis.__wprFdtBeaconRunner.alive()')).toBe(
      true
    );
    await openPage(panel);
    await toggleSwitch(panel, FRAME_SWITCH);
    await analyse(panel);
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(1);
    const shownAt = Date.now();

    // Reload the extension: this page's content scripts lose their context.
    await own
      .evaluateInWorker(() => {
        chrome.runtime.reload();
      }, undefined)
      .catch(() => undefined);
    await expect(fixture.page.locator(HIGHLIGHT_HOST)).toHaveCount(0, { timeout: 3_000 });
    expect(Date.now() - shownAt, 'left before its 5 s countdown').toBeLessThan(4_500);
    expect(await heroState(fixture.page)).toBe(before);
    expect(await probe.inIsolatedWorld<boolean>('globalThis.__wprFdtBeaconRunner.alive()')).toBe(
      false
    );
    await probe.close();
  } finally {
    await own.close('lcp acceptance: extension reload');
  }
});

test('real back/forward-cache restore: LCP not measured again, the restore noted', async () => {
  const own = await ownBrowser(true);
  try {
    const { panel, fixture } = await openPanelForFixture(own, '/lcp/hero.html');
    await openPage(panel);
    await expect(panel.locator('[data-fdt-vital="lcp"]')).toHaveAttribute(
      'data-fdt-vital-state',
      'measured'
    );
    // An analysis stamped with this load: it reads stale on any other page load.
    await analyse(panel);
    await expect(panel.locator('[data-fdt-lcp-stale]')).toHaveCount(0);
    await fixture.page.evaluate(() => {
      addEventListener('pageshow', (event) => {
        (window as unknown as { fdtRestored: boolean }).fdtRestored = event.persisted;
      });
    });
    // The browser's own account of a missed restore (the page's
    // `notRestoredReasons` stays null when the cache is off browser-wide).
    const cdp = await fixture.page.context().newCDPSession(fixture.page);
    const notUsed: NotRestoredTree[] = [];
    cdp.on(
      'Page.backForwardCacheNotUsed',
      (event: { notRestoredExplanationsTree?: NotRestoredTree }) => {
        notUsed.push(event.notRestoredExplanationsTree ?? {});
      }
    );
    await cdp.send('Page.enable');
    await fixture.page.goto(`${new URL(fixture.page.url()).origin}/beacon/empty.html`);
    // The panel followed to the page left: the hero's analysis reads stale there.
    await expect(panel.locator('[data-fdt-lcp-stale]')).toHaveCount(1, { timeout: 10_000 });
    // A restore fires no `load`: wait for the commit only.
    await fixture.page.goBack({ waitUntil: 'commit' });
    await fixture.page.waitForFunction(() => document.readyState === 'complete');
    const restored = await fixture.page.evaluate(
      () => (window as unknown as { fdtRestored?: boolean }).fdtRestored === true
    );
    if (!restored) {
      const pageReasons = await fixture.page.evaluate(() =>
        JSON.stringify(
          (
            performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming & {
              notRestoredReasons?: unknown;
            }
          ).notRestoredReasons ?? null
        )
      );
      const reasons = notUsed.flatMap(notRestoredReasons);
      const report = `reasons ${JSON.stringify(reasons)}; tree ${JSON.stringify(notUsed)}; page notRestoredReasons ${pageReasons}`;
      if (
        reasons.length > 0 &&
        reasons.every((reason) => HOST_ENVIRONMENT_BFCACHE_REASONS.has(reason))
      ) {
        test.info().annotations.push({ type: 'bfcache not restored (host)', description: report });
        test.skip(true, `Chromium declined the restore for host reasons only: ${report}`);
      }
      throw new Error(`Chromium did not restore the page from the back/forward cache: ${report}`);
    }
    await cdp.detach();
    // Playwright's locators stall on the panel once this browser restored a page
    // from the cache (its frame tracking; the panel's DOM answers): drive by evaluate.
    await expect
      .poll(
        async () =>
          await panel.evaluate(() => {
            document.querySelector<HTMLElement>('[data-fdt-vitals-refresh]')?.click();
            return document.querySelector('[data-fdt="vitals-card"]')?.textContent ?? '';
          }),
        { timeout: 10_000, intervals: [500] }
      )
      .toContain('Not measured again after a back/forward-cache restore');
    // The panel re-read the restored page: its data is ready (the page body, no
    // loading skeleton) and is the hero's load again (its analysis no longer stale).
    await expect
      .poll(
        async () =>
          await panel.evaluate(() => ({
            ready:
              document.querySelector('[data-fdt="lcp-outcome"]') !== null &&
              document.querySelector('[data-fdt-page="fetching"]') === null,
            stale: document.querySelector('[data-fdt-lcp-stale]') !== null
          })),
        { timeout: 10_000, intervals: [500] }
      )
      .toEqual({ ready: true, stale: false });
    expect(await panel.evaluate(() => document.body.textContent)).not.toContain(
      "Couldn't load page data"
    );
  } finally {
    await own.close('lcp acceptance: bfcache');
  }
});

test('real prerender activation: times count from activation, the note says so', async () => {
  const own = await ownBrowser(false);
  try {
    const { panel, fixture } = await openPanelForFixture(own, '/lcp/prerender-start.html');
    // A hidden page (the panel tab is in front) starts no prerender.
    await fixture.page.bringToFront();
    // The browser's own prerender status (the reason, when it declines).
    const session = await fixture.page.context().newCDPSession(fixture.page);
    const statuses: string[] = [];
    session.on(
      'Preload.prerenderStatusUpdated',
      (event: { status: string; prerenderStatus?: string }) => {
        statuses.push(
          `${event.status}${event.prerenderStatus === undefined ? '' : `:${event.prerenderStatus}`}`
        );
      }
    );
    await session.send('Preload.enable');
    await expect
      .poll(() => statuses.some((status) => /^(Ready|Failure)/.test(status)), { timeout: 10_000 })
      .toBe(true)
      .catch(() => undefined);
    test.info().annotations.push({ type: 'prerender statuses', description: statuses.join(', ') });
    // Playwright's locators stall on a page holding a prerender (its frame
    // tracking); a click from the page itself activates the same way.
    await fixture.page.evaluate(() => {
      document.querySelector<HTMLElement>('#go')?.click();
    });
    await fixture.page.waitForURL(/prerendered=1/);
    const activationStart = await fixture.page.evaluate(
      () =>
        (
          performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming & {
            activationStart: number;
          }
        ).activationStart
    );
    if (!(activationStart > 0)) {
      test
        .info()
        .annotations.push({ type: 'not prerendered', description: String(activationStart) });
      test.skip(
        true,
        `Chromium did not prerender the page (activationStart 0; statuses: ${statuses.join(', ')})`
      );
    }
    await openPage(panel);
    await analyse(panel);
    await expect(panel.locator('[data-fdt="lcp-outcome"]')).toContainText(
      'Prerendered page: times count from when it was shown'
    );
    const truth = await pageTruth(fixture.page);
    const last = truth.entries.at(-1);
    if (last === undefined) throw new Error('no LCP entry');
    const total = ms(await panel.locator('[data-fdt-lcp-total]').textContent());
    expect(Math.abs(total - Math.max(0, last.startTime - activationStart))).toBeLessThanOrEqual(1);
  } finally {
    await own.close('lcp acceptance: prerender');
  }
});
