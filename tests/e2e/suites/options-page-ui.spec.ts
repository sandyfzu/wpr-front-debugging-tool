/**
 * P19E — the options page's instant rows on the real build: the on-page UI
 * gate (instant write, the pending draft surviving it, live follow of a
 * write from elsewhere) with its cascade over the shortcut row, and the
 * shortcut field driven by real key presses (capture → stored + toast, a
 * reserved refusal named in the live region, Escape cancel, the Ctrl+Alt
 * caveat), with strict axe in the recording and gate-off states.
 *
 * The harness runs on the host OS, so the platform-dependent legs read
 * `process.platform` (the page reads `runtime.getPlatformInfo`, which
 * reports the same machine). Every test restores the items it touches.
 */

import { expect, test } from '../helpers/extension';
import { runPanelAxe } from '../helpers/audit';
import {
  expectToast,
  openOptionsPage,
  PAGE_UI_GATE_ROW_LABEL,
  readInstantRows,
  readStoredOptions,
  resetInstantRows,
  resetStoredOptions,
  rowSwitchInput,
  rowSwitchTrack
} from '../helpers/options';

const IS_MAC = process.platform === 'darwin';
/** Playwright's name for the platform's command modifier. */
const MOD = IS_MAC ? 'Meta' : 'Control';
/** Field text for Alt/Option+P on this OS. */
const ALT_P_TEXT = IS_MAC ? '⌥P' : 'Alt+P';

test.describe('options instant rows', () => {
  test('the gate applies instantly, leaves the draft alone and cascades over the shortcut row', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    await resetInstantRows(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      const before = await readStoredOptions(extension);
      // A pending, unsaved draft edit.
      await rowSwitchTrack(page, 'toolbarBadge').click();
      const save = page.getByRole('button', { name: 'Save', exact: true });
      await expect(save).toBeEnabled();

      await rowSwitchTrack(page, 'page-ui-gate').click();
      await expect(page.getByRole('switch', { name: PAGE_UI_GATE_ROW_LABEL })).not.toBeChecked();
      await expect.poll(async () => (await readInstantRows(extension)).gate).toBe(false);
      await expectToast(page, 'success', 'On-page UI turned off');
      // The draft is untouched: still dirty, still unsaved.
      await expect(save).toBeEnabled();
      await expect(rowSwitchInput(page, 'toolbarBadge')).not.toBeChecked();
      expect(await readStoredOptions(extension)).toEqual(before);

      // Cascade: the shortcut field is held with the note.
      const field = page.locator('[data-fdt="chord-field"]');
      await expect(field).toBeDisabled();
      await expect(page.locator('#option-palette-chord-note')).toContainText('On-page UI is off');

      // Another surface turns it back on (the context-menu rescue's write).
      await extension.evaluateInWorker(async () => {
        await chrome.storage.sync.set({ 'page-ui-gate': true });
      }, undefined);
      await expect(page.getByRole('switch', { name: PAGE_UI_GATE_ROW_LABEL })).toBeChecked();
      await expect(field).toBeEnabled();
      await expect(page.locator('#option-palette-chord-note')).toHaveCount(0);
    } finally {
      await resetStoredOptions(extension);
      await resetInstantRows(extension);
      await page.close();
    }
  });

  test('the shortcut field records real key presses: capture, refusal, cancel, caveat', async ({
    extension
  }) => {
    await resetInstantRows(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'dark' });
    try {
      const field = page.locator('[data-fdt="chord-field"]');
      const status = page.locator('#option-palette-chord-status');
      await field.focus();
      await page.keyboard.press('Enter');
      await expect(field).toHaveAttribute('aria-pressed', 'true');
      await expect(status).toContainText('Press the new shortcut');
      // Strict axe while recording.
      let audit = await runPanelAxe(page);
      expect(audit.violations, audit.detail.join('\n')).toEqual([]);
      expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);

      // A reserved chord is refused and named; recording continues.
      await page.keyboard.press(`${MOD}+KeyC`);
      await expect(status).toContainText('is taken by text editing');
      await expect(field).toHaveAttribute('aria-pressed', 'true');

      // Escape cancels.
      await page.keyboard.press('Escape');
      await expect(field).toHaveAttribute('aria-pressed', 'false');
      await expect(status).toHaveText('Shortcut unchanged');
      expect((await readInstantRows(extension)).chord).toBeUndefined();

      // A valid capture applies at once and confirms.
      await page.keyboard.press('Enter');
      await page.keyboard.press('Alt+KeyP');
      await expect(field).toHaveText(ALT_P_TEXT);
      await expect
        .poll(async () => (await readInstantRows(extension)).chord)
        .toEqual({
          code: 'KeyP',
          alt: true
        });
      await expectToast(page, 'success', 'Palette shortcut saved');
      await expect(page.locator('#option-palette-chord-caveat')).toHaveCount(0);

      // A Ctrl+Alt binding saves and keeps the caveat up.
      await page.keyboard.press('Enter');
      await page.keyboard.press(`${MOD}+Alt+KeyP`);
      await expect
        .poll(async () => (await readInstantRows(extension)).chord)
        .toEqual({
          code: 'KeyP',
          mod: true,
          alt: true
        });
      await expect(page.locator('#option-palette-chord-caveat')).toContainText(
        IS_MAC ? 'On Windows this shortcut is Ctrl+Alt+P' : 'Ctrl+Alt shortcuts may never fire'
      );
      audit = await runPanelAxe(page);
      expect(audit.violations, audit.detail.join('\n')).toEqual([]);
      expect(audit.incomplete, audit.detail.join('\n')).toEqual([]);

      // Reset returns to the default.
      await page.getByRole('button', { name: /^Reset the shortcut to/ }).click();
      await expect
        .poll(async () => (await readInstantRows(extension)).chord)
        .toEqual({
          code: 'KeyK',
          alt: true
        });
    } finally {
      await resetInstantRows(extension);
      await page.close();
    }
  });
});
