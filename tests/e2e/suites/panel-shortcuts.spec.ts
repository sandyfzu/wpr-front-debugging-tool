/**
 * The panel keyboard layer's chord suite: the command palette stays
 * reachable, the shortcuts overlay opens/closes with its **advertised `/`
 * chord from real keyboard events**, and the overlay's hint copy matches the
 * binding that actually fires today — the trap class being copy advertising
 * a key a DevTools window keeps for itself (`?` is the documented DevTools
 * Settings chord; owner-observed: `Shift+?` hides this panel behind the
 * Settings dialog).
 *
 * The chord's two residual facts the harness CAN decide live — recorded
 * here as evidence, with the real-DevTools interception leg staying manual
 * (the extension-page harness is a tab, not an embedded panel):
 * - raw `Shift+/` reaches the page as `Shift` + `/` keydowns (`event.key`
 *   values, no composed `?` at this input layer) and the overlay opens
 *   through the character match — the chord is `event.key`, never a layout
 *   assumption;
 * - the unshifted `'` — the reported layout's glyph on `/`'s key — matches
 *   nothing.
 *
 * The `?`-alias keydown path (`event.key === '?'`, what a real US-layout
 * composition produces) is pinned at the event-dispatch tier in the unit
 * tests; nothing here can synthesize it through real CDP input.
 */
import type { Page } from '@playwright/test';
import { expect, panelPageUrl, test } from '../helpers/extension';

/** The overlay's dialog role/name (the shortcut table's modal). */
const SHORTCUTS_DIALOG = { role: 'dialog' as const, name: 'Keyboard shortcuts' };

/**
 * Install a keydown recorder on the panel page (before a synthetic press) so
 * a leg can assert exactly what the page's own document received.
 *
 * @param page The panel page.
 */
async function installKeyRecorder(page: Page): Promise<void> {
  await page.evaluate((): void => {
    document.addEventListener(
      'keydown',
      (event) => {
        const globalWindow = window as typeof window & {
          __e2eKeys?: string[];
        };
        globalWindow.__e2eKeys = [...(globalWindow.__e2eKeys ?? []), event.key];
      },
      true
    );
  });
}

/** The keys the recorder collected since {@link installKeyRecorder}. */
async function recordedKeys(page: Page): Promise<string[]> {
  return await page.evaluate((): string[] => (window as { __e2eKeys?: string[] }).__e2eKeys ?? []);
}

test.describe('panel shortcuts (the re-owned overlay chord)', () => {
  test('the command palette stays reachable (Ctrl+K opens; Esc closes)', async ({ extension }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();

      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('combobox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('combobox')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('the shortcuts overlay opens and closes with / from a real keyboard event', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();

      await page.keyboard.press('/');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toBeVisible();
      // The toggle is both ways: the same chord closes over an open overlay
      // (the global listener still answers while the modal holds focus).
      await page.keyboard.press('/');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('the overlay’s hint advertises the binding that fires (copy ≠ an untypeable key)', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await page.keyboard.press('/');
      const dialog = page.getByRole('dialog', SHORTCUTS_DIALOG);
      await expect(dialog).toBeVisible();

      // The overlay's own row: keys chip is exactly the typed key, and the
      // palette row's hint repeats the same one key — both sides render the
      // declared binding (the field copy states what actually works).
      const toggleRow = dialog.locator('[data-fdt="shortcut-row"]', {
        hasText: 'Open or close this list'
      });
      await expect(toggleRow.locator('kbd')).toHaveText('/');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+k');
      const row = page.getByRole('option', { name: /Show keyboard shortcuts/ });
      await expect(row).toBeVisible();
      await expect(row.locator('[data-fdt="palette-command-hint"]')).toHaveText('/');
    } finally {
      await page.close();
    }
  });

  test('raw Shift+/ lands as Shift then / — the overlay opens through the character chord', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();

      await installKeyRecorder(page);
      await page.keyboard.press('Shift+/');
      // Empirical (real input path): a raw `Shift+/` chord reaches this
      // document as TWO keydowns whose `event.key` values are `Shift` and
      // `/` — the shifted character never materializes as a separate key
      // value at this layer. The overlay still opened: the binding's
      // character match answers the `/` keydown regardless of the shift
      // flag. (A real US-layout composition produces `event.key === '?'` —
      // the alias — which the browser tier cannot synthesize through real
      // input; that path is pinned at the event-dispatch tier and the
      // in-DevTools interception leg stays manual.)
      expect(await recordedKeys(page)).toEqual(['Shift', '/']);
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('bare ’ (the reported layout’s unshifted glyph on /’s key) triggers nothing', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();

      await installKeyRecorder(page);
      await page.keyboard.press("'");
      // The page received the glyph; no overlay answered it — the chord is
      // the character, never a layout assumption.
      expect(await recordedKeys(page)).toEqual(["'"]);
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);
      await expect(page.getByRole('combobox')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});
