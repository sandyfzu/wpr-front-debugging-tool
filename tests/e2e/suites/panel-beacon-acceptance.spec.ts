/**
 * Beacon Tester browser acceptance (P14.1 box 1), over real runs in Chromium:
 *
 * - lazy runner: no beacon code is parsed in the page before Run (no
 *   `beacon-runner.js`, no runner in the isolated world); the first Run
 *   injects it once, later runs reuse it;
 * - nothing reaches the site: on a page shaped like a cached WP Rocket page
 *   (its beacon data, its gate script and the "Debug: cached" signature that
 *   makes WP Rocket's own beacon ask the site first) a run makes no POST and
 *   no request at all (a POST from the page and one from the isolated world prove the recorder sees them), and
 *   leaves no `beacon-completed` mark — with the gate and without it — nor a
 *   console line, nor any change to the page's markup;
 * - each outcome: completed with results, completed empty, bailed on a
 *   scrolled page, invalid settings (nothing sent to the page), and — with a
 *   stand-in runner published in the isolated world — the 15 s timeout, a run
 *   that ends failed and a runner whose start throws.
 */
import type { Page } from '@playwright/test';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import { openPanelForFixture, type InspectedPanel } from '../helpers/panel-data';
import { probePage, recordTraffic, type PageProbe } from '../helpers/live-tools';

/** `chrome.storage.local` key of the tester's settings (`local:beacon-test-settings`). */
const SETTINGS_KEY = 'beacon-test-settings';

/** The runner's global in the isolated world. */
const RUNNER_GLOBAL = '__wprFdtBeaconRunner';

/** The runner bundle's file name (injected by the background on the first run). */
const RUNNER_FILE = '/beacon-runner.js';

/** Both features on, thresholds the 1280 × 800 fixture window passes. */
const RUNNABLE_SETTINGS = {
  aboveTheFold: true,
  lazyRender: true,
  mobile: false,
  widthThreshold: '1000',
  heightThreshold: '600',
  lazyRenderThreshold: '1800'
};

/**
 * Store the tester's settings before the panel opens (the form reads them on load).
 *
 * @param extension The driver.
 * @param settings The stored value.
 */
async function storeSettings(extension: ExtensionDriver, settings: object): Promise<void> {
  await extension.evaluateInWorker(
    (entry: { key: string; value: object }) =>
      chrome.storage.local.set({ [entry.key]: entry.value }),
    { key: SETTINGS_KEY, value: settings }
  );
}

/**
 * Open the panel on a fixture, with a protocol probe on the fixture page.
 *
 * @param extension The driver.
 * @param fixturePath The fixture page.
 * @returns The panel, the fixture and the probe.
 */
async function openTester(
  extension: ExtensionDriver,
  fixturePath: string
): Promise<InspectedPanel & { probe: PageProbe }> {
  const opened = await openPanelForFixture(extension, fixturePath);
  const probe = await probePage(opened.fixture.page, await extension.extensionId());
  await opened.panel.evaluate(() => {
    location.hash = '#/beacon-tester';
  });
  await expect(
    opened.panel.getByRole('heading', { level: 1, name: 'Beacon Tester' })
  ).toBeVisible();
  await expect(opened.panel.getByLabel('Candidate elements')).toBeVisible();
  return { ...opened, probe };
}

/** The finished run's outcome block. */
function outcome(panel: Page) {
  return panel.locator('[data-fdt="beacon-outcome"]');
}

/**
 * Run and wait for the outcome kind.
 *
 * @param panel The panel page.
 * @param kind The expected outcome.
 */
async function runExpecting(panel: Page, kind: string): Promise<void> {
  await panel.locator('[data-fdt-beacon-run]').click();
  await expect(panel.locator('[data-fdt-beacon-run]')).toBeEnabled({ timeout: 40_000 });
  await expect(outcome(panel)).toHaveAttribute('data-fdt-beacon-outcome', kind);
}

/**
 * How many times the page parsed the runner bundle.
 *
 * @param probe The page probe.
 */
function runnerLoads(probe: PageProbe): number {
  return probe.parsedScripts().filter((url) => url.endsWith(RUNNER_FILE)).length;
}

/**
 * Whether the isolated world holds a runner.
 *
 * @param probe The page probe.
 */
async function hasRunner(probe: PageProbe): Promise<boolean> {
  return await probe.inIsolatedWorld<boolean>(`'${RUNNER_GLOBAL}' in globalThis`);
}

/** The page's markup and every `beacon-completed` mark, as one comparable snapshot. */
async function pageState(page: Page): Promise<{ html: string; marks: number; scrollY: number }> {
  return await page.evaluate(() => ({
    html: document.documentElement.outerHTML,
    marks: document.querySelectorAll('[beacon-completed]').length,
    scrollY: window.scrollY
  }));
}

test.beforeEach(async ({ extension }) => {
  await storeSettings(extension, RUNNABLE_SETTINGS);
});

// Later suites share this browser: they start from the fresh-install settings.
test.afterAll(async ({ extension }) => {
  await extension.evaluateInWorker((key: string) => chrome.storage.local.remove(key), SETTINGS_KEY);
});

test('lazy runner, no request to the site, no gate mark, no log, page untouched (with the gate)', async ({
  extension
}) => {
  const { panel, fixture, probe } = await openTester(extension, '/beacon/gated.html');
  try {
    // The fixture's gate stand-in loaded; the page is the cached-page shape.
    await expect
      .poll(() => fixture.page.evaluate(() => 'fdtBeaconGateLoaded' in window))
      .toBe(true);
    expect(
      await fixture.page.evaluate(() => document.documentElement.nextSibling?.textContent)
    ).toContain('Debug: cached');

    // Before any run: no beacon code in the page, in any world.
    expect(runnerLoads(probe)).toBe(0);
    expect(await hasRunner(probe)).toBe(false);
    expect(probe.parsedScripts().some((url) => url.includes('beacon'))).toBe(true); // the gate stand-in
    expect(
      probe.parsedScripts().filter((url) => url.startsWith('chrome-extension://'))
    ).not.toContain(expect.stringContaining('beacon'));

    const before = await pageState(fixture.page);
    expect(before.marks).toBe(0);
    const traffic = recordTraffic(fixture.page);
    // Control: a POST the page itself makes is recorded (the recorder sees POSTs).
    await fixture.page.evaluate(() =>
      fetch('/wp-admin/admin-ajax.php', { method: 'POST', body: 'control' }).catch(() => null)
    );
    // Same from the isolated world, where the extension's beacon code runs.
    await probe.inIsolatedWorld(
      "fetch('/wp-admin/admin-ajax.php', { method: 'POST', body: 'isolated control' }).catch(() => null), true"
    );
    await expect.poll(() => traffic.requests().filter((r) => r.method() === 'POST').length).toBe(2);
    const control = traffic.requests().length;
    const controlLogs = traffic.messages().length;

    await runExpecting(panel, 'completed');
    await expect(outcome(panel)).toContainText('Beacon test complete');
    await expect(panel.locator('[data-fdt="beacon-candidate-row"]').first()).toContainText('#hero');
    expect(runnerLoads(probe)).toBe(1);
    expect(await hasRunner(probe)).toBe(true);

    // A second run reuses the injected runner.
    await runExpecting(panel, 'completed');
    expect(runnerLoads(probe)).toBe(1);

    // Nothing reached the site, nothing was logged, nothing in the page changed.
    const sent = traffic.requests().slice(control);
    expect(
      sent.map((request) => `${request.method()} ${request.url()}`),
      'requests made during the runs'
    ).toEqual([]);
    expect(
      traffic
        .messages()
        .slice(controlLogs)
        .map((message) => message.text())
    ).toEqual([]);
    traffic.stop();
    const after = await pageState(fixture.page);
    expect(after.marks).toBe(0);
    expect(
      await fixture.page.locator('[data-name="wpr-wpr-beacon"]').getAttribute('beacon-completed')
    ).toBeNull();
    expect(after.scrollY).toBe(0);
    expect(after.html).toBe(before.html);
  } finally {
    await probe.close();
    await panel.close();
    await fixture.page.close();
  }
});

test('without the gate: completes, marks nothing, creates no gate, sends nothing', async ({
  extension
}) => {
  const { panel, fixture, probe } = await openTester(extension, '/beacon/candidates.html');
  try {
    const before = await pageState(fixture.page);
    const traffic = recordTraffic(fixture.page);
    await runExpecting(panel, 'completed');
    await panel.getByRole('tab', { name: /Lazy rendering/ }).click();
    await expect(panel.locator('[data-fdt="beacon-lazy-row"]')).toHaveText([
      'far-section-one',
      'far-section-two'
    ]);
    expect(traffic.requests().map((request) => request.url())).toEqual([]);
    expect(traffic.messages().map((message) => message.text())).toEqual([]);
    traffic.stop();
    const after = await pageState(fixture.page);
    expect(after.marks).toBe(0);
    expect(await fixture.page.locator('[data-name="wpr-wpr-beacon"]').count()).toBe(0);
    expect(after.html).toBe(before.html);
  } finally {
    await probe.close();
    await panel.close();
    await fixture.page.close();
  }
});

test('outcomes: empty page, scrolled page, invalid settings', async ({ extension }) => {
  const empty = await openTester(extension, '/beacon/empty.html');
  try {
    await runExpecting(empty.panel, 'completed');
    await expect(outcome(empty.panel)).toContainText('Beacon test complete');
    await expect(outcome(empty.panel)).toContainText(
      'Found 0 critical image candidates and 0 lazy-render elements.'
    );
  } finally {
    await empty.probe.close();
    await empty.panel.close();
    await empty.fixture.page.close();
  }

  const scrolled = await openTester(extension, '/beacon/candidates.html');
  try {
    await scrolled.fixture.page.evaluate(() => {
      window.scrollTo(0, 400);
    });
    await runExpecting(scrolled.panel, 'bailed');
    await expect(outcome(scrolled.panel)).toContainText('The page is scrolled');
    // The bail measured nothing and left the page where it was.
    expect(await scrolled.fixture.page.evaluate(() => window.scrollY)).toBe(400);

    // Invalid settings never reach the page: no runner injected by them.
    const loads = runnerLoads(scrolled.probe);
    await scrolled.panel.getByLabel('Candidate elements').fill('img\ndiv[');
    await scrolled.panel.locator('[data-fdt-beacon-run]').click();
    await expect(outcome(scrolled.panel)).toHaveAttribute(
      'data-fdt-beacon-outcome',
      'invalid-config'
    );
    await expect(outcome(scrolled.panel)).toContainText('Nothing was sent to the page.');
    expect(runnerLoads(scrolled.probe)).toBe(loads);
  } finally {
    await scrolled.probe.close();
    await scrolled.panel.close();
    await scrolled.fixture.page.close();
  }
});

test('outcomes past the runner: the 15 s timeout, a failed run, a throwing start (stand-in runners)', async ({
  extension
}) => {
  const { panel, fixture, probe } = await openTester(extension, '/beacon/candidates.html');
  try {
    // A runner that never finishes: the page's 15 s bound answers.
    await probe.inIsolatedWorld(
      `globalThis.${RUNNER_GLOBAL} = { alive: () => true, start: () => ({ done: new Promise(() => {}), partial: () => null, cancel: () => { globalThis.fdtStandInCancelled = true; } }) }; true`
    );
    const started = Date.now();
    await runExpecting(panel, 'timed-out');
    expect(Date.now() - started).toBeGreaterThanOrEqual(15_000);
    await expect(outcome(panel)).toContainText('The test ran out of time');
    await expect(outcome(panel)).toContainText('found nothing until then');
    // The executor cancelled the hung run; the stand-in kept the page's runner slot.
    expect(await probe.inIsolatedWorld<boolean>('globalThis.fdtStandInCancelled === true')).toBe(
      true
    );
    expect(runnerLoads(probe)).toBe(0);

    // A run that ends failed (the runner's own failure contract: `done` resolves
    // `{ kind: 'failed' }`): the failure is quoted.
    await probe.inIsolatedWorld(
      `globalThis.${RUNNER_GLOBAL} = { alive: () => true, start: () => ({ done: Promise.resolve({ kind: 'failed', message: 'stand-in run failed' }), partial: () => null, cancel: () => {} }) }; true`
    );
    await runExpecting(panel, 'failed');
    await expect(outcome(panel)).toContainText('“stand-in run failed”');

    // A runner whose start throws (no run handle at all): quoted the same way.
    await probe.inIsolatedWorld(
      `globalThis.${RUNNER_GLOBAL} = { alive: () => true, start: () => { throw new Error('stand-in start threw'); } }; true`
    );
    await runExpecting(panel, 'failed');
    await expect(outcome(panel)).toContainText('“stand-in start threw”');

    // A dead runner (its extension context gone) is replaced by a fresh injection.
    await probe.inIsolatedWorld(
      `globalThis.${RUNNER_GLOBAL} = { alive: () => false, start: () => { throw new Error('dead runner used'); } }; true`
    );
    await runExpecting(panel, 'completed');
    expect(runnerLoads(probe)).toBe(1);
  } finally {
    await probe.close();
    await panel.close();
    await fixture.page.close();
  }
});
