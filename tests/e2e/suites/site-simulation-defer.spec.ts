/**
 * Defer JS simulation end to end over REAL sessions on the docker site:
 * the Defer JS lane's mode control picked, Apply through the session
 * backend, then the fulfilled document compared byte for byte with WP
 * Rocket's own render of the same page with Defer JS on, and the surfaces
 * read off the tab.
 *
 * The site serves Defer JS by default (the bootstrap baseline), so a page
 * served WITHOUT it needs the setting off: the suite writes
 * `defer_all_js = 0` for the legs that need it and restores the baseline
 * found (every leg and `afterAll`), like the detection matrix. Pages:
 * `/fdt/`, a live render (`fdt-no-store=1`), Delay JS off (`nowprocket=1`)
 * or on (the delay scenario `fdt-delay=1` without `nowprocket`).
 *
 * Cases: Defer JS simulated on a page WP Rocket serves without it equals WP
 * Rocket's Defer JS render, and the overlay and the detection widget say
 * "simulated"; Defer JS and Delay JS simulated together equal WP Rocket's
 * render with both on; the Defer JS control on a page WP Rocket defers
 * (Simulated not offered: already deferred) and on one it delays without
 * deferring (Simulated not offered: delayed first), Disabled still offered.
 */
import type { Locator, Page } from '@playwright/test';
import { applyButton, clearDrafts, reloadThroughSession } from '../helpers/exclusion-overlay';
import { expect, test, type ExtensionDriver } from '../helpers/extension';
import {
  applySimulated,
  deferModeGroup,
  deferModeNotes,
  delayModeGroup,
  delayedScriptCount,
  documentDeferSimulation,
  documentSimulation,
  normalizeDelayRender,
  openCapturedBuilder,
  simulatedChip,
  type CapturedBuilder
} from '../helpers/simulation';
import { openSitePage, SITE_URL } from '../helpers/site';
import { readWprSettings, writeWprSettings, type WprSettings } from '../helpers/site-wpcli';
import { clearWidgetMap, STRIP_HOST } from '../helpers/strip-pill';

/** `/fdt/` live, Delay JS off: Defer JS as the setting says. */
const PLAIN = `${SITE_URL}/fdt/?fdt-no-store=1&nowprocket=1`;

/** The delay scenario live, Delay JS off. */
const DELAY_OFF = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1&nowprocket=1`;

/** The delay scenario live, Delay JS on (WP Rocket delays it). */
const DELAY_ON = `${SITE_URL}/fdt/?fdt-delay=1&fdt-no-store=1`;

/** Bounded wait for surfaces following a load. */
const FRESH = { timeout: 15_000, intervals: [100, 250, 500] };

/** WP Rocket's Defer JS stamp on a script it deferred. */
const DEFER_STAMP = /<script\b[^>]*\bdata-rocket-defer\b/g;

/** The words the surfaces carry. */
const WORDS = {
  appliedBody:
    'Rendered with your exclusions and simulated Defer JS — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows.',
  appliedBothBody:
    'Rendered with your exclusions and simulated Defer JS and Delay JS — not the site’s real setup. The site’s own WP Rocket exclusions aren’t included; add them as rows.',
  alreadyDeferred:
    'WP Rocket already defers scripts on this page — exclusions apply to its output.',
  delayServed:
    'WP Rocket delays scripts on this page and defers them before it delays them, so Defer JS can’t be simulated here.',
  badge: 'Simulated in this tab',
  stripHint: 'Defer JS simulated'
} as const;

/** The settings found before the suite wrote any (restored after every leg and in `afterAll`). */
let found: WprSettings | null = null;

/**
 * The baseline found, Defer JS on or off.
 *
 * @param deferOn Whether WP Rocket's Defer JS is on.
 */
async function writeDefer(deferOn: boolean): Promise<void> {
  if (found === null) throw new Error('the baseline settings were never read');
  await writeWprSettings(deferOn ? found : { ...found, defer_all_js: 0 });
}

/**
 * A render with what legitimately differs between a simulated document and
 * WP Rocket's own removed: the Delay JS normalization (generator meta,
 * markers, speculation rules, WP Rocket's comments, whitespace) plus the
 * minified files' cache-busting `ver` — a settings write purges the minify
 * cache, and the regenerated files carry a new stamp.
 *
 * @param html The document's bytes.
 */
function normalizeRender(html: string): string {
  return normalizeDelayRender(html).replace(/(\/cache\/min\/[^"']*?\?ver=)\d+/g, '$1');
}

/** WP Rocket's live render of `url` (never a stored copy). */
async function liveRender(extension: ExtensionDriver, url: string): Promise<string> {
  const response = await extension.browserContext.request.get(url);
  expect(response.ok()).toBe(true);
  expect(response.headers()['last-modified']).toBeUndefined();
  const html = await response.text();
  expect(html).not.toMatch(/cached@\d+/);
  return html;
}

/** Open a site page with document capture, the overlay injected. */
async function openBuilder(extension: ExtensionDriver, url: string): Promise<CapturedBuilder> {
  return await openCapturedBuilder(extension, (hook) => openSitePage(extension, url, hook));
}

/** Every radio of a mode control: value and disabled state, in order. */
async function modes(group: Locator): Promise<{ value: string; disabled: boolean }[]> {
  return await group.getByRole('radio').evaluateAll((inputs) =>
    inputs.map((input) => ({
      value: (input as HTMLInputElement).value,
      disabled: (input as HTMLInputElement).disabled
    }))
  );
}

/** The open strip card's Defer JS row (the card opened from its pill with the keyboard). */
async function stripDeferRow(page: Page): Promise<Locator> {
  const card = page.locator(`${STRIP_HOST} .dw-card`);
  if (!(await card.isVisible())) {
    const pill = page.locator(`${STRIP_HOST} .dw-pill`);
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(card).toBeVisible();
  }
  return page.locator(`${STRIP_HOST} .dw-row`, {
    has: page.locator('.dw-chip', { hasText: /^Defer JS$/ })
  });
}

test.describe('Defer JS simulation over real sessions', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ extension }) => {
    const settings = await readWprSettings();
    if (Number(settings['defer_all_js']) !== 1) {
      throw new Error(
        'wp_rocket_settings.defer_all_js is not the bootstrap baseline (1) — a killed run left it off: run docker/scripts/up.sh to re-apply it'
      );
    }
    found = settings;
    // Anonymous visitor: a site login from an earlier suite disables caching and optimizations.
    await extension.browserContext.clearCookies({ domain: new URL(SITE_URL).hostname });
  });

  test.afterAll(async () => {
    if (found !== null) await writeWprSettings(found);
  });

  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearWidgetMap(extension);
    await clearDrafts(extension);
  });

  test('Defer JS simulated on a page served without it equals WP Rocket’s Defer JS render; the overlay and the widget say "simulated"', async ({
    extension
  }) => {
    await writeDefer(false);
    const served = await liveRender(extension, PLAIN);
    expect(served.match(DEFER_STAMP)).toBeNull();

    const { opened, errors, lastDocument } = await openBuilder(extension, PLAIN);
    const { page, tabId } = opened;
    try {
      expect(await modes(deferModeGroup(page))).toEqual([
        { value: 'served', disabled: false },
        { value: 'simulated', disabled: false },
        { value: 'disabled', disabled: false }
      ]);
      await expect(deferModeNotes(page)).toHaveCount(0);
      expect(await applySimulated(page, [deferModeGroup(page)])).toBe('Applied');

      const simulated = await lastDocument();
      const report = await documentDeferSimulation(extension, tabId);
      expect(report).toMatchObject({ feature: 'defer_all_js', state: 'simulated' });
      expect(report.deferred).toBeGreaterThan(0);
      expect(simulated.match(DEFER_STAMP)).toHaveLength(report.deferred);

      // The overlay: the applied words name Defer JS, its lane counts the simulation.
      await expect(simulatedChip(page, 'header')).toHaveText('Simulated');
      await expect(page.getByText(WORDS.appliedBody)).toBeVisible();
      await expect(
        page.getByText(
          `${String(report.deferred)} deferred and ${String(report.wrapped)} inline wrapped by the simulation · 0 excluded by your rows`
        )
      ).toBeVisible();
      await expect(deferModeGroup(page).getByRole('radio', { name: 'Simulated' })).toBeChecked();

      // The detection widget: the verified marker as the Defer JS row's modifier + the tab hint.
      const row = await stripDeferRow(page);
      await expect(row.locator('[data-fdt-strip-modifier]')).toHaveText(WORDS.badge, FRESH);
      await expect(
        page.locator(`${STRIP_HOST} [data-fdt-strip-builder] [data-fdt-strip-builder-hint]`)
      ).toHaveText([WORDS.stripHint]);
      expect(errors.errors).toEqual([]);
      await page.getByRole('button', { name: 'Stop' }).click();

      // WP Rocket's own render of the same page with Defer JS on: the same bytes.
      await writeDefer(true);
      const reference = await liveRender(extension, PLAIN);
      // `nowprocket` drops the generator meta; WP Rocket's footer comment names the pass.
      expect(reference).toContain('<!-- wpr_defer_js -->');
      expect(reference.match(DEFER_STAMP)).toHaveLength(report.deferred);
      expect(normalizeRender(simulated)).toBe(normalizeRender(reference));
    } finally {
      await page.close();
      await writeDefer(true);
    }
  });

  test('Defer JS and Delay JS simulated together equal WP Rocket’s render with both on', async ({
    extension
  }) => {
    await writeDefer(false);
    const { opened, lastDocument } = await openBuilder(extension, DELAY_OFF);
    const { page, tabId } = opened;
    try {
      expect(await applySimulated(page, [deferModeGroup(page), delayModeGroup(page)])).toBe(
        'Applied'
      );
      const simulated = await lastDocument();
      const defer = await documentDeferSimulation(extension, tabId);
      expect(defer).toMatchObject({ state: 'simulated' });
      const delay = await documentSimulation(extension, tabId);
      expect(delay).toMatchObject({ state: 'simulated' });

      // The overlay: the applied words name both features (buffer order), each lane counts its own.
      await expect(page.getByText(WORDS.appliedBothBody)).toBeVisible();
      await expect(
        page.getByText(
          `${String(defer.deferred)} deferred and ${String(defer.wrapped)} inline wrapped by the simulation · 0 excluded by your rows`
        )
      ).toBeVisible();
      await expect(
        page.getByText(
          `${String(delay.delayed)} delayed by the simulation · 0 excluded by your rows`
        )
      ).toBeVisible();
      await page.getByRole('button', { name: 'Stop' }).click();

      await writeDefer(true);
      const reference = await liveRender(extension, DELAY_ON);
      expect(reference).toMatch(/data-wpr-features="[^"]*wpr_delay_js[^"]*wpr_defer_js/);
      expect(delayedScriptCount(simulated)).toBe(delayedScriptCount(reference));
      expect(normalizeRender(simulated)).toBe(normalizeRender(reference));
    } finally {
      await page.close();
      await writeDefer(true);
    }
  });

  test('the Defer JS control: not offered where WP Rocket defers, nor where it delays first; Disabled applies', async ({
    extension
  }) => {
    // Baseline: WP Rocket defers here.
    const deferred = await openBuilder(extension, PLAIN);
    try {
      expect(await modes(deferModeGroup(deferred.opened.page))).toEqual([
        { value: 'served', disabled: false },
        { value: 'simulated', disabled: true },
        { value: 'disabled', disabled: false }
      ]);
      await expect(deferModeNotes(deferred.opened.page)).toHaveText([WORDS.alreadyDeferred]);
    } finally {
      await deferred.opened.page.close();
    }

    // Defer JS off, Delay JS on: WP Rocket's served page is delayed, never deferred.
    await writeDefer(false);
    const delayed = await openBuilder(extension, DELAY_ON);
    const { page, tabId } = delayed.opened;
    try {
      expect(await modes(deferModeGroup(page))).toEqual([
        { value: 'served', disabled: false },
        { value: 'simulated', disabled: true },
        { value: 'disabled', disabled: false }
      ]);
      await expect(deferModeNotes(page)).toHaveText([WORDS.delayServed]);
      // Disabled is the feature-wide disable, applied as the switch always did.
      const disabled = deferModeGroup(page).getByRole('radio', { name: 'Disabled' });
      await disabled.focus();
      await page.keyboard.press('Space');
      await expect(disabled).toBeChecked();
      expect(
        await reloadThroughSession(page, async () => {
          await applyButton(page).focus();
          await page.keyboard.press('Enter');
        })
      ).toBe('Applied');
      expect(
        await extension.evaluateInWorker(
          async ({ tab }: { tab: number }) => {
            const all = (await chrome.storage.session.get('exclusion-sessions'))[
              'exclusion-sessions'
            ] as Record<string, { set?: { disable?: { deferJs?: boolean } }; simulate?: unknown }>;
            const record = all[String(tab)];
            return { deferOff: record?.set?.disable?.deferJs, simulate: record?.simulate ?? null };
          },
          { tab: tabId }
        )
      ).toEqual({ deferOff: true, simulate: null });
      await page.getByRole('button', { name: 'Stop' }).click();
    } finally {
      await page.close();
      await writeDefer(true);
    }
  });
});
