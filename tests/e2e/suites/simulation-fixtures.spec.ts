/**
 * Delay JS simulation over real sessions on fixture pages — no WP Rocket,
 * no docker: `fixtures/simulation/plain.html` (one external script, one
 * inline script, one inline hover handler; each tags the root once it
 * runs) served as is, and under the Content Security Policies the fixture
 * server's `/__e2e/csp/<case>` sets.
 *
 * Cases: the plain page simulated with the extension's bundled runtime
 * (nothing site-side), every script delayed until an interaction; a policy
 * forbidding WP Rocket's inline runtime ⇒ nothing simulated, the page as
 * served (no runtime, nothing half-delayed) and the words naming the
 * policy; a policy allowing the runtime but not eval nor `data:` scripts ⇒
 * simulated, with those limits named and behaving as on a site (the
 * runtime's inline fallback, eval refused to its handler takeover); a policy too large to
 * evaluate ⇒ simulated, "CSP not evaluated"; a page serving its own marker
 * (`fixtures/simulation/forged-marker.html`) ⇒ "Simulation not verified".
 *
 * Each case runs in a fresh tab: WP Rocket's runtime remembers a CSP
 * fallback in the tab's sessionStorage, which would leak between cases.
 */
import type { Page } from '@playwright/test';

import { clearDrafts, readBanners } from '../helpers/exclusion-overlay';
import { expect, openFixturePage, test } from '../helpers/extension';
import { clearWidgetMap, STRIP_HOST } from '../helpers/strip-pill';
import {
  applySimulated,
  delayedScriptCount,
  delayLaneLines,
  documentSimulation,
  hasDelayRuntime,
  interact,
  openCapturedBuilder,
  simulatedChip,
  simulationMarkers
} from '../helpers/simulation';

/** A simulation marker naming Delay JS with a 128-bit id. */
const MARKER = /^v1 delay_js=simulated id=[0-9a-f]{32}$/;

/** Bounded wait for the page's scripts after an interaction. */
const RAN = { timeout: 10_000, intervals: [100, 250, 500] };

/** What ran on the page: each fixture script tags the root. */
interface Ran {
  readonly external: boolean;
  readonly inline: boolean;
  readonly handler: boolean;
}

/** Read which fixture scripts ran. */
async function ran(page: Page): Promise<Ran> {
  return await page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      external: data['externalRan'] === '1',
      inline: data['inlineRan'] === '1',
      handler: data['handlerRan'] === '1'
    };
  });
}

/**
 * Whether WP Rocket's runtime took the hover handler over for the delay
 * (it rebuilds each delayed `on…` attribute with `new Function` — what a
 * policy without eval refuses).
 */
async function handlerDelayed(page: Page): Promise<boolean> {
  return await page.evaluate(
    () =>
      typeof (document.getElementById('hover') as { rocketonmouseover?: unknown } | null)
        ?.rocketonmouseover === 'function'
  );
}

/** How long "nothing ran" must keep holding after an interaction (a delayed run lands well within it). */
const QUIET_MS = 1_500;

/**
 * Assert the page's run flags keep equal to `expected` over {@link QUIET_MS},
 * sampled: a single read right after the interaction would pass before a
 * delayed run could land.
 *
 * @param page The fixture page.
 * @param expected The flags that must hold.
 */
async function expectRanHolds(page: Page, expected: Ran): Promise<void> {
  const until = Date.now() + QUIET_MS;
  do {
    expect(await ran(page)).toEqual(expected);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } while (Date.now() < until);
  expect(await ran(page)).toEqual(expected);
}

/** Hover the fixture's handler target (the interaction WP Rocket's runtime also waits for). */
async function hover(page: Page): Promise<void> {
  await interact(page);
  await page.locator('#hover').hover();
}

/** Every banner note in the overlay. */
async function bannerNotes(page: Page): Promise<string[]> {
  return (await readBanners(page)).flatMap((banner) => banner.notes);
}

test.describe('Delay JS simulation on fixture pages', () => {
  // The overlay restores the origin's saved draft: each case starts from As served,
  // with the widget on (the default) whatever an earlier suite left.
  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test('a page without WP Rocket is simulated with the bundled runtime: every script waits for an interaction', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openCapturedBuilder(extension, (hook) =>
      openFixturePage(extension, '/simulation/plain.html', undefined, hook)
    );
    const { page, tabId } = opened;
    try {
      expect(await ran(page)).toEqual({ external: true, inline: true, handler: false });
      expect(await applySimulated(page)).toBe('Applied');
      const html = await lastDocument();
      expect(hasDelayRuntime(html)).toBe(true);
      expect(delayedScriptCount(html)).toBe(2);
      expect(await documentSimulation(extension, tabId)).toMatchObject({
        state: 'simulated',
        delayed: 2,
        runtimeInjected: true,
        listSource: 'bundled',
        listMiss: 'network-error'
      });
      expect(await simulationMarkers(page)).toEqual([expect.stringMatching(MARKER)]);
      await expect(simulatedChip(page, 'header')).toBeVisible();
      expect(await delayLaneLines(page)).toContain(
        'Exclusion list: bundled with WP Rocket 3.24 (latest list unreachable: network error)'
      );

      expect(await ran(page)).toEqual({ external: false, inline: false, handler: false });
      expect(await handlerDelayed(page)).toBe(true);
      await hover(page);
      await expect
        .poll(() => ran(page), RAN)
        .toEqual({ external: true, inline: true, handler: true });
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a policy forbidding the runtime: nothing simulated, the page as served, the policy named', async ({
    extension
  }) => {
    const { opened, lastDocument } = await openCapturedBuilder(extension, (hook) =>
      openFixturePage(extension, '/__e2e/csp/blocked', undefined, hook)
    );
    const { page, tabId } = opened;
    try {
      // As served: the page's own policy refuses its inline script.
      const served = await ran(page);
      expect(served).toEqual({ external: true, inline: false, handler: false });
      expect(await applySimulated(page)).toBe('Applied');
      const html = await lastDocument();
      expect(hasDelayRuntime(html)).toBe(false);
      expect(delayedScriptCount(html)).toBe(0);
      expect(await documentSimulation(extension, tabId)).toMatchObject({
        state: 'csp-blocked',
        runtimeInjected: false
      });
      expect(await simulationMarkers(page)).toEqual([]);
      await expect(simulatedChip(page, 'header')).toHaveCount(0);
      const titles = (await readBanners(page)).map((banner) => banner.title);
      expect(titles).toContain('Not simulated: blocked by this page’s Content Security Policy');
      // Nothing half-running: the scripts ran as served, and an interaction changes nothing.
      expect(await ran(page)).toEqual(served);
      await hover(page);
      await expectRanHolds(page, served);
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a policy without eval nor data: scripts: simulated, those limits named and behaving as on the site', async ({
    extension
  }) => {
    const { opened } = await openCapturedBuilder(extension, (hook) =>
      openFixturePage(extension, '/__e2e/csp/limits', undefined, hook)
    );
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page)).toBe('Applied');
      expect(await documentSimulation(extension, tabId)).toMatchObject({
        state: 'simulated',
        cspLimits: ['eval', 'data']
      });
      expect(await bannerNotes(page)).toEqual(
        expect.arrayContaining([
          'CSP blocks eval: delayed elements’ event handlers fail, as on the site.',
          'CSP blocks data: scripts: Delay JS falls back to inline copies, as on the site.'
        ])
      );
      // Eval refused: the runtime could not take the handler over, as on the site.
      expect(await handlerDelayed(page)).toBe(false);
      await hover(page);
      // The scripts run, the inline one through the runtime's inline fallback.
      await expect.poll(() => ran(page), RAN).toMatchObject({ external: true, inline: true });
      expect(await page.evaluate(() => sessionStorage.getItem('rocketCSPIssue'))).toBe('true');
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a policy too large to evaluate: simulated, "CSP not evaluated"', async ({ extension }) => {
    const { opened } = await openCapturedBuilder(extension, (hook) =>
      openFixturePage(extension, '/__e2e/csp/oversized', undefined, hook)
    );
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page)).toBe('Applied');
      const report = await documentSimulation(extension, tabId);
      expect(report).toMatchObject({ state: 'simulated', cspUnavailable: 'oversized' });
      expect(report.cspLimits).toBeUndefined();
      expect(await bannerNotes(page)).toContain(
        'CSP not evaluated (too large to check): Delay JS scripts it blocks aren’t named.'
      );
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
    }
  });

  test('a page serving its own marker is not simulated: "Simulation not verified" on the widget', async ({
    extension
  }) => {
    const opened = await openFixturePage(extension, '/simulation/forged-marker.html');
    try {
      expect(await simulationMarkers(opened.page)).toHaveLength(1);
      const pill = opened.page.locator(`${STRIP_HOST} .ins-pill`);
      await expect(pill).toBeVisible(RAN);
      await pill.focus();
      await opened.page.keyboard.press('Enter');
      const row = opened.page.locator(`${STRIP_HOST} .ins-row`, {
        has: opened.page.locator('.ins-chip', { hasText: /^Delay JS$/ })
      });
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveAttribute(
        'data-fdt-strip-modifier',
        'unverified',
        RAN
      );
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveText('Simulation not verified');
      await expect(opened.page.locator(`${STRIP_HOST} [data-fdt-strip-pill-builder]`)).toHaveCount(
        0
      );
    } finally {
      await opened.page.close();
    }
  });
});
