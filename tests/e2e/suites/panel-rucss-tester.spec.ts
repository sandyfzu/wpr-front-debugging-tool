/**
 * The RUCSS tester end to end in real Chromium: the panel's Run → the page's
 * content script → the background's request to the RUCSS service → the
 * panel's build worker → the page's style swap, over the local fixture
 * `/rucss/page.html` (two stylesheets, WP Rocket's used CSS, a theme inline
 * style, a default-marker inline style, an alternate stylesheet).
 *
 * The service boundary: the harness resolves the service host to nothing
 * (`helpers/extension.ts`), and each case answers the background's request
 * with a context route (routes see the extension service worker's requests
 * and intercept before name resolution) — never the real service. Each
 * case records what the background sent (address, method, body).
 *
 * Pinned:
 * - request: the raw address — the page address (two query parameters)
 *   encoded whole, the seconds joined as one more page parameter (`%26`),
 *   the bare `&mobile`/`&home` flags — and a JSON POST of `{}` or `{ safelist }`;
 * - success: the result style (id, sheet, rules, characters), exactly the
 *   expected removals (markers, patterns, used-CSS carve-out, alternate
 *   stylesheet untouched) and the panel's counts;
 * - TEST MODE across repeats and reloads: the repeat question, the
 *   Detections notice and the strip's glyph + card line exactly once, all
 *   gone after the Reload buttons (DevTools' `inspectedWindow.reload` is
 *   stubbed in the standalone panel to reload the inspected tab — the call
 *   and its effect are real, the DevTools window is not);
 * - a reload from the browser itself: an open repeat question goes, the applied
 *   outcome stops reading as a current success (stale, its request kept), and
 *   Run again tests the clean page;
 * - failures (HTTP error, unusable answers, the service's own error code,
 *   network failure): the page's styles byte-identical, honest words, Run
 *   again recovers;
 * - an invalid replacement is refused before anything is sent;
 * - a page Content Security Policy (and an answer without CORS headers)
 *   does not stop the request or the result;
 * - the preserve-marker check on the page's thread: a very large inline
 *   style, and thousands of markers over megabytes of inline CSS (stopped at
 *   its time budget, typed) — the page's own timer keeps firing (the
 *   longest gap of a main-world heartbeat is bounded and logged; a
 *   `longtask` observer saw none of a content script's tasks in this harness).
 */
import type { Page, Route } from '@playwright/test';

import { RUCSS_ENDPOINT } from '../../../lib/rucss-tester/endpoint';
import { expect, ORIGIN_A, test, type ExtensionDriver } from '../helpers/extension';
import { openPanelForFixture, type InspectedPanel } from '../helpers/panel-data';
import { clearWidgetMap, STRIP_HOST } from '../helpers/strip-pill';

/** The fixture page. */
const FIXTURE = '/rucss/page.html';

/** `chrome.storage.local` key of the tester's settings (`local:rucss-tester-config`). */
const CONFIG_KEY = 'rucss-tester-config';

/** The result style's id. */
const RESULT_ID = 'rucss_test_result_style';

/** The service's CSS in the success cases (two rules). */
const SHAKEN_CSS = 'body{background-color:rgb(10, 20, 30)}p{color:rgb(0, 0, 200)}';

/** A success answer in the live service's shape. */
const OK_ANSWER = JSON.stringify({
  code: 200,
  status: 'completed',
  message: 'Treeshaked successfully!',
  contents: { success: true, shakedCSS: SHAKEN_CSS }
});

/**
 * The longest page-heartbeat gap a responsive page may show in this harness.
 * Not the 50 ms long-task floor: an idle page holding megabytes of inline
 * CSS already shows ~200 ms gaps here with no test running (measured
 * control), so the bound proves "no freeze", not frame-level smoothness.
 * Unpaced, the marker case below froze the page for over a minute.
 */
const HEARTBEAT_GAP_BOUND_MS = 1_000;

/** Long enough for a run against a routed (instant) service. */
const RUN_SETTLE = { timeout: 30_000 };

/**
 * The panel's init script giving the standalone panel DevTools' reload: it
 * reloads the inspected tab (`tabs.reload` needs no permission) and counts
 * the calls on the panel window. Runs after the harness's devtools stamp.
 */
const RELOAD_SHIM = `(() => {
  window.__fdtInspectedReloads = 0;
  for (const ns of [window.chrome, window.browser]) {
    const inspected = ns && ns.devtools && ns.devtools.inspectedWindow;
    if (!inspected) continue;
    inspected.reload = () => {
      window.__fdtInspectedReloads += 1;
      chrome.tabs.reload(inspected.tabId);
    };
  }
})()`;

/** One request the background sent to the service. */
interface ServiceCall {
  readonly url: string;
  readonly method: string;
  readonly body: string | null;
  readonly contentType: string | undefined;
  readonly cookie: string | undefined;
}

/** How a routed service answers one request. */
type ServiceAnswer = { status?: number; contentType?: string; body: string } | 'abort';

/**
 * Answer the background's service requests with `answer` (replaceable
 * between runs) and record each request.
 *
 * @param extension The driver.
 * @param initial The first answer.
 * @returns The recorded calls, the answer setter and the unroute.
 */
async function routeService(
  extension: ExtensionDriver,
  initial: ServiceAnswer
): Promise<{
  calls: ServiceCall[];
  answer: (next: ServiceAnswer) => void;
  unroute: () => Promise<void>;
}> {
  const calls: ServiceCall[] = [];
  let current = initial;
  const matcher = (url: URL): boolean => url.href.startsWith(`${RUCSS_ENDPOINT}?`);
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    const headers = await request.allHeaders();
    calls.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
      contentType: headers['content-type'],
      cookie: headers.cookie
    });
    if (current === 'abort') {
      await route.abort('failed');
      return;
    }
    // No CORS headers: the background's request needs none.
    await route.fulfill({
      status: current.status ?? 200,
      contentType: current.contentType ?? 'application/json; charset=utf-8',
      body: current.body
    });
  };
  await extension.browserContext.route(matcher, handler);
  return {
    calls,
    answer: (next) => {
      current = next;
    },
    unroute: () => extension.browserContext.unroute(matcher, handler)
  };
}

/**
 * Store the tester's settings (the panel reads them at its first mount).
 *
 * @param extension The driver.
 * @param config The settings; absent, the defaults.
 */
async function storeConfig(extension: ExtensionDriver, config?: object): Promise<void> {
  await extension.evaluateInWorker(
    async ({ key, value }: { key: string; value: object | null }) => {
      if (value === null) await chrome.storage.local.remove(key);
      else await chrome.storage.local.set({ [key]: value });
    },
    { key: CONFIG_KEY, value: config ?? null }
  );
}

/** The settings shape (raw field text, as the form stores it). */
function config(overrides: Partial<Record<string, unknown>>): object {
  return {
    safelist: '',
    inlinePreserve: '',
    excludeFiles: '',
    prepend: '',
    append: '',
    replacements: [],
    mobile: false,
    home: false,
    ...overrides
  };
}

/**
 * The page's judged styles, serialized (`style` + every `rel` containing
 * `stylesheet`), so "unchanged" means byte-identical.
 *
 * @param page The fixture page.
 */
function styleMarkup(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('style, link[rel~="stylesheet"]')].map((node) => node.outerHTML)
  );
}

/** The ids of the page's styles (in order). */
function styleIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('style, link[rel~="stylesheet"]')].map((node) => node.id)
  );
}

/** The result style's facts on the page (null when absent). */
function resultStyle(
  page: Page
): Promise<{ text: string; rules: number | null; isHtmlStyle: boolean } | null> {
  return page.evaluate((id) => {
    const style = document.getElementById(id);
    if (style === null) return null;
    return {
      text: style.textContent,
      rules: style instanceof HTMLStyleElement ? (style.sheet?.cssRules.length ?? null) : null,
      isHtmlStyle: style instanceof HTMLStyleElement
    };
  }, RESULT_ID);
}

/** The body's computed background colour. */
function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** Open the panel on the tester page over the fixture, with the reload stub. */
function openTester(extension: ExtensionDriver, urlPath = FIXTURE): Promise<InspectedPanel> {
  return openPanelForFixture(extension, urlPath, {
    bootHash: '#/rucss-tester',
    panelInit: RELOAD_SHIM
  });
}

/**
 * Wait for the next finished outcome after `act`: the outcome block is
 * keyed on the finished run, so a new run renders a new element — the one
 * shown before is tagged first and never mistaken for the new one.
 *
 * @param panel The panel page.
 * @param act What starts the run (a click).
 * @returns The new outcome's kind.
 */
async function nextOutcome(panel: Page, act: () => Promise<void>): Promise<string | null> {
  await panel.evaluate(() => {
    document.querySelector('[data-fdt="rucss-outcome"]')?.setAttribute('data-e2e-seen', '');
  });
  await act();
  const fresh = panel.locator('[data-fdt="rucss-outcome"]:not([data-e2e-seen])');
  await expect(fresh).toBeVisible(RUN_SETTLE);
  await expect(panel.locator('[data-fdt-rucss-run]')).not.toHaveAttribute('aria-busy', 'true');
  return fresh.getAttribute('data-fdt-rucss-outcome');
}

/** Click Run and wait for the finished outcome; returns its kind. */
function run(panel: Page): Promise<string | null> {
  return nextOutcome(panel, () => panel.locator('[data-fdt-rucss-run]').click());
}

/** The panel's applied-run summary value for one term. */
function summaryValue(panel: Page, term: string): Promise<string | null> {
  // Terms are plain words (no pattern characters).
  const termCell = panel.locator('[data-fdt-key-value-term]', { hasText: new RegExp(`^${term}$`) });
  return panel
    .locator('[data-fdt="rucss-summary"] [data-fdt="key-value"]')
    .filter({ has: termCell })
    .locator('[data-fdt-key-value-value]')
    .textContent();
}

/**
 * Serve a page holding `css` in one inline style (plus `extra` head markup)
 * at `path` on the fixture origin.
 *
 * @returns The path and the unroute.
 */
async function serveInlineCss(
  extension: ExtensionDriver,
  path: string,
  css: string,
  extra: string
): Promise<{ path: string; unroute: () => Promise<void> }> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Inline CSS</title><style id="huge">${css}</style>${extra}</head><body><p>Inline CSS</p></body></html>`;
  const matcher = (url: URL): boolean => url.pathname === path;
  const serve = async (route: Route): Promise<void> => {
    await route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  };
  await extension.browserContext.route(matcher, serve);
  return { path, unroute: () => extension.browserContext.unroute(matcher, serve) };
}

/**
 * Start a main-world heartbeat (a 4 ms interval recording its longest gap):
 * any task holding the page's thread — a content script's included — shows
 * as a gap. The tab must be visible: a hidden tab's timers are throttled.
 *
 * @param page The page.
 */
async function startHeartbeat(page: Page): Promise<void> {
  const visibility = await page.evaluate(() => {
    const state = { last: performance.now(), gaps: [] as number[] };
    (window as unknown as { __fdtHeartbeat: typeof state }).__fdtHeartbeat = state;
    setInterval(() => {
      const now = performance.now();
      // Gaps past 50 ms (a long task's floor), in order.
      if (now - state.last > 50) state.gaps.push(Math.round(now - state.last));
      state.last = now;
    }, 4);
    return document.visibilityState;
  });
  expect(visibility).toBe('visible');
}

/** The heartbeat's gaps past 50 ms so far (ms, in order). */
function heartbeatLongGaps(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __fdtHeartbeat: { gaps: number[] } }).__fdtHeartbeat.gaps
  );
}

/** Close both pages. */
async function closeAll(opened: InspectedPanel): Promise<void> {
  await opened.panel.close();
  await opened.fixture.page.close();
}

test.describe('RUCSS tester (panel → page → background → mocked service)', () => {
  test.beforeEach(async ({ extension }) => {
    await storeConfig(extension);
    await clearWidgetMap(extension);
  });

  test('default settings: the request, the result style and exactly the expected removals', async ({
    extension
  }) => {
    const service = await routeService(extension, { body: OK_ANSWER });
    // Two page parameters (`lang`, then the harness's `e2e-tab`): only an
    // encoded address reaches the service whole.
    const opened = await openTester(extension, `${FIXTURE}?lang=fr`);
    const { panel, fixture } = opened;
    try {
      await expect(panel.locator('[data-fdt-rucss-disclosure]')).toContainText('mega.wp-rocket.me');
      expect(await bodyBackground(fixture.page)).toBe('rgb(0, 0, 255)');
      expect(await run(panel)).toBe('applied');

      // One JSON POST: `{}` (no safelist), the page address encoded, then the seconds, no flags.
      expect(service.calls).toHaveLength(1);
      const call = service.calls[0];
      expect(call?.method).toBe('POST');
      expect(call?.body).toBe('{}');
      expect(call?.contentType).toBe('application/json');
      expect(call?.cookie).toBeUndefined();
      // The raw address: the page address encoded whole (an unencoded one
      // would be cut at its `&`), then `%26<seconds>` (the page has a query).
      const rawUrl = call?.url ?? '';
      const encodedPage = encodeURIComponent(fixture.page.url());
      expect(encodedPage).toContain('%26e2e-tab');
      expect(rawUrl.startsWith(`${RUCSS_ENDPOINT}?url=${encodedPage}%26`)).toBe(true);
      expect(rawUrl.slice(`${RUCSS_ENDPOINT}?url=${encodedPage}`.length)).toMatch(/^%26\d{10}$/);
      const sent = new URL(rawUrl);
      expect([...sent.searchParams.keys()]).toEqual(['url']);
      const pageParam = sent.searchParams.get('url') ?? '';
      expect(pageParam.slice(0, pageParam.lastIndexOf('&'))).toBe(fixture.page.url());
      // The page's own parameters keep their values; the seconds are one more, valueless.
      const testedPage = new URL(pageParam);
      expect(testedPage.searchParams.get('lang')).toBe('fr');
      expect([...testedPage.searchParams.keys()].slice(0, 2)).toEqual(['lang', 'e2e-tab']);
      const seconds = Number(pageParam.slice(pageParam.lastIndexOf('&') + 1));
      expect(Math.abs(seconds - Date.now() / 1000)).toBeLessThan(120);
      // The panel shows the exact address sent.
      await expect(panel.locator('[data-fdt-rucss-request]')).toHaveText(call?.url ?? '');

      // The result: an HTML style holding the service's CSS, parsed into two rules, last in head.
      expect(await resultStyle(fixture.page)).toEqual({
        text: SHAKEN_CSS,
        rules: 2,
        isHtmlStyle: true
      });
      expect(await bodyBackground(fixture.page)).toBe('rgb(10, 20, 30)');
      // Removed: both stylesheets, the used CSS, the theme style. Kept: the
      // default-marker style; the alternate stylesheet is never judged.
      expect(await styleIds(fixture.page)).toEqual([
        'alt-css',
        'rocket-lazyrender-inline-css',
        RESULT_ID
      ]);
      expect(await summaryValue(panel, 'Styles removed')).toBe('4');
      expect(await summaryValue(panel, 'Kept by inline markers')).toBe('1');
      expect(await summaryValue(panel, 'Kept by stylesheet patterns')).toBe('0');
      expect(await summaryValue(panel, 'Already gone')).toBe('0');
      expect(await summaryValue(panel, 'CSS injected')).toBe(
        `${String(SHAKEN_CSS.length)} characters`
      );
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('variant settings: safelist body, mobile + home flags, markers, patterns, prepend/append and a replacement', async ({
    extension
  }) => {
    await storeConfig(
      extension,
      config({
        safelist: '.from-js\n#menu .open\n.from-js',
        inlinePreserve: 'theme-inline',
        excludeFiles: 'keep\\.css$',
        prepend: '/*before*/',
        append: '/*after*/',
        replacements: [{ search: 'rgb\\(10, 20, 30\\)', replacement: 'rgb(9, 9, 9)' }],
        mobile: true,
        home: true
      })
    );
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    try {
      expect(await run(panel)).toBe('applied');
      expect(service.calls).toHaveLength(1);
      const call = service.calls[0];
      // The safelist, deduplicated, in order.
      expect(JSON.parse(call?.body ?? 'null')).toEqual({ safelist: ['.from-js', '#menu .open'] });
      const sent = new URL(call?.url ?? '');
      // The fixture address has a query (`e2e-tab`): the seconds join it as `%26<seconds>`.
      expect(sent.search).toMatch(/%26\d{10}&mobile&home$/);
      expect([...sent.searchParams.keys()]).toEqual(['url', 'mobile', 'home']);

      const result = await resultStyle(fixture.page);
      expect(result?.text).toBe(
        `/*before*/${SHAKEN_CSS.replace('rgb(10, 20, 30)', 'rgb(9, 9, 9)')}/*after*/`
      );
      expect(result?.rules).toBe(2);
      expect(await bodyBackground(fixture.page)).toBe('rgb(9, 9, 9)');
      // Kept: the pattern's stylesheet, both marked inline styles. Removed: site.css, the used CSS.
      expect(await styleIds(fixture.page)).toEqual([
        'keep-css',
        'alt-css',
        'theme-inline-css',
        'rocket-lazyrender-inline-css',
        RESULT_ID
      ]);
      expect(await summaryValue(panel, 'Styles removed')).toBe('2');
      expect(await summaryValue(panel, 'Kept by inline markers')).toBe('2');
      expect(await summaryValue(panel, 'Kept by stylesheet patterns')).toBe('1');
      await expect(panel.locator('[data-fdt="rucss-pair-counts"]')).toHaveText(
        'Replacement 1: 1 match'
      );
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('TEST MODE once across repeats, the repeat question, and the reload buttons resetting it', async ({
    extension
  }) => {
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    const pillGlyph = fixture.page.locator(`${STRIP_HOST} [data-fdt-strip-pill-rucss]`);
    const notice = panel.locator('[data-fdt="test-mode-notice"]');
    const repeat = panel.locator('[data-fdt-rucss-repeat]');

    /** The strip's card line count (opened, read, closed). */
    const cardLines = async (): Promise<number> => {
      await fixture.page.locator(`${STRIP_HOST} .dw-pill`).click();
      await expect(fixture.page.locator(`${STRIP_HOST} .dw-card`)).toBeVisible();
      const lines = fixture.page.locator(`${STRIP_HOST} [data-fdt-strip-rucss]`);
      const count = await lines.count();
      if (count > 0) await expect(lines).toHaveText('RUCSS test applied — reload to restore');
      await fixture.page.keyboard.press('Escape');
      await expect(fixture.page.locator(`${STRIP_HOST} .dw-card`)).toBeHidden();
      return count;
    };
    /** Show a panel route by hash. */
    const go = async (route: string): Promise<void> => {
      await panel.evaluate((hash) => {
        location.hash = hash;
      }, `#/${route}`);
      await expect(panel.locator(`[data-fdt-page="${route}"]`)).toBeVisible();
    };

    try {
      await expect(fixture.page.locator(STRIP_HOST)).toHaveCount(1);
      await expect(pillGlyph).toHaveCount(0);
      expect(await run(panel)).toBe('applied');
      await expect(pillGlyph).toHaveCount(1);
      expect(await cardLines()).toBe(1);
      await go('detections');
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText(
        "(TEST MODE) A RUCSS test replaced this page's styles. Reload the page to restore them."
      );

      // A second run asks first; Run on top applies again — still one glyph, one line, one notice.
      await go('rucss-tester');
      await panel.locator('[data-fdt-rucss-run]').click();
      await expect(repeat).toContainText("A test already replaced this page's styles.");
      expect(service.calls).toHaveLength(1);
      expect(
        await nextOutcome(panel, () => panel.locator('[data-fdt-rucss-run-on-top]').click())
      ).toBe('applied');
      expect(service.calls).toHaveLength(2);
      // The second run stripped the first result and injected its own: exactly one result style.
      await expect(fixture.page.locator(`#${RESULT_ID}`)).toHaveCount(1);
      await expect(pillGlyph).toHaveCount(1);
      expect(await cardLines()).toBe(1);
      await go('detections');
      await expect(notice).toHaveCount(1);

      // The repeat question's "Reload for a clean run": the page reloads, every TEST MODE mark goes.
      await go('rucss-tester');
      await panel.locator('[data-fdt-rucss-run]').click();
      await expect(repeat).toContainText("2 tests already replaced this page's styles.");
      const reloaded = fixture.page.waitForEvent('load');
      await repeat.getByRole('button', { name: 'Reload for a clean run' }).click();
      await reloaded;
      expect(
        await panel.evaluate(
          () => (window as unknown as { __fdtInspectedReloads: number }).__fdtInspectedReloads
        )
      ).toBe(1);
      expect(service.calls).toHaveLength(2);
      await expect(fixture.page.locator(`#${RESULT_ID}`)).toHaveCount(0);
      expect(await bodyBackground(fixture.page)).toBe('rgb(0, 0, 255)');
      await expect(fixture.page.locator(STRIP_HOST)).toHaveCount(1);
      await expect(pillGlyph).toHaveCount(0);
      await expect(panel.locator('[data-fdt="rucss-outcome"][data-fdt-rucss-stale]')).toBeVisible();
      await go('detections');
      await expect(notice).toHaveCount(0);

      // A clean page runs without the question; the Detections notice's own Reload restores it too.
      await go('rucss-tester');
      expect(await run(panel)).toBe('applied');
      await expect(repeat).toHaveCount(0);
      expect(service.calls).toHaveLength(3);
      await go('detections');
      await expect(notice).toHaveCount(1);
      const reloadedAgain = fixture.page.waitForEvent('load');
      await notice.getByRole('button', { name: 'Reload page' }).click();
      await reloadedAgain;
      await expect(notice).toHaveCount(0);
      await expect(pillGlyph).toHaveCount(0);
      expect(await styleIds(fixture.page)).toEqual([
        'site-css',
        'keep-css',
        'alt-css',
        'wpr-usedcss',
        'theme-inline-css',
        'rocket-lazyrender-inline-css'
      ]);
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('a browser reload turns the applied outcome stale, and Run again tests the clean page', async ({
    extension
  }) => {
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    const outcome = panel.locator('[data-fdt="rucss-outcome"]');
    const repeat = panel.locator('[data-fdt-rucss-repeat]');
    try {
      expect(await run(panel)).toBe('applied');
      await expect(outcome).not.toHaveAttribute('data-fdt-rucss-stale');
      await expect(outcome).toContainText('Test applied');
      await expect(outcome).toHaveClass(/bg-status-ok-soft/);
      await expect(fixture.page.locator(`#${RESULT_ID}`)).toHaveCount(1);
      // Run on the same page: the repeat question opens, and is left open.
      await panel.locator('[data-fdt-rucss-run]').click();
      await expect(repeat).toContainText("A test already replaced this page's styles.");

      // The user reloads the page from the browser, not from the panel.
      await fixture.page.reload();
      await expect(fixture.page.locator(`#${RESULT_ID}`)).toHaveCount(0);
      // Nothing is left to ask about on the clean page: the question goes.
      await expect(repeat).toHaveCount(0);
      await expect(outcome).toHaveAttribute('data-fdt-rucss-stale', '');
      await expect(outcome).toContainText('Test no longer on the page');
      await expect(outcome).not.toContainText('Test applied');
      await expect(outcome).toHaveClass(/bg-status-neutral-soft/);
      await expect(outcome).not.toHaveClass(/bg-status-ok-soft/);
      // The run's details stay; the next step is a new run, not a reload.
      await expect(panel.locator('[data-fdt-rucss-request]')).toHaveText(
        service.calls[0]?.url ?? ''
      );
      await expect(panel.locator('[data-fdt-rucss-recovery="reload-page"]')).toHaveCount(0);

      expect(
        await nextOutcome(panel, () => panel.locator('[data-fdt-rucss-recovery="retry"]').click())
      ).toBe('applied');
      // The clean page asked nothing first.
      await expect(repeat).toHaveCount(0);
      expect(service.calls).toHaveLength(2);
      await expect(outcome).not.toHaveAttribute('data-fdt-rucss-stale');
      await expect(outcome).toContainText('Test applied');
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('service failures leave the page styles byte-identical, say what happened, and Run again recovers', async ({
    extension
  }) => {
    const cases: readonly { answer: ServiceAnswer; title: string }[] = [
      {
        answer: { status: 500, contentType: 'text/html', body: '<h1>Internal Server Error</h1>' },
        title: 'The RUCSS service answered HTTP 500'
      },
      // Shape: answered, but no CSS (the live service once answered a bare `null`).
      { answer: { body: 'null' }, title: "The service's answer holds no CSS" },
      {
        answer: { body: '{"code":200,"contents":{}}' },
        title: "The service's answer holds no CSS"
      },
      // The live service's own failure shape (HTTP 200, code 500).
      {
        answer: {
          body: JSON.stringify({
            code: 500,
            status: 'failed',
            error: 'not_reachable',
            message: "couldn't reach the page. response status 404"
          })
        },
        title: 'The RUCSS service returned code 500'
      },
      { answer: 'abort', title: "Couldn't reach the RUCSS service" }
    ];
    const service = await routeService(extension, 'abort');
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    try {
      const before = await styleMarkup(fixture.page);
      for (const [index, failure] of cases.entries()) {
        service.answer(failure.answer);
        expect(await run(panel)).toBe('start-failed');
        const outcome = panel.locator('[data-fdt="rucss-outcome"]');
        await expect(outcome).toContainText(failure.title);
        await expect(outcome).toContainText('Nothing on the page was changed.');
        await expect(outcome.locator('[data-fdt-rucss-recovery="retry"]')).toHaveText('Run again');
        // The address sent stays copyable on a failure too.
        await expect(panel.locator('[data-fdt-rucss-request]')).toHaveText(
          service.calls[index]?.url ?? ''
        );
        expect(await styleMarkup(fixture.page)).toEqual(before);
        await expect(fixture.page.locator(`#${RESULT_ID}`)).toHaveCount(0);
      }
      expect(service.calls).toHaveLength(cases.length);
      // Failures changed nothing, so Run again runs at once (no repeat question) and applies.
      service.answer({ body: OK_ANSWER });
      expect(
        await nextOutcome(panel, () => panel.locator('[data-fdt-rucss-recovery="retry"]').click())
      ).toBe('applied');
      expect(await resultStyle(fixture.page)).toMatchObject({ text: SHAKEN_CSS, rules: 2 });
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('an invalid replacement is refused in the form and before anything is sent', async ({
    extension
  }) => {
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    try {
      const before = await styleMarkup(fixture.page);
      // Default settings: the replacements' section starts folded.
      const adjust = panel.locator(
        '[data-fdt-rucss-section="adjust"] [data-fdt-rucss-section-toggle]'
      );
      await expect(adjust).toHaveAttribute('aria-expanded', 'false');
      await adjust.click();
      await panel.getByRole('button', { name: 'Add replacement' }).click();
      await panel.getByRole('textbox', { name: 'Replacement 1 search' }).fill('(unclosed');
      await expect(panel.locator('[data-fdt-rucss-pair="0"] [data-fdt-field-error]')).toBeVisible();
      await expect(panel.locator('[data-fdt-save="saved"]')).toBeVisible();
      expect(await run(panel)).toBe('invalid-config');
      const outcome = panel.locator('[data-fdt="rucss-outcome"]');
      await expect(outcome).toContainText('Replacement 1:');
      expect(service.calls).toHaveLength(0);
      expect(await styleMarkup(fixture.page)).toEqual(before);
      // Folded, the section still names the problem; its recovery unfolds it and takes the user to the pattern.
      await adjust.click();
      await expect(adjust).toContainText('1 invalid pattern');
      await outcome.locator('[data-fdt-rucss-recovery="review-patterns"]').click();
      await expect(adjust).toHaveAttribute('aria-expanded', 'true');
      await expect(panel.getByRole('textbox', { name: 'Replacement 1 search' })).toBeFocused();
    } finally {
      await closeAll(opened);
      await service.unroute();
    }
  });

  test('a strict page CSP and an answer without CORS headers do not stop the test', async ({
    extension
  }) => {
    const csp = "default-src 'self'; style-src 'self'; connect-src 'self'; script-src 'self'";
    const page = `${ORIGIN_A}${FIXTURE}`;
    const serve = async (route: Route): Promise<void> => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': csp }
      });
    };
    const fixtureMatcher = (url: URL): boolean => url.href.startsWith(page);
    await extension.browserContext.route(fixtureMatcher, serve);
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension);
    const { panel, fixture } = opened;
    try {
      // The policy is live: a page-made inline style gets no sheet.
      expect(
        await fixture.page.evaluate(() => {
          const probe = document.createElement('style');
          probe.textContent = 'a{}';
          document.head.append(probe);
          const blocked = probe.sheet === null;
          probe.remove();
          return blocked;
        })
      ).toBe(true);
      expect(await run(panel)).toBe('applied');
      expect(service.calls).toHaveLength(1);
      // The content script's style is exempt from the page policy: applied, parsed.
      expect(await resultStyle(fixture.page)).toEqual({
        text: SHAKEN_CSS,
        rules: 2,
        isHtmlStyle: true
      });
      expect(await bodyBackground(fixture.page)).toBe('rgb(10, 20, 30)');
    } finally {
      await closeAll(opened);
      await service.unroute();
      await extension.browserContext.unroute(fixtureMatcher, serve);
    }
  });

  test('a very large inline style under the preserve-marker check keeps the page responsive', async ({
    extension
  }) => {
    // 16 MiB of inline CSS in one style, plus 1 000 small ones; the defaults
    // plus 50 user markers, none matching (every check scans everything).
    const huge = 'a{color:red}\n'.repeat(Math.ceil((16 * 1024 * 1024) / 13));
    const small = Array.from(
      { length: 1_000 },
      (_, index) => `<style id="small-${String(index)}">.s${String(index)}{color:red}</style>`
    ).join('');
    const served = await serveInlineCss(extension, '/rucss/huge.html', huge, small);
    await storeConfig(
      extension,
      config({
        inlinePreserve: Array.from(
          { length: 50 },
          (_, index) => `marker-${String(index)}-absent`
        ).join('\n')
      })
    );
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension, served.path);
    const { panel, fixture } = opened;
    try {
      await startHeartbeat(fixture.page);
      expect(await run(panel)).toBe('applied');
      expect(await summaryValue(panel, 'Styles removed')).toBe('1,001');
      const gaps = await heartbeatLongGaps(fixture.page);
      console.log(
        `[rucss-tester] 16 MiB inline style, 56 markers: page gaps > 50 ms ${JSON.stringify(gaps)}`
      );
      expect(Math.max(0, ...gaps)).toBeLessThan(HEARTBEAT_GAP_BOUND_MS);
    } finally {
      await closeAll(opened);
      await service.unroute();
      await served.unroute();
    }
  });

  test('thousands of markers over megabytes of inline CSS stop at the budget, the page responsive and untouched', async ({
    extension
  }) => {
    // 8 MiB of inline CSS; 8 190 distinct three-character markers starting
    // with a character the CSS repeats every 13 characters: unbounded, this
    // judging blocked the page for over a minute.
    const huge = 'a{color:red}\n'.repeat(Math.ceil((8 * 1024 * 1024) / 13));
    const served = await serveInlineCss(extension, '/rucss/markers.html', huge, '');
    const markers = Array.from(
      { length: 8_190 },
      (_, index) =>
        `{${String.fromCharCode(33 + (index % 90))}${String.fromCharCode(33 + (Math.floor(index / 90) % 90))}`
    );
    await storeConfig(extension, config({ inlinePreserve: markers.join('\n') }));
    const service = await routeService(extension, { body: OK_ANSWER });
    const opened = await openTester(extension, served.path);
    const { panel, fixture } = opened;
    try {
      const before = await styleMarkup(fixture.page);
      await startHeartbeat(fixture.page);
      const started = Date.now();
      expect(await run(panel)).toBe('start-failed');
      const took = Date.now() - started;
      const outcome = panel.locator('[data-fdt="rucss-outcome"]');
      await expect(outcome).toContainText('Too much inline CSS for your markers');
      await expect(outcome).toContainText('Nothing on the page was changed.');
      expect(await styleMarkup(fixture.page)).toEqual(before);
      const gaps = await heartbeatLongGaps(fixture.page);
      console.log(
        `[rucss-tester] 8 MiB inline CSS, 8 190 markers: stopped after ${String(took)} ms, page gaps > 50 ms ${JSON.stringify(gaps)}`
      );
      expect(took).toBeLessThan(15_000);
      expect(Math.max(0, ...gaps)).toBeLessThan(HEARTBEAT_GAP_BOUND_MS);
    } finally {
      await closeAll(opened);
      await service.unroute();
      await served.unroute();
    }
  });
});
