/**
 * The on-page command palette's keyboard chord (P19F) on a fixture page with
 * editable fields and a document-capture key recorder: a keystroke the
 * chord consumes stops at the window (the recorder never sees it); every
 * other keystroke reaches the page untouched.
 *
 * - Alt+K (the default) opens the palette from a page control, its hint
 *   names the chord in the platform's notation, and nothing else is
 *   consumed: other combinations, and a script-dispatched Alt+K.
 * - A chord that may type (Alt+K) types in editable fields — text input,
 *   textarea, contenteditable content, an input in an open shadow root.
 * - A rebinding re-arms live (no reload): the new chord opens (inside a field
 *   too — a command-modifier chord never types), the old one passes, the
 *   hint follows.
 * - The chord dies with the on-page UI gate and comes back with it.
 * - Perf: opening (first open injects the view), typing and filtering run
 *   no long task (> 50 ms) on the page's main thread.
 *
 * Key names follow the runner's OS (the extension reads the same platform):
 * the command modifier is Meta on macOS, Control elsewhere.
 */
import type { Locator, Page } from '@playwright/test';

import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';

/** The fixture: editable fields, a page control and the key recorder. */
const FIXTURE = '/palette/chord.html';
const PALETTE_HOST = 'wpr-fdt-command-palette';
const NOTICE_HOST = 'wpr-fdt-page-notice';
/** The sync keys the suite drives. */
const GATE_KEY = 'page-ui-gate';
const CHORD_KEY = 'palette-chord';
/** Generous mount wait (the view is injected on demand). */
const MOUNT = { timeout: 10_000 };
/** Whether the runner (and so the extension's platform) is macOS. */
const MAC = process.platform === 'darwin';
/** The command modifier's Playwright name and what the recorder writes for it. */
const MOD = MAC ? 'Meta' : 'Control';
const MOD_RECORDED = MAC ? 'meta' : 'ctrl';
/** The chords' platform notation (the palette hint). */
const ALT_K_HINT = MAC ? '⌥K' : 'Alt+K';
const MOD_K_HINT = MAC ? '⌘K' : 'Ctrl+K';

const field = (page: Page): Locator => page.locator(`${PALETTE_HOST} [data-fdt="palette-input"]`);
const hint = (page: Page): Locator => page.locator(`${PALETTE_HOST} [data-fdt="palette-hint"]`);

/**
 * Write (or remove, with null) one sync item through the service worker.
 *
 * @param driver The extension driver.
 * @param key The sync key.
 * @param value The value, or null to remove it.
 */
async function setSync(driver: ExtensionDriver, key: string, value: unknown): Promise<void> {
  await driver.evaluateInWorker(
    async (arg: { key: string; value: unknown }) => {
      if (arg.value === null) await chrome.storage.sync.remove(arg.key);
      else await chrome.storage.sync.set({ [arg.key]: arg.value });
    },
    { key, value }
  );
}

/**
 * Read and clear the page's key recorder.
 *
 * @param page The fixture page.
 * @returns The keystrokes that reached the document (`alt+KeyK`, …).
 */
async function takeKeys(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const scope = window as unknown as { __pageKeys: string[] };
    const keys = scope.__pageKeys;
    scope.__pageKeys = [];
    return keys;
  });
}

/**
 * Press a key on the page control.
 *
 * @param page The fixture page.
 * @param key The Playwright key combination.
 */
async function pressOnControl(page: Page, key: string): Promise<void> {
  await page.focus('#page-focus');
  await page.keyboard.press(key);
}

/**
 * Press until the palette opens (a storage write reaches the page
 * asynchronously: the first presses may land before the re-arm).
 *
 * @param page The fixture page.
 * @param key The chord.
 */
async function pressUntilOpen(page: Page, key: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await field(page).count()) === 0) await pressOnControl(page, key);
        return await field(page).count();
      },
      { timeout: 10_000, intervals: [100, 250, 500] }
    )
    .toBe(1);
  await expect(field(page)).toBeFocused(MOUNT);
}

test.describe('on-page command palette chord', () => {
  test.beforeEach(async ({ extension }) => {
    await setSync(extension, GATE_KEY, null);
    await setSync(extension, CHORD_KEY, null);
  });

  test.afterEach(async ({ extension }) => {
    await setSync(extension, GATE_KEY, null);
    await setSync(extension, CHORD_KEY, null);
  });

  test('Alt+K opens the palette and is the only keystroke consumed', async ({ extension }) => {
    const { page } = await openFixturePage(extension, FIXTURE);
    // Armed: presses before the arm (gate read, platform ask) reach the page.
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.keyboard.press('Escape');
    await takeKeys(page);

    await pressOnControl(page, 'Alt+KeyK');
    await expect(field(page)).toBeFocused(MOUNT);
    await expect(hint(page)).toHaveText(`Open with ${ALT_K_HINT}`);
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    await expect(page.locator('#page-focus')).toBeFocused();
    expect(await takeKeys(page), 'the chord stopped at the window').toEqual([]);

    // Every other combination reaches the page, and nothing opens.
    for (const key of ['Alt+KeyJ', 'Shift+KeyK', 'KeyK', 'Alt+Shift+KeyK', `${MOD}+KeyK`]) {
      await pressOnControl(page, key);
    }
    expect(await takeKeys(page)).toEqual([
      'alt+KeyJ',
      'shift+KeyK',
      'KeyK',
      'alt+shift+KeyK',
      `${MOD_RECORDED}+KeyK`
    ]);
    // A script-dispatched Alt+K is never the chord (untrusted).
    await page.evaluate(() => {
      document
        .getElementById('page-focus')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', altKey: true, bubbles: true })
        );
    });
    expect(await takeKeys(page)).toEqual(['alt+KeyK']);
    await expect(field(page)).toHaveCount(0);
    await page.close();
  });

  test('a chord that may type is left to editable fields', async ({ extension }) => {
    const { page } = await openFixturePage(extension, FIXTURE);
    // Armed (positive control first): the chord opens from the page control.
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.keyboard.press('Escape');
    await takeKeys(page);

    const editables = [
      page.locator('#text-field'),
      page.locator('#text-area'),
      page.locator('#rich-child'),
      page.locator('x-field #shadow-field')
    ];
    for (const editable of editables) {
      await editable.click();
      await page.keyboard.press('Alt+KeyK');
      expect(await takeKeys(page), `typed through in ${String(editable)}`).toEqual(['alt+KeyK']);
      await expect(field(page)).toHaveCount(0);
    }
    await page.close();
  });

  test('a rebinding re-arms live: the new chord opens, the old one passes', async ({
    extension
  }) => {
    const { page } = await openFixturePage(extension, FIXTURE);
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.keyboard.press('Escape');

    await setSync(extension, CHORD_KEY, { code: 'KeyK', mod: true });
    await pressUntilOpen(page, `${MOD}+KeyK`);
    await expect(hint(page)).toHaveText(`Open with ${MOD_K_HINT}`);
    await page.keyboard.press('Escape');
    await takeKeys(page);

    // The old chord is an ordinary keystroke now.
    await pressOnControl(page, 'Alt+KeyK');
    expect(await takeKeys(page)).toEqual(['alt+KeyK']);
    await expect(field(page)).toHaveCount(0);
    // A command-modifier chord never types: it opens from inside a field too.
    await page.locator('#text-field').click();
    await page.keyboard.press(`${MOD}+KeyK`);
    await expect(field(page)).toBeFocused(MOUNT);
    expect(await takeKeys(page)).not.toContain(`${MOD_RECORDED}+KeyK`);
    await page.close();
  });

  test('the chord dies with the on-page UI gate and comes back with it', async ({ extension }) => {
    const { page } = await openFixturePage(extension, FIXTURE);
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.keyboard.press('Escape');

    await setSync(extension, GATE_KEY, false);
    await expect(page.locator(`${NOTICE_HOST} [data-fdt="page-notice"]`)).toBeVisible(MOUNT);
    await takeKeys(page);
    await pressOnControl(page, 'Alt+KeyK');
    expect(await takeKeys(page), 'not consumed while off').toEqual(['alt+KeyK']);
    await expect(page.locator(PALETTE_HOST)).toHaveCount(0);

    await setSync(extension, GATE_KEY, true);
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.close();
  });

  test('opening, typing and filtering run no long task', async ({ extension }) => {
    const { page } = await openFixturePage(extension, FIXTURE);
    await page.evaluate(() => {
      const scope = window as unknown as { __longTasks: number[]; __observer: PerformanceObserver };
      scope.__longTasks = [];
      // Held on the page: an unreferenced observer may be collected.
      scope.__observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) scope.__longTasks.push(entry.duration);
      });
      scope.__observer.observe({ type: 'longtask' });
    });
    // First open: the view is injected and mounted.
    await pressUntilOpen(page, 'Alt+KeyK');
    await page.keyboard.type('side by side');
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('Backspace');
    await page.keyboard.type('zzz');
    await expect(page.locator(`${PALETTE_HOST} [data-fdt="palette-empty"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    // A re-open (the held view) and a filter again.
    await pressOnControl(page, 'Alt+KeyK');
    await expect(field(page)).toBeFocused(MOUNT);
    await page.keyboard.type('toggle');
    await page.keyboard.press('Escape');
    // Let the observer deliver the last task's entry.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 100);
        })
    );
    const longTasks = await page.evaluate(
      () => (window as unknown as { __longTasks: number[] }).__longTasks
    );
    test
      .info()
      .annotations.push({ type: 'long tasks (ms)', description: JSON.stringify(longTasks) });
    expect(longTasks, 'no task over 50 ms').toEqual([]);
    // The probe bites: an 80 ms task on the page is reported.
    await page.evaluate(() => {
      setTimeout(() => {
        const end = performance.now() + 80;
        while (performance.now() < end) {
          // Busy: one long task of the page's own.
        }
      }, 0);
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks))
      .not.toEqual([]);
    await page.close();
  });
});
