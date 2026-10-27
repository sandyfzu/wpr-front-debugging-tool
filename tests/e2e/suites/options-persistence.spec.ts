/**
 * P9.1 — the options page's storage persistence suite.
 *
 * The choices made on the REAL page (its switches + the appearance tri-state)
 * must land on the real `sync:options` item through the model's Save, survive
 * a page reload, and never erase what they don't own: the side-by-side
 * overlay's `sbs*` flags and unknown boolean ids (the tolerant validator's
 * contract) ride every whole-shape write.
 *
 * Assert surfaces, named per assert: the page's own controls (role queries,
 * the same vocabulary the unit tier pins), the real storage item read back
 * from the service worker, and the toast region.
 *
 * The save window's read-modify-write race (the P9B receipt's open
 * disposition) is protocol-level and NOT re-tested here: this suite's
 * concurrent-writer leg writes while the page is idle (outside the save's
 * flight), the only shape a browser suite can order deterministically.
 */

import { expect, test } from '../helpers/extension';
import type { Page } from '@playwright/test';
import {
  CHOICE_LABELS,
  choiceTile,
  openOptionsPage,
  readStoredOptions,
  resetStoredOptions,
  rowSwitchInput,
  rowSwitchTrack,
  saveOptions,
  writeStoredOptions
} from '../helpers/options';

/** The D-bugger row's storage id (the canonical improvement key). */
const DBUGGER_ROW_ID = 'wp-dashboard-dbugger-entry';
/** The toolbar-badge row's storage id. */
const BADGE_ROW_ID = 'toolbarBadge';

/** The appearance row's checked value, read off the checked radio input. */
async function checkedChoice(page: Page): Promise<string> {
  // The tile's value attribute lives on the item wrapper, not the hidden
  // input the role query resolves — read through the wrapper.
  const value = await page.evaluate((): string => {
    const inputs = [
      ...document.querySelectorAll<HTMLInputElement>('[data-fdt="choice"] input[type="radio"]')
    ];
    const checked = inputs.find((input) => input.checked);
    const wrapper = checked?.closest('[data-fdt="choice"]');
    const found = wrapper?.getAttribute('data-fdt-choice-value');
    if (found === null || found === undefined) throw new Error('no checked choice tile rendered');
    return found;
  });
  return value;
}

test.describe('options persistence', () => {
  test('choices save, a reload restores them, and sibling/unknown fields survive', async ({
    extension
  }) => {
    // Seed the real store with sibling flags + unknown ids the page doesn't
    // own, in non-default values (a write that reset them to defaults would
    // fail these): `sbsScrollSync: false` off-default, `sbsMobileSim: true`.
    await writeStoredOptions(extension, {
      improvements: {
        [DBUGGER_ROW_ID]: true,
        'e2e-unknown-improvement': false
      },
      appearance: 'system',
      features: {
        [BADGE_ROW_ID]: true,
        sbsScrollSync: false,
        sbsMobileSim: true,
        sbsDesktopWidth: true,
        'e2e-unknown-flag': true
      }
    });
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      // The seeded values render: both switches on, System checked.
      await expect(rowSwitchInput(page, DBUGGER_ROW_ID)).toBeChecked();
      await expect(rowSwitchInput(page, BADGE_ROW_ID)).toBeChecked();
      await expect(page.getByRole('radio', { name: CHOICE_LABELS.system })).toBeChecked();

      // Edit through the real controls: both switches off + Dark chosen.
      await rowSwitchTrack(page, DBUGGER_ROW_ID).click();
      await rowSwitchTrack(page, BADGE_ROW_ID).click();
      await choiceTile(page, 'dark').click();
      await expect(rowSwitchInput(page, DBUGGER_ROW_ID)).not.toBeChecked();
      await expect(page.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();
      // The appearance choice persists instantly (not Save-gated): wait for
      // its whole-shape write to settle before the concurrent leg.
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'])
        .toBe('dark');

      // Concurrent-writer leg at the real seam: another surface's boolean id
      // lands while the page sits idle (outside any save flight).
      await extension.evaluateInWorker(async () => {
        const stored = (await chrome.storage.sync.get(['options']))['options'] as Record<
          string,
          unknown
        >;
        const features = { ...(stored['features'] as Record<string, unknown>) };
        features['e2e-unknown-concurrent'] = true;
        await chrome.storage.sync.set({ options: { ...stored, features } });
      }, undefined);

      await saveOptions(page);

      // The stored shape: exactly the three groups (the model's whole-shape
      // write), with the page's choices AND everything it doesn't own.
      const stored = await readStoredOptions(extension);
      expect(Object.keys(stored ?? {}).sort()).toEqual(['appearance', 'features', 'improvements']);
      const improvements = stored?.['improvements'] as Record<string, unknown>;
      const features = stored?.['features'] as Record<string, unknown>;
      expect(improvements[DBUGGER_ROW_ID]).toBe(false);
      expect(features[BADGE_ROW_ID]).toBe(false);
      expect(stored?.['appearance']).toBe('dark');
      expect(improvements['e2e-unknown-improvement']).toBe(false);
      expect(features['sbsScrollSync']).toBe(false);
      expect(features['sbsMobileSim']).toBe(true);
      expect(features['sbsDesktopWidth']).toBe(true);
      expect(features['e2e-unknown-flag']).toBe(true);
      expect(features['e2e-unknown-concurrent']).toBe(true);

      // A reload renders the saved shape back (persistence, not session state).
      await page.reload({ waitUntil: 'load' });
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'])
        .toBe('dark');
      await expect(rowSwitchInput(page, DBUGGER_ROW_ID)).not.toBeChecked();
      await expect(rowSwitchInput(page, BADGE_ROW_ID)).not.toBeChecked();
      await expect(page.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();
      expect(await checkedChoice(page)).toBe('dark');
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('a clean page keeps Save disabled; returning a toggle to its baseline re-cleans', async ({
    extension
  }) => {
    await resetStoredOptions(extension); // Fresh-install defaults.
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      const save = page.getByRole('button', { name: 'Save', exact: true });
      await expect(save, 'nothing changed — the dirty gate holds Save off').toBeDisabled();

      // One edit dirties; the same edit reverted re-compares clean.
      await rowSwitchTrack(page, BADGE_ROW_ID).click();
      await expect(save, 'one edit arms Save').toBeEnabled();
      await expect(rowSwitchInput(page, BADGE_ROW_ID)).not.toBeChecked();
      await rowSwitchTrack(page, BADGE_ROW_ID).click();
      await expect(rowSwitchInput(page, BADGE_ROW_ID)).toBeChecked();
      await expect(save, 'the draft equals the baseline again — Save disarms').toBeDisabled();
      // No write happened either way: the store still holds the defaults.
      const stored = await readStoredOptions(extension);
      expect(stored, 'no options item was ever written').toBeUndefined();
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('the whole registry renders with wired labels and descriptions', async ({ extension }) => {
    await resetStoredOptions(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      // Three section cards, each carrying exactly its registry rows; every
      // control described by its row's sentence (the aria-describedby wire).
      await expect(page.locator('[data-fdt="option-row"]')).toHaveCount(5);
      await expect(page.getByRole('heading', { name: 'Improvements' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Features' })).toBeVisible();
      for (const rowId of [
        DBUGGER_ROW_ID,
        'appearance',
        'page-ui-gate',
        'palette-chord',
        BADGE_ROW_ID
      ]) {
        const row = page.locator(`[data-fdt="option-row"][data-fdt-option="${rowId}"]`);
        await expect(row).toBeVisible();
        const describedBy = await row
          .locator('[aria-describedby]')
          .first()
          .getAttribute('aria-describedby');
        expect(describedBy, `the ${rowId} row's description id is wired`).toBeTruthy();
        // The VALUE's whitespace-split id list must contain the row's own
        // description id — robust to a multi-id description, and the
        // single-id pin still holds (the expected id is the target).
        const expectedId = `option-${rowId}-description`;
        expect(
          (describedBy as string).split(/\s+/),
          `the ${rowId} row describes itself with its own description element`
        ).toContain(expectedId);
        await expect(page.locator(`#${expectedId}`)).toHaveText(/.+/);
      }
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });
});
