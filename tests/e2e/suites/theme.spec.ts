/**
 * The injected-UI palette suite — every UI this content script mounts into a
 * host page (side-by-side overlay, known conflicts, the strip) resolves its
 * palette on its shadow-root container, so ONE mount decision rules them all
 * (`entrypoints/isolated.content/ui/mount.ts`).
 *
 * Why this needs a browser pin: inside a shadow root the mount's isolation
 * reset (`:host { all: initial !important }`) aborts the stylesheet's `:host`
 * scheme chain — a `system` appearance that did not declare itself resolved
 * `light-dark()` to the LIGHT branch under a dark OS (owner-reported: the
 * overlay bar and the conflicts UI stayed white with macOS dark; reproduced
 * live, fixed by declaring `data-theme="system"` → `color-scheme: light
 * dark` on the container). These asserts hold in both emulated OS schemes,
 * which Playwright drives faithfully for `prefers-color-scheme`.
 *
 * Per-case state: storage is cleared (or seeded) per test — the overlay's
 * palette resolves at mount from the fresh options.
 */

import type { Page } from '@playwright/test';
import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';
import { resetStoredOptions } from '../helpers/options';

// One profile serves every suite: the options this file writes go back to the
// fresh-install item after each test (its assertions are over, so a page it
// left open no longer needs them) and no stored choice reaches the next suite.
test.afterEach(async ({ extension }) => {
  await resetStoredOptions(extension);
});

/** The overlay's `.sbs-overlay` background under each palette (tokens: surface-0). */
const SURFACE_0 = { dark: 'rgb(11, 13, 16)', light: 'rgb(244, 245, 248)' } as const;

/** The shadow tree's palette state, read through the open shadow root. */
interface PaletteState {
  /** The container's resolved color-scheme (what light-dark() consults). */
  containerColorScheme: string;
  /** The appearance the mount pinned on the container (or "(unset)"). */
  containerDataTheme: string;
  /** The `.sbs-overlay` background, resolved from light-dark(). */
  overlayBackground: string;
}

/**
 * Read the opened overlay's shadow tree palette state (the genuine in-page
 * probe; the open-state overlay is awaited before reading). Throws naming the
 * missing piece if the mount shape changed — that is a suite-breaking wiring
 * change, not a palette failure.
 *
 * @param page The fixture page with the overlay open.
 * @throws {@link Error} when the overlay's shadow-tree shape is absent.
 */
async function readPalette(page: Page): Promise<PaletteState> {
  return await page.evaluate((): PaletteState => {
    const host = document.querySelector('wpr-fdt-side-by-side');
    if (host === null) throw new Error('the overlay shadow host is not in the page');
    const overlay = host.shadowRoot?.querySelector<HTMLElement>('.sbs-overlay');
    if (overlay === null || overlay === undefined)
      throw new Error('the overlay element is not in the shadow root');
    const container = overlay.parentElement;
    if (container === null) throw new Error('the overlay has no container parent');
    return {
      containerColorScheme: getComputedStyle(container).colorScheme,
      containerDataTheme: container.getAttribute('data-theme') ?? '(unset)',
      overlayBackground: getComputedStyle(overlay).backgroundColor
    };
  });
}

test.describe('injected-UI palette', () => {
  /** Reset options to one appearance, open the fixture page, open its overlay. */
  const openOverlay = async (
    extension: ExtensionDriver,
    appearance: 'unset' | 'dark' | 'light',
    colorScheme: 'dark' | 'light'
  ): Promise<{ page: Page } & { state: () => Promise<PaletteState> }> => {
    await extension.evaluateInWorker(
      (appearance_: string) => {
        const options =
          appearance_ === 'unset'
            ? {}
            : { improvements: {}, appearance: appearance_, features: {} };
        void chrome.storage.sync.set({ options });
      },
      appearance === 'unset' ? '' : appearance
    );
    const fixture = await openFixturePage(extension, '/side-by-side.html');
    await fixture.page.emulateMedia({ colorScheme });
    await extension.sendToTab<boolean>(fixture.tabId, 'openSideBySide');
    await expect(
      fixture.page.locator('wpr-fdt-side-by-side .sbs-overlay.sbs-overlay--open')
    ).toHaveCount(1);
    return { page: fixture.page, state: () => readPalette(fixture.page) };
  };

  test('system default follows a dark OS (the owner-reported white-bar case)', async ({
    extension
  }) => {
    const { state } = await openOverlay(extension, 'unset', 'dark');
    const palette = await state();
    expect(palette.containerDataTheme, 'system is declared on the container').toBe('system');
    expect(palette.containerColorScheme, 'the container accepts both palettes').toBe('light dark');
    expect(palette.overlayBackground).toBe(SURFACE_0.dark);
  });

  test('system default follows a light OS', async ({ extension }) => {
    const { state } = await openOverlay(extension, 'unset', 'light');
    expect((await state()).overlayBackground).toBe(SURFACE_0.light);
  });

  test('an explicit dark choice wins regardless of the OS scheme', async ({ extension }) => {
    // The explicit pin (container scheme "dark") predates the fix above and
    // must not regress alongside it: the attribute still wins per-element.
    const { state } = await openOverlay(extension, 'dark', 'dark');
    const palette = await state();
    expect(palette.containerDataTheme).toBe('dark');
    expect(palette.containerColorScheme).toBe('dark');
    expect(palette.overlayBackground).toBe(SURFACE_0.dark);
  });

  test('system tracks the OS scheme in real time, without a remount', async ({ extension }) => {
    // The container accepts both palettes, so the BROWSER resolves
    // light-dark() — a live OS change repaints the same tree; no listener or
    // re-mount is involved (this is the "system" contract's strongest form).
    const { page, state } = await openOverlay(extension, 'unset', 'light');
    expect((await state()).overlayBackground).toBe(SURFACE_0.light);
    await page.emulateMedia({ colorScheme: 'dark' });
    expect(await state().then((s) => s.overlayBackground)).toBe(SURFACE_0.dark);
  });
});
