/**
 * The top bar's appearance menu over the real panel document: the button
 * names and shows the resolved palette (System following the emulated OS
 * live), System / Dark / Light picked from the menu restyle the panel live
 * (no reload), each pick persists in the shared options item, survives a
 * panel reload, and reaches the options page — an open one restyles live
 * and its Save of another row keeps the pick, a freshly booted one checks
 * the choice.
 *
 * Every write goes through shipped code (the menu's writer); the suite only
 * resets the item between runs.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../helpers/extension';
import { openPanelForFixture } from '../helpers/panel-data';
import {
  CHOICE_LABELS,
  expectRealmAlive,
  openOptionsPage,
  PAGE_SURFACE_0,
  readDocumentTheme,
  readStoredOptions,
  resetStoredOptions,
  rowSwitchTrack,
  saveOptions,
  stampRealm
} from '../helpers/options';

/** The live-restyle polls' profile (a storage-watch round trip). */
const RESTYLE_POLL: { timeout: number; intervals: number[] } = {
  timeout: 10_000,
  intervals: [100, 250, 500]
};

/* The trigger's names and the rows' words repeat the shipped labels (test
 * literals pin behavior). */
const ROW_NAMES = { system: 'System', dark: 'Dark', light: 'Light' } as const;

/** The appearance trigger (its name starts with "Appearance:"). */
function trigger(panel: Page): ReturnType<Page['getByRole']> {
  return panel.getByRole('button', { name: /^Appearance: / });
}

/**
 * Assert what the control shows: its name and the resolved palette's icon.
 *
 * @param panel The panel page.
 * @param name The trigger's full accessible name.
 * @param resolved The palette the icon shows (moon = dark, sun = light).
 */
async function expectShown(panel: Page, name: string, resolved: 'dark' | 'light'): Promise<void> {
  await expect(trigger(panel)).toHaveAccessibleName(name);
  const control = panel.locator('[data-fdt="appearance-menu"]');
  await expect(control).toHaveAttribute('data-fdt-resolved', resolved);
  await expect(control.locator(`svg.lucide-${resolved === 'dark' ? 'moon' : 'sun'}`)).toHaveCount(
    1
  );
}

/**
 * Open the menu, assert the check sits on `checked`, pick `next`, and wait
 * for the menu to close.
 *
 * @param panel The panel page.
 * @param checked The choice the menu must show as stored.
 * @param next The choice to pick.
 */
async function pick(
  panel: Page,
  checked: keyof typeof ROW_NAMES,
  next: keyof typeof ROW_NAMES
): Promise<void> {
  await trigger(panel).click();
  const menu = panel.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: ROW_NAMES[checked] })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  await menu.getByRole('menuitemradio', { name: ROW_NAMES[next] }).click();
  await expect(menu).toHaveCount(0);
}

/** Poll the panel document until it declares `theme` (null = System). */
async function expectDocumentTheme(page: Page, theme: 'dark' | 'light' | null): Promise<void> {
  await expect
    .poll(async () => (await readDocumentTheme(page)).dataTheme, RESTYLE_POLL)
    .toBe(theme);
}

test.describe('the panel appearance menu', () => {
  test('System, Dark and Light restyle the panel live and persist the choice', async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'dark' }
    });
    try {
      await stampRealm(panel);
      // System under a dark OS: the moon, the OS's palette named.
      await expectShown(panel, 'Appearance: System (Dark)', 'dark');
      expect((await readDocumentTheme(panel)).dataTheme).toBeNull();

      // Light wins over the dark OS, live, and is stored.
      await pick(panel, 'system', 'light');
      await expectDocumentTheme(panel, 'light');
      expect((await readDocumentTheme(panel)).background).toBe(PAGE_SURFACE_0.light);
      await expectShown(panel, 'Appearance: Light', 'light');
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'], RESTYLE_POLL)
        .toBe('light');

      // Dark, the same way.
      await pick(panel, 'light', 'dark');
      await expectDocumentTheme(panel, 'dark');
      expect((await readDocumentTheme(panel)).background).toBe(PAGE_SURFACE_0.dark);
      await expectShown(panel, 'Appearance: Dark', 'dark');

      // Back to System under a light OS, then the OS flips: the icon and
      // the name follow it live.
      await panel.emulateMedia({ colorScheme: 'light' });
      await pick(panel, 'dark', 'system');
      await expectDocumentTheme(panel, null);
      await expect
        .poll(async () => (await readDocumentTheme(panel)).background, RESTYLE_POLL)
        .toBe(PAGE_SURFACE_0.light);
      await expectShown(panel, 'Appearance: System (Light)', 'light');
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'], RESTYLE_POLL)
        .toBe('system');
      await panel.emulateMedia({ colorScheme: 'dark' });
      await expectShown(panel, 'Appearance: System (Dark)', 'dark');
      await expect
        .poll(async () => (await readDocumentTheme(panel)).background, RESTYLE_POLL)
        .toBe(PAGE_SURFACE_0.dark);

      // Every switch was live: the panel never reloaded.
      await expectRealmAlive(panel);
    } finally {
      await resetStoredOptions(extension);
      await panel.close();
      await fixture.page.close();
    }
  });

  test('a pick survives a panel reload and reaches the options page', async ({ extension }) => {
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'light' }
    });
    const options = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await expectShown(panel, 'Appearance: System (Light)', 'light');
      await pick(panel, 'system', 'dark');
      // The open options page restyles live (its clean appearance row and
      // menu follow too — pinned by options-app-bar).
      await stampRealm(options);
      await expectDocumentTheme(options, 'dark');
      expect((await readDocumentTheme(options)).background).toBe(PAGE_SURFACE_0.dark);
      await expectRealmAlive(options);

      // A reload boots the stored choice: palette, name, icon and check.
      await panel.reload({ waitUntil: 'load' });
      const resolved = await readDocumentTheme(panel);
      expect(resolved.dataTheme).toBe('dark');
      expect(resolved.background).toBe(PAGE_SURFACE_0.dark);
      await expectShown(panel, 'Appearance: Dark', 'dark');
      await pick(panel, 'dark', 'light');
      await expectDocumentTheme(options, 'light');

      // A freshly booted options page reads it too.
      await options.close();
      const fresh = await openOptionsPage(extension, { colorScheme: 'dark' });
      try {
        await expect(fresh.getByRole('radio', { name: CHOICE_LABELS.light })).toBeChecked();
        expect((await readDocumentTheme(fresh)).dataTheme).toBe('light');
      } finally {
        await fresh.close();
      }
    } finally {
      await resetStoredOptions(extension);
      if (!options.isClosed()) await options.close();
      await panel.close();
      await fixture.page.close();
    }
  });

  test("an open options page's Save of another row keeps the panel's pick", async ({
    extension
  }) => {
    await resetStoredOptions(extension);
    const { panel, fixture } = await openPanelForFixture(extension, '/pipeline/markers.html', {
      emulation: { colorScheme: 'light' }
    });
    // Loaded before the pick: its draft still holds System.
    const options = await openOptionsPage(extension, { colorScheme: 'light' });
    try {
      await pick(panel, 'system', 'dark');
      await expect
        .poll(async () => (await readStoredOptions(extension))?.['appearance'], RESTYLE_POLL)
        .toBe('dark');

      // Save only the row edited on the page: the concurrent pick survives.
      await rowSwitchTrack(options, 'wp-dashboard-dbugger-entry').click();
      await saveOptions(options);
      const stored = await readStoredOptions(extension);
      expect(stored?.['appearance']).toBe('dark');
      expect(stored?.['improvements']).toMatchObject({ 'wp-dashboard-dbugger-entry': false });
      await expectShown(panel, 'Appearance: Dark', 'dark');
      expect((await readDocumentTheme(panel)).dataTheme).toBe('dark');
      // The saved page caught up: its row now shows the pick it kept.
      await expect(options.getByRole('radio', { name: CHOICE_LABELS.dark })).toBeChecked();
    } finally {
      await resetStoredOptions(extension);
      await options.close();
      await panel.close();
      await fixture.page.close();
    }
  });
});
