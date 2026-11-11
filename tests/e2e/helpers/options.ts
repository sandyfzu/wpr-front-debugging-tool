/**
 * The options page's harness seam: open the real `options.html` tab over the
 * installed bundle, drive its registry rows by role/row-id, and read or write
 * the real `sync:options` item from the service worker — the same storage
 * every surface reads, never a test double.
 *
 * Everything after `goto` is shipped app code (the P9A page model over the
 * real storage contract, the P9B page); this helper owns only the tab's URL,
 * the pre-navigation media emulation (the audit's palette rule: the emulated
 * scheme must exist before the document renders), and the locators.
 *
 * The seeded/preconditioned writes go through `chrome.storage` exactly like
 * the real surfaces' shared-profile contract asks (every suite declares its
 * own preconditions; a suite restores what it mutates).
 *
 * Harness-only: no shipped module imports this file.
 */
import type { Page } from '@playwright/test';

import { expect } from './extension';
import type { ExtensionDriver } from './extension';

/** The registry's row labels, as the page renders them (user-facing parity). */
export const DBUGGER_ROW_LABEL = "Add an entry to access the D-bugger to WP Rocket's menu";
export const BADGE_ROW_LABEL = 'Show the toolbar badge';
export const APPEARANCE_ROW_LABEL = 'Color theme';
export const PAGE_UI_GATE_ROW_LABEL = 'Show on-page UI';
/** The choice tiles' labels, in the vocabulary's registry order. */
export const CHOICE_LABELS = { system: 'System default', dark: 'Dark', light: 'Light' } as const;
export type ChoiceValue = keyof typeof CHOICE_LABELS;

/** The save/kc outcomes' copy, verbatim (pinned in the unit tier too). */
export const SAVE_SUCCESS_TITLE = 'Options saved';
export const KC_REFRESH_SUCCESS_TITLE = 'Conflict database refreshed';
export const KC_REFRESH_FAILURE_TITLE = 'Refreshing the conflict database failed';
export const KC_REFRESH_REFUSAL = 'The refresh did not complete — try again in a moment.';
export const KC_NEVER_SYNCED = 'Not synced yet — the tool checks hourly.';

/** The raw stored-options shape the harness seeds (the validator's own slots). */
export type RawStoredOptions = Record<string, unknown>;

/** The document element's resolved surface color under each palette. */
export const SURFACE_0 = { dark: 'rgb(11, 13, 16)', light: 'rgb(244, 245, 248)' } as const;

/**
 * Open the options page on the installed bundle and wait for its ready state.
 *
 * @param driver The extension driver.
 * @param options Media emulation applied BEFORE the navigation (a palette
 *   change against a rendered document repaints with a ~2-frame lag; the
 *   boot must see the final scheme). `reducedMotion` arms the reduced-motion
 *   legs the same way.
 * @returns The options page (booted, sections rendered).
 */
export async function openOptionsPage(
  driver: ExtensionDriver,
  options: { colorScheme?: 'dark' | 'light'; reducedMotion?: 'reduce' | 'no-preference' } = {}
): Promise<Page> {
  const id = await driver.extensionId();
  const page = await driver.browserContext.newPage();
  if (options.colorScheme !== undefined || options.reducedMotion !== undefined) {
    await page.emulateMedia({
      ...(options.colorScheme !== undefined ? { colorScheme: options.colorScheme } : {}),
      ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {})
    });
  }
  await page.goto(`chrome-extension://${id}/options.html`, { waitUntil: 'load' });
  await optionsReady(page);
  return page;
}

/**
 * Wait for the page's ready state: the registry's first row renders, no
 * live status is up except the shortcut field's own (permanent, usually
 * empty) region — so the loading line and any stray announcement are gone,
 * whatever their copy — and the instant rows' own reads landed (the
 * shortcut field renders). Storage reads are fast; this is a settle, never
 * an assertion of timing.
 *
 * @param page The options page.
 */
export async function optionsReady(page: Page): Promise<void> {
  await expect(
    page.locator('[data-fdt="option-row"][data-fdt-option="wp-dashboard-dbugger-entry"]')
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[role="status"]:not(#option-palette-chord-status)')).toHaveCount(0);
  await expect(page.locator('[data-fdt="chord-field"]')).toBeVisible();
}

/**
 * The row's visible toggle control (the 24px pill that actually toggles on
 * click — the accessible switch input itself is sr-only).
 *
 * @param page The options page.
 * @param rowId The row's storage id (`data-fdt-option`).
 */
export function rowSwitchTrack(page: Page, rowId: string): ReturnType<Page['locator']> {
  return page.locator(
    `[data-fdt="option-row"][data-fdt-option="${rowId}"] [data-fdt-switch-track]`
  );
}

/**
 * The row's accessible switch (state reads; keyboard activation rides the
 * real focus + Space, never a synthetic click).
 *
 * @param page The options page.
 * @param rowId The row's storage id.
 */
export function rowSwitchInput(page: Page, rowId: string): ReturnType<Page['locator']> {
  return page.locator(`[data-fdt="option-row"][data-fdt-option="${rowId}"]`).getByRole('switch');
}

/**
 * The choice group's visible tile label for one value (the label click
 * selects; the radio input itself is visually hidden).
 *
 * @param page The options page.
 * @param value The tile's choice value.
 */
export function choiceTile(page: Page, value: ChoiceValue): ReturnType<Page['locator']> {
  return page.locator(`[data-fdt="choice"][data-fdt-choice-value="${value}"] label`);
}

/**
 * Click Save and await its typed success toast (the model's outcome).
 *
 * @param page The options page (must be ready).
 */
export async function saveOptions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expectToast(page, 'success', SAVE_SUCCESS_TITLE);
}

/**
 * Expect one toast in the region by tone + title (and optional description).
 *
 * @param page The page mounting the toast region.
 * @param tone The toast's tone (`data-fdt-tone`).
 * @param title The exact headline text.
 * @param description The exact secondary line, when one must be there.
 */
export async function expectToast(
  page: Page,
  tone: 'success' | 'error' | 'info',
  title: string,
  description?: string
): Promise<void> {
  // The newest matching card: repeated side effects can keep an earlier
  // identical toast alive (its 4 s window) — the fired one is the last.
  const toast = page
    .locator(`[data-fdt="toast"][data-fdt-tone="${tone}"]`)
    .filter({ hasText: title })
    .last();
  await expect(toast, `the ${tone} toast "${title}" is up`).toBeVisible();
  if (description !== undefined) {
    await expect(toast, 'the toast names its remedy').toContainText(description);
  }
}

/** Read the real `sync:options` item from the service worker. */
export async function readStoredOptions(
  driver: ExtensionDriver
): Promise<RawStoredOptions | undefined> {
  return await driver.evaluateInWorker(async () => {
    const stored = (await chrome.storage.sync.get(['options']))['options'];
    return stored as RawStoredOptions | undefined;
  }, undefined);
}

/** Write the real `sync:options` item from the service worker (whole shape). */
export async function writeStoredOptions(
  driver: ExtensionDriver,
  options: RawStoredOptions
): Promise<void> {
  await driver.evaluateInWorker(async (value: RawStoredOptions) => {
    await chrome.storage.sync.set({ options: value });
  }, options);
}

/**
 * Restore the fresh-install shape: remove the item entirely — reads degrade
 * to the documented fallback (the shared profile's neutral state for the
 * next suite).
 */
export async function resetStoredOptions(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async () => {
    await chrome.storage.sync.remove(['options']);
  }, undefined);
}

/**
 * Stamp the page's JS realm. A later {@link expectRealmAlive} failing means
 * the document reloaded in between — the no-reload assertions' evidence.
 *
 * @param page Any page the suite must prove stayed mounted.
 */
export async function stampRealm(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as { __e2eRealmStamp?: number }).__e2eRealmStamp = Date.now();
  });
}

/** Assert the page's JS realm survived (no reload/navigation since the stamp). */
export async function expectRealmAlive(page: Page): Promise<void> {
  const alive = await page.evaluate(
    () => (window as { __e2eRealmStamp?: number }).__e2eRealmStamp !== undefined
  );
  expect(alive, 'the page must not have reloaded — its JS realm survives').toBe(true);
}

/**
 * The document root's resolved palette state: the `data-theme` declaration
 * plus the computed canvas color (`light-dark()`'s answer).
 *
 * @param page An extension-document page (options/panel).
 */
export async function readDocumentTheme(page: Page): Promise<{
  dataTheme: string | null;
  background: string;
}> {
  return await page.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    background: getComputedStyle(document.documentElement).backgroundColor
  }));
}

/**
 * Assert an extension document renders the System palette for the emulated
 * scheme: no stored Dark/Light pins `data-theme` on its root, and the root's
 * computed `color-scheme` (pinned per palette by the tokens) is the scheme.
 * Emulated media alone can't prove it: a choice an earlier suite left stored
 * wins over it.
 *
 * @param page An extension-document page (options/panel) booted under `scheme`.
 * @param scheme The emulated `prefers-color-scheme` arm the page must render.
 */
export async function expectSystemPalette(page: Page, scheme: 'dark' | 'light'): Promise<void> {
  await expect(page.locator('html'), 'no stored Dark/Light pins the palette').not.toHaveAttribute(
    'data-theme'
  );
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), {
      message: `the root renders the ${scheme} palette`
    })
    .toBe(scheme);
}

/** Remove the instant rows' items (gate + shortcut): reads degrade to their defaults. */
export async function resetInstantRows(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async () => {
    await chrome.storage.sync.remove(['page-ui-gate', 'palette-chord']);
  }, undefined);
}

/** Read the raw instant items (`page-ui-gate`, `palette-chord`) from the service worker. */
export async function readInstantRows(
  driver: ExtensionDriver
): Promise<{ gate: unknown; chord: unknown }> {
  return await driver.evaluateInWorker(async () => {
    const stored = await chrome.storage.sync.get(['page-ui-gate', 'palette-chord']);
    return { gate: stored['page-ui-gate'], chord: stored['palette-chord'] };
  }, undefined);
}
