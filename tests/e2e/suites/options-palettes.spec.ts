/**
 * The options page's appearance suite: the three-way choice over the
 * real page, its persistence, and the live cross-surface restyling.
 *
 * The seams this suite pins (all through shipped code, no test doubles):
 * - **OS-emulated System** — the emulated `prefers-color-scheme` exists
 *   BEFORE the navigation (the audit's palette rule), the extension document
 *   keeps no `data-theme` for `system` (the token stylesheet's `:root` media
 *   query owns it), and an OS flip repaints the mounted page live.
 * - **Explicit choices** — a tile click persists instantly (the page's own
 *   writer seam) and wins over the OS scheme, across a reload.
 * - **Boot resolution** — the paint lock releases into the resolved palette
 *   (the resolved state; the before-first-paint ordering is the unit tier's
 *   pin over `lib/appearance` — this browser leg asserts what renders).
 * - **Live cross-surface** — a choice made in options restyles the open
 *   panel document, the injected side-by-side overlay (the mount's shared
 *   live-theme leg, the code path every injected UI rides) and the on-page
 *   detection strip (over the real site) with no reload anywhere.
 */

import type { Page } from '@playwright/test';

import { expect, openFixturePage, test, type ExtensionDriver } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import {
  CHOICE_LABELS,
  choiceTile,
  expectRealmAlive,
  openOptionsPage,
  readStoredOptions,
  readDocumentTheme,
  resetStoredOptions,
  stampRealm,
  INJECTED_SURFACE_0,
  PAGE_SURFACE_0,
  writeStoredOptions
} from '../helpers/options';
import { openSitePage, SITE_URL } from '../helpers/site';
import { STRIP_HOST, WIDGET_ORIGINS_KEY } from '../helpers/strip-pill';

/** The strip's mount settle (the hub's pass answers after the page loads). */
const MOUNT_SETTLE: { timeout: number; intervals: number[] } = {
  timeout: 15_000,
  intervals: [250, 500]
};
/** The live-restyle polls' profile (a storage-watch round trip). */
const RESTYLE_POLL: { timeout: number; intervals: number[] } = {
  timeout: 10_000,
  intervals: [100, 250, 500]
};

/** The strip's pill surface color under each palette (`--surface-2`). */
const PILL_SURFACE_2 = { dark: 'rgb(23, 27, 33)', light: 'rgb(255, 255, 255)' } as const;

/** The overlay's shadow-tree palette state (the genuine in-page probe). */
interface OverlayState {
  /** The container's `data-theme` declaration. */
  theme: string | null;
  /** The `.sbs-overlay` background, resolved from the palette. */
  background: string;
}

/**
 * Read the open overlay's shadow tree palette state. Throws naming the
 * missing piece when the mount's shape changed — a suite-breaking wiring
 * change, not a palette failure.
 *
 * @param page The fixture page with the overlay open.
 */
async function readOverlayState(page: Page): Promise<OverlayState> {
  return await page.evaluate((): OverlayState => {
    const host = document.querySelector('wpr-fdt-side-by-side');
    const overlay = host?.shadowRoot?.querySelector<HTMLElement>('.sbs-overlay');
    const container = overlay?.parentElement ?? null;
    if (overlay === null || overlay === undefined || container === null) {
      throw new Error('the overlay shadow-tree shape is not in the page');
    }
    return {
      theme: container.getAttribute('data-theme'),
      background: getComputedStyle(overlay).backgroundColor
    };
  });
}

/**
 * Enable the detection widget for the site origin through the same storage
 * seam the context-menu arm writes (an explicit entry wins both ways), so
 * the strip leg's precondition is declared, never assumed from defaults.
 *
 * @param driver The extension driver.
 */
async function enableStripForSite(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(
    async (payload: { key: string; origin: string }) => {
      const current = (await chrome.storage.sync.get([payload.key]))[payload.key] as
        Record<string, unknown> | undefined;
      await chrome.storage.sync.set({
        [payload.key]: { ...(current ?? {}), [payload.origin]: { enabled: true } }
      });
    },
    { key: WIDGET_ORIGINS_KEY, origin: new URL(SITE_URL).origin }
  );
}

/** Remove the strip's origin entries again (no leg's write outlives its leg). */
async function clearStripOptIn(driver: ExtensionDriver): Promise<void> {
  await driver.evaluateInWorker(async (key: string) => {
    await chrome.storage.sync.remove([key]);
  }, WIDGET_ORIGINS_KEY);
}

/**
 * Every switch's knob against its pill on the page: the WCAG contrast of
 * the handle's painted color over the pill's, per switch and state.
 *
 * @param page The options page.
 * @returns One `{ checked, ratio }` per switch.
 */
function switchKnobContrasts(page: Page): Promise<{ checked: boolean; ratio: number }[]> {
  return page.evaluate(() => {
    /** Relative luminance of a computed `rgb(…)` color. */
    const luminance = (color: string): number => {
      const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/gu) ?? []).map(Number);
      const linear = (channel: number): number => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    return [...document.querySelectorAll('[data-fdt="switch"]')].map((root) => {
      const handle = root.querySelector('[data-fdt-switch-handle]');
      const pill = root.querySelector('[data-fdt-switch-thumb]');
      if (handle === null || pill === null) throw new Error('a switch without its knob or pill');
      const [lighter, darker] = [
        luminance(getComputedStyle(handle).backgroundColor),
        luminance(getComputedStyle(pill).backgroundColor)
      ].sort((a, b) => b - a) as [number, number];
      return {
        checked: root.querySelector('input')?.checked === true,
        ratio: (lighter + 0.05) / (darker + 0.05)
      };
    });
  });
}

test.describe('options appearance', () => {
  test('System follows the emulated OS scheme live, without a remount', async ({ extension }) => {
    await resetStoredOptions(extension); // No stored choice — the System default.
    const page = await openOptionsPage(extension, { colorScheme: 'dark' });
    try {
      // The static scope attribute survives the build (it selects the
      // extension-page token block the values below come from).
      await expect(page.locator('html')).toHaveAttribute('data-fdt-surface', 'extension-page');
      // System declares no attribute (the media query chain owns the answer).
      const dark = await readDocumentTheme(page);
      expect(dark.dataTheme, 'system keeps the extension document unattributed').toBeNull();
      expect(dark.background).toBe(PAGE_SURFACE_0.dark);
      await stampRealm(page);

      await page.emulateMedia({ colorScheme: 'light' });
      await expect
        .poll(async () => (await readDocumentTheme(page)).background, RESTYLE_POLL)
        .toBe(PAGE_SURFACE_0.light);
      expect(
        (await readDocumentTheme(page)).dataTheme,
        'the flip is the stylesheet answer, not an attribute write'
      ).toBeNull();
      await expectRealmAlive(page);

      await page.emulateMedia({ colorScheme: 'dark' });
      await expect
        .poll(async () => (await readDocumentTheme(page)).background, RESTYLE_POLL)
        .toBe(PAGE_SURFACE_0.dark);
      await expectRealmAlive(page);
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('an explicit choice wins over the OS scheme, persists instantly, and survives a reload', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await choiceTile(page, 'dark').click();
      await expect
        .poll(async () => (await readDocumentTheme(page)).dataTheme, RESTYLE_POLL)
        .toBe('dark');
      expect((await readDocumentTheme(page)).background, 'the pinned palette renders').toBe(
        PAGE_SURFACE_0.dark
      );
      // Instant persistence: the store already carries it (no Save pressed).
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'], RESTYLE_POLL)
        .toBe('dark');

      // A reload boots the resolved state: lock released, palette pinned.
      await page.reload({ waitUntil: 'load' });
      const resolved = await readDocumentTheme(page);
      expect(resolved.dataTheme).toBe('dark');
      expect(resolved.background).toBe(PAGE_SURFACE_0.dark);
      expect(
        await page.evaluate(() => document.documentElement.getAttribute('data-theme-lock')),
        'the paint lock released'
      ).toBe('done');
      await expect(page.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();

      // The other explicit choice wins the same way under the opposite OS arm.
      await page.emulateMedia({ colorScheme: 'dark' });
      await choiceTile(page, 'light').click();
      await expect
        .poll(async () => (await readDocumentTheme(page)).dataTheme, RESTYLE_POLL)
        .toBe('light');
      expect((await readDocumentTheme(page)).background).toBe(PAGE_SURFACE_0.light);
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('the boot resolves the stored palette before the app renders (the resolved state)', async ({
    extension
  }) => {
    // Seed the explicit choice, then open cold: the resolved state is what
    // the browser leg asserts (the before-first-paint ordering is the unit
    // tier's pin over the appearance leg).
    await writeStoredOptions(extension, {
      improvements: {},
      appearance: 'dark',
      features: {}
    });
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      const resolved = await readDocumentTheme(page);
      expect(resolved.dataTheme, 'the stored choice is on the tree').toBe('dark');
      expect(resolved.background, 'no wrong-palette frame survives the boot').toBe(
        PAGE_SURFACE_0.dark
      );
      expect(
        await page.evaluate(() => document.documentElement.getAttribute('data-theme-lock')),
        'the paint lock released'
      ).toBe('done');
      await expect(page.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });

  test('the panel document takes the extension-page palette under System, Dark and Light', async ({
    extension
  }) => {
    // The scope attribute and `data-theme` share `<html>`: every appearance
    // arm must resolve the extension-page pair, never the shared one.
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'dark' }
    });
    const background = async (): Promise<string> => (await readDocumentTheme(panel)).background;
    try {
      await expect(panel.locator('html')).toHaveAttribute('data-fdt-surface', 'extension-page');
      // System: no attribute, the OS scheme picks the branch, live.
      expect((await readDocumentTheme(panel)).dataTheme).toBeNull();
      await expect.poll(background, RESTYLE_POLL).toBe(PAGE_SURFACE_0.dark);
      await panel.emulateMedia({ colorScheme: 'light' });
      await expect.poll(background, RESTYLE_POLL).toBe(PAGE_SURFACE_0.light);

      // Explicit choices win over the OS scheme (each set against the other arm).
      await writeStoredOptions(extension, { improvements: {}, appearance: 'dark', features: {} });
      await expect
        .poll(async () => (await readDocumentTheme(panel)).dataTheme, RESTYLE_POLL)
        .toBe('dark');
      expect(await background()).toBe(PAGE_SURFACE_0.dark);
      await panel.emulateMedia({ colorScheme: 'dark' });
      await writeStoredOptions(extension, { improvements: {}, appearance: 'light', features: {} });
      await expect
        .poll(async () => (await readDocumentTheme(panel)).dataTheme, RESTYLE_POLL)
        .toBe('light');
      expect(await background()).toBe(PAGE_SURFACE_0.light);
    } finally {
      await resetStoredOptions(extension);
      await panel.close();
      await fixture.page.close();
    }
  });

  test('a choice made in options restyles the open panel and the injected overlay live, with no reload', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const options = await openOptionsPage(extension, { colorScheme: 'light' });
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html');
    const overlayPage = await openFixturePage(extension, '/side-by-side.html');
    try {
      // The overlay mounts through its real protocol message (the panel-less
      // open the injected suites drive).
      await extension.sendToTab<boolean>(overlayPage.tabId, 'openSideBySide');
      await expect(
        overlayPage.page.locator('wpr-fdt-side-by-side .sbs-overlay.sbs-overlay--open')
      ).toHaveCount(1);
      for (const page of [options, panel, overlayPage.page]) await stampRealm(page);

      // The System baseline under a light OS: both extension documents
      // unattributed, the overlay's container declaring itself.
      expect((await readDocumentTheme(panel)).dataTheme).toBeNull();
      expect((await readOverlayState(overlayPage.page)).theme).toBe('system');
      expect((await readOverlayState(overlayPage.page)).background).toBe(INJECTED_SURFACE_0.light);

      // One click in options — every open surface restyles live.
      await choiceTile(options, 'dark').click();
      await expect
        .poll(async () => (await readDocumentTheme(options)).dataTheme, RESTYLE_POLL)
        .toBe('dark');
      await expect
        .poll(async () => (await readDocumentTheme(panel)).dataTheme, RESTYLE_POLL)
        .toBe('dark');
      // The panel repaints with the extension-page values, the overlay keeps
      // the shared ones: one choice, two token scopes.
      expect((await readDocumentTheme(panel)).background).toBe(PAGE_SURFACE_0.dark);
      await expect
        .poll(async () => (await readOverlayState(overlayPage.page)).background, RESTYLE_POLL)
        .toBe(INJECTED_SURFACE_0.dark);
      for (const page of [options, panel, overlayPage.page]) await expectRealmAlive(page);

      // …and back, still live, still no reload anywhere.
      await choiceTile(options, 'light').click();
      await expect
        .poll(async () => (await readDocumentTheme(panel)).dataTheme, RESTYLE_POLL)
        .toBe('light');
      expect((await readDocumentTheme(panel)).background).toBe(PAGE_SURFACE_0.light);
      await expect
        .poll(async () => (await readOverlayState(overlayPage.page)).background, RESTYLE_POLL)
        .toBe(INJECTED_SURFACE_0.light);
      for (const page of [options, panel, overlayPage.page]) await expectRealmAlive(page);
    } finally {
      await resetStoredOptions(extension);
      await overlayPage.page.close();
      await panel.close();
      await fixture.page.close();
      await options.close();
    }
  });

  test('a choice made in options restyles the on-page detection strip live, with no reload', async ({
    extension
  }) => {
    await enableStripForSite(extension);
    await resetStoredOptions(extension);
    let sitePage: Awaited<ReturnType<typeof openSitePage>> | null = null;
    let options: Page | null = null;
    try {
      // The strip mounts (its gate: the site origin is opted in explicitly).
      const site = await openSitePage(extension, `${SITE_URL}/fdt/`);
      sitePage = site;
      const pillMounted = async (): Promise<boolean> =>
        await site.page.evaluate(
          (host: string) =>
            document.querySelector(host)?.shadowRoot?.querySelector('.ins-pill') !== null,
          STRIP_HOST
        );
      await expect.poll(pillMounted, MOUNT_SETTLE).toBe(true);
      const opts = await openOptionsPage(extension, { colorScheme: 'light' });
      options = opts;
      await stampRealm(opts);
      const pillBackground = (): Promise<string> => stripPillBackground(site.page);
      // System + light OS resolves the light tile color; the realm stamp
      // precedes every choice click.
      await expect.poll(pillBackground, RESTYLE_POLL).toBe(PILL_SURFACE_2.light);
      await stampRealm(site.page);

      await choiceTile(opts, 'dark').click();
      await expect
        .poll(pillBackground, {
          ...RESTYLE_POLL,
          message: 'the pinned choice restyles the mounted strip without a reload'
        })
        .toBe(PILL_SURFACE_2.dark);

      await choiceTile(opts, 'light').click();
      await expect.poll(pillBackground, RESTYLE_POLL).toBe(PILL_SURFACE_2.light);
      await expectRealmAlive(site.page);
      await expectRealmAlive(opts);
    } finally {
      if (options !== null) await options.close();
      await resetStoredOptions(extension);
      await clearStripOptIn(extension);
      if (sitePage !== null) await sitePage.page.close();
    }
  });

  test('every switch keeps a visible knob, off and on, in both palettes', async ({ extension }) => {
    await resetStoredOptions(extension);
    const page = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      for (const palette of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: palette });
        await expect
          .poll(async () => (await readDocumentTheme(page)).background, RESTYLE_POLL)
          .toBe(PAGE_SURFACE_0[palette]);
        // The switches as they load, then each pressed once (a row can gate
        // another): both states measured on the page.
        const resting = await switchKnobContrasts(page);
        const tracks = page.locator('[data-fdt="switch"] [data-fdt-switch-track]');
        for (const track of await tracks.all()) await track.click();
        const pressed = await switchKnobContrasts(page);
        const knobs = [...resting, ...pressed];
        expect(new Set(knobs.map((knob) => knob.checked))).toEqual(new Set([true, false]));
        for (const knob of knobs)
          expect(knob.ratio, `${palette} ${knob.checked ? 'on' : 'off'}`).toBeGreaterThanOrEqual(3);
      }
    } finally {
      await resetStoredOptions(extension);
      await page.close();
    }
  });
});

/** Read the mounted strip's pill surface color (throws before the mount). */
async function stripPillBackground(page: Page): Promise<string> {
  return await page.evaluate((host: string) => {
    const pill = document
      .querySelector<HTMLElement>(host)
      ?.shadowRoot?.querySelector<HTMLElement>('.ins-pill');
    if (pill === null || pill === undefined) {
      throw new Error('the strip pill is not mounted');
    }
    return getComputedStyle(pill).backgroundColor;
  }, STRIP_HOST);
}
