/**
 * The panel keyboard layer's chord suite: the command palette stays
 * reachable, the shortcuts overlay opens/closes with its **advertised `/`
 * chord from real keyboard events**, and the overlay's hint copy matches the
 * binding that actually fires today — the trap class being copy advertising
 * a key a DevTools window keeps for itself (`?` is the documented DevTools
 * Settings chord; owner-observed: `Shift+?` hides this panel behind the
 * Settings dialog).
 *
 * The chord's residual facts the harness CAN decide live — recorded here
 * as evidence, with the real-DevTools interception leg staying manual (the
 * extension-page harness is a tab, not an embedded panel):
 * - the `?` alias is synthesizable through real CDP input, both shapes:
 *   a bare glyph press arrives as one `keydown {key:'?'}` (no Shift leg),
 *   and holding Shift first composes the real two-keydown sequence
 *   `Shift` + `?` — both open the overlay (pinned below);
 * - raw `Shift+/` instead lands as `Shift` + `/` keydowns (the shifted
 *   character never appears as a separate key value at that input layer)
 *   and the overlay opens through the character match — the chord is
 *   `event.key`, never a layout assumption;
 * - the unshifted `'` — the reported layout's glyph on `/`'s key —
 *   matches nothing.
 *
 * The palette also answers the user's chosen page-palette chord (Alt+K by
 * default; ⌥K on macOS), live on a rebinding, with Ctrl/⌘ K unchanged; a
 * may-type chord types inside the palette field instead of toggling.
 *
 * The 2026-10-13 audit round corrected this header's own earlier claim
 * that the `?`-alias keydown "cannot be synthesized": the probes above are
 * this suite's own legs now — a negative capability claim gets probed
 * before it ships, not asserted.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, panelPageUrl, test, type ExtensionDriver } from '../helpers/extension';
import { resetInstantRows } from '../helpers/options';

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

/** Whether the runner (and so the extension's platform) is macOS. */
const MAC = process.platform === 'darwin';

/**
 * Write the chosen palette chord through the service worker (the options
 * page's store), so the open panel must follow it live.
 *
 * @param driver The extension driver.
 * @param chord The raw stored chord.
 */
async function writeChord(driver: ExtensionDriver, chord: unknown): Promise<void> {
  await driver.evaluateInWorker(async (value: unknown) => {
    await chrome.storage.sync.set({ 'palette-chord': value });
  }, chord);
}

/** The shortcuts overlay's palette row keys chip. */
function paletteRowKeys(page: Page): Locator {
  return page
    .getByRole('dialog', SHORTCUTS_DIALOG)
    .locator('[data-fdt="shortcut-row"]', { hasText: 'Open or close the command palette' })
    .locator('kbd');
}

test.describe('panel palette: the chosen chord', () => {
  test.beforeEach(async ({ extension }) => {
    await resetInstantRows(extension);
  });
  test.afterEach(async ({ extension }) => {
    await resetInstantRows(extension);
  });

  test('the default chosen chord toggles the palette; Ctrl/⌘ K still does', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();
      // The binding resolves asynchronously (chord read + platform report):
      // the overlay row naming it is the observable "armed" point.
      await page.keyboard.press('/');
      await expect(paletteRowKeys(page)).toHaveText(`Ctrl / ⌘ K or ${MAC ? '⌥K' : 'Alt+K'}`);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);

      await page.keyboard.press('Alt+KeyK');
      await expect(page.getByRole('combobox')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('combobox')).toHaveCount(0);

      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('combobox')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByRole('combobox')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('a rebinding applies live: the new chord toggles, the old one passes, the row follows', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      // The narrowest width the bar holds (§D): the longer row never scrolls.
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();
      await page.keyboard.press('/');
      await expect(paletteRowKeys(page)).toHaveText(`Ctrl / ⌘ K or ${MAC ? '⌥K' : 'Alt+K'}`);

      await writeChord(extension, { code: 'KeyO', mod: true, alt: true });
      // The open overlay re-renders from the live binding (no reload).
      await expect(paletteRowKeys(page)).toHaveText(`Ctrl / ⌘ K or ${MAC ? '⌥⌘O' : 'Ctrl+Alt+O'}`);
      // A fixed dialog never widens the document, so measure the boxes: the
      // dialog fits the viewport and every row stays inside it (no clipping).
      const fit = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (dialog === null) return null;
        const box = dialog.getBoundingClientRect();
        const rows = [...dialog.querySelectorAll('[data-fdt="shortcut-row"]')].map((row) =>
          row.getBoundingClientRect()
        );
        return {
          dialogFits: box.left >= 0 && box.right <= window.innerWidth,
          rowsFit: rows.every((row) => row.left >= box.left && row.right <= box.right),
          dialogScrolls: dialog.scrollWidth > dialog.clientWidth
        };
      });
      expect(fit, 'no horizontal overflow at 320 px').toEqual({
        dialogFits: true,
        rowsFit: true,
        dialogScrolls: false
      });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);

      await page.keyboard.press('Alt+KeyK');
      await expect(page.getByRole('combobox')).toHaveCount(0);
      await page.keyboard.press('ControlOrMeta+Alt+KeyO');
      await expect(page.getByRole('combobox')).toBeVisible();
      await page.keyboard.press('ControlOrMeta+Alt+KeyO');
      await expect(page.getByRole('combobox')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('a may-type chosen chord types inside the palette field (no toggle there)', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await page.keyboard.press('/');
      await expect(paletteRowKeys(page)).toHaveText(`Ctrl / ⌘ K or ${MAC ? '⌥K' : 'Alt+K'}`);
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+k');
      const field = page.getByRole('combobox');
      await expect(field).toBeVisible();
      await page.waitForFunction(
        (): boolean => document.activeElement?.getAttribute('role') === 'combobox'
      );
      await page.keyboard.press('Alt+KeyK');
      // Still open: the keystroke belonged to the field.
      await expect(field).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
    } finally {
      await page.close();
    }
  });
});

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
      // The shell (and its global key listener) mounts after the boot's storage reads.
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();
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

  test('the ? alias lives: bare glyph and the real Shift-held composition open the overlay', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();

      // synthesized-alias leg 1: bare glyph press — one keydown, no Shift.
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);

      // synthesized-alias leg 2: Shift held first — the real two-keydown
      // composition (the same shape a physical keyboard produces).
      await page.keyboard.down('Shift');
      await page.keyboard.press('?');
      await page.keyboard.up('Shift');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('typing / inside the palette field stays a query (the guard, real input)', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await page.keyboard.press('ControlOrMeta+k');
      const field = page.getByRole('combobox');
      await expect(field).toBeVisible();
      // The dialog autofocus must have landed before the keystroke: a press
      // aimed at nothing would hit the body (the guard's whole question).
      await page.waitForFunction(
        (): boolean => document.activeElement?.getAttribute('role') === 'combobox'
      );

      await page.keyboard.press('/');
      // No overlay mounts; the glyph belongs to the query — the field keeps
      // it (not swallowed by a preventDefault).
      await expect(page.getByRole('dialog', SHORTCUTS_DIALOG)).toHaveCount(0);
      await expect(field).toBeVisible();
      expect(await field.inputValue()).toContain('/');
      await page.keyboard.press('Escape');
      await expect(field).toHaveCount(0);
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

test.describe('shortcuts overlay at short heights', () => {
  for (const height of [500, 650]) {
    test(`320×${String(height)}: the plate stays on screen and the last row scrolls into reach`, async ({
      extension
    }) => {
      const page = await extension.browserContext.newPage();
      try {
        await page.setViewportSize({ width: 320, height });
        await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
        await expect(page.getByRole('link', { name: 'Detections' })).toBeVisible();
        await page.keyboard.press('/');
        const dialog = page.getByRole('dialog', SHORTCUTS_DIALOG);
        await expect(dialog).toBeVisible();
        const rows = dialog.locator('[data-fdt="shortcut-rows"]');

        /** The plate's and the rows' boxes, and the last row's place in the scroller. */
        const measure = async (): Promise<{
          plateTop: number;
          plateBottom: number;
          titleVisible: boolean;
          lastRowInside: boolean;
          scrollTop: number;
          overflowsY: boolean;
          scrollsX: boolean;
        }> =>
          await rows.evaluate((scroller) => {
            const plate = scroller.closest('[role="dialog"]');
            const title = plate?.querySelector('[data-fdt="dialog-title"]');
            const last = scroller.lastElementChild;
            if (!plate || !title || !last) throw new Error('missing overlay parts');
            const box = plate.getBoundingClientRect();
            const port = scroller.getBoundingClientRect();
            const lastBox = last.getBoundingClientRect();
            const titleBox = title.getBoundingClientRect();
            return {
              plateTop: box.top,
              plateBottom: box.bottom,
              titleVisible: titleBox.top >= box.top && titleBox.bottom <= port.top,
              lastRowInside: lastBox.top >= port.top - 0.5 && lastBox.bottom <= port.bottom + 0.5,
              scrollTop: scroller.scrollTop,
              overflowsY: scroller.scrollHeight > scroller.clientHeight,
              scrollsX: scroller.scrollWidth > scroller.clientWidth
            };
          });

        const initial = await measure();
        // The plate fits the viewport (its cap follows its own top offset).
        expect(initial.plateTop).toBeGreaterThanOrEqual(0);
        expect(initial.plateBottom).toBeLessThanOrEqual(height);
        expect(initial.titleVisible).toBe(true);
        expect(initial.scrollsX).toBe(false);
        // Both heights are short of the whole table at 320 px: the rows must scroll.
        expect(initial.lastRowInside).toBe(false);
        expect(initial.overflowsY).toBe(true);

        // Keyboard: the scroller is the tab stop after the close control; End scrolls it.
        await expect(dialog.locator('[data-fdt="dialog-close"]')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(rows).toBeFocused();
        await page.keyboard.press('End');
        await expect.poll(async () => (await measure()).lastRowInside).toBe(true);
        const scrolled = await measure();
        expect(scrolled.scrollTop).toBeGreaterThan(0);
        // The title and the plate stayed put while the rows scrolled.
        expect(scrolled.titleVisible).toBe(true);
        expect(scrolled.plateBottom).toBe(initial.plateBottom);

        // Pointer: the wheel over the rows scrolls them back (the modal's scroll lock spares them).
        const port = await rows.boundingBox();
        if (port === null) throw new Error('no scroller box');
        await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2);
        await page.mouse.wheel(0, -2000);
        await expect.poll(async () => (await measure()).scrollTop).toBe(0);
        await page.mouse.wheel(0, 2000);
        await expect.poll(async () => (await measure()).lastRowInside).toBe(true);
      } finally {
        await page.close();
      }
    });
  }
});
