/**
 * The panel sidebar's browser suite: the form rule measured on the real
 * shell (labeled from a 1080 px panel, the rail below; the forms' real
 * column widths), the pin through the collapse/expand button and across a
 * panel reload (the boot reads it before the first render), focus kept on
 * the same control across a form switch (keyboard toggle, width), a pinned
 * labeled form held down to the 760 px top-bar threshold and forced to the
 * rail below it (where the button is gone), a resize sweep that switches
 * forms only at the thresholds, no horizontal scroll in either form, and
 * the "More pages" overflow in the labeled form at short heights (the nav
 * never scrolls; nav ⊕ menu = the registry).
 *
 * The automatic fold while a list detail is open needs a page that mounts
 * the master–detail list kit; until one does it is pinned at render level
 * (`App.test.tsx`, `sidebar.test.tsx`), with this suite's geometry facts.
 *
 * The panel boots as a plain extension page (no inspected tab → the error
 * body); the nav is shell chrome and renders the same either way.
 */
import type { Page } from '@playwright/test';
import { expect, panelPageUrl, test, type ExtensionDriver } from '../helpers/extension';
import { settleFrames } from '../helpers/frames';

/** The registry routes in nav order (the nav ⊕ menu cover them exactly once). */
const REGISTRY_ROWS = [
  '#/detections',
  '#/javascript',
  '#/stylesheets',
  '#/lazyload',
  '#/preloaded-resources',
  '#/headers-cookies',
  '#/undefined-references',
  '#/rucss-tester',
  '#/beacon-tester',
  '#/lcp-vitals'
];

/** What one read of the shell says about the nav. */
interface NavFacts {
  /** The rendered form (`data-fdt-nav-form`). */
  readonly form: string | null;
  /** The nav column's border-box width in px. */
  readonly columnWidth: number;
  /** Whether the collapse/expand button is present. */
  readonly toggle: boolean;
  /** The document scrolls horizontally (it never may). */
  readonly horizontalScroll: boolean;
}

/** Read the nav facts. */
async function readNav(page: Page): Promise<NavFacts> {
  return await page.evaluate((): NavFacts => {
    const column = document.querySelector<HTMLElement>('[data-fdt="panel-header"]');
    if (column === null) throw new Error('the nav column is not mounted');
    const root = document.documentElement;
    return {
      form: column.getAttribute('data-fdt-nav-form'),
      columnWidth: column.getBoundingClientRect().width,
      toggle: document.querySelector('[data-fdt="panel-nav-toggle-block"] button') !== null,
      horizontalScroll: root.scrollWidth > root.clientWidth
    };
  });
}

/** Resize and let the shell's observers settle (two frames of slack). */
async function resizeTo(page: Page, width: number, height = 760): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(90);
  await page.waitForTimeout(90);
}

/** Clear the stored pin (the fixture's extension is shared across a file). */
async function clearPin(extension: ExtensionDriver): Promise<void> {
  await extension.evaluateInWorker(async () => {
    await chrome.storage.local.remove('panel-nav-pin');
  }, undefined);
}

/** The stored pin, as the background reads it. */
async function storedPin(extension: ExtensionDriver): Promise<unknown> {
  return await extension.evaluateInWorker(async () => {
    const stored = await chrome.storage.local.get('panel-nav-pin');
    return stored['panel-nav-pin'];
  }, undefined);
}

/** Open a fresh panel page at a size. */
async function openPanel(extension: ExtensionDriver, width: number, height = 760): Promise<Page> {
  const page = await extension.browserContext.newPage();
  await page.setViewportSize({ width, height });
  await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
  await expect(page.locator('[data-fdt="panel-nav"]')).toBeVisible();
  await settleFrames(page);
  return page;
}

test.beforeEach(async ({ extension }) => {
  await clearPin(extension);
});

test.describe('panel sidebar (form rule + pin)', () => {
  test('labeled from a 1080 px panel, the rail below; 208 / 52 px columns', async ({
    extension
  }) => {
    const page = await openPanel(extension, 1080);
    try {
      expect(await readNav(page)).toEqual({
        form: 'labeled',
        columnWidth: 208,
        toggle: true,
        horizontalScroll: false
      });
      // Labeled rows show their words, 32 px tall, the group captions visible.
      const js = page.getByRole('link', { name: 'JavaScript' });
      await expect(js).toHaveText('JavaScript');
      expect((await js.boundingBox())?.height).toBe(32);
      await expect(
        page.locator('[data-fdt="panel-nav"] [data-fdt="panel-nav-caption"]')
      ).toHaveText(['Overview', 'Inspect', 'Diagnose', 'Tools']);
      await resizeTo(page, 1079);
      expect(await readNav(page)).toEqual({
        form: 'rail',
        columnWidth: 52,
        toggle: true,
        horizontalScroll: false
      });
      await expect(page.locator('[data-fdt="panel-nav-caption"]')).toHaveCount(0);
      await resizeTo(page, 420);
      expect(await readNav(page)).toEqual({
        form: 'rail',
        columnWidth: 52,
        toggle: false,
        horizontalScroll: false
      });
    } finally {
      await page.close();
    }
  });

  test('the button collapses and expands; the pin survives a panel reload', async ({
    extension
  }) => {
    const page = await openPanel(extension, 1280);
    try {
      expect((await readNav(page)).form).toBe('labeled');
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      expect((await readNav(page)).form).toBe('rail');
      // Stored, then read before the first render of the next document.
      await expect.poll(async () => await storedPin(extension)).toBe('rail');
      await page.reload({ waitUntil: 'load' });
      await settleFrames(page);
      await expect(page.locator('[data-fdt="panel-nav"]')).toHaveAttribute(
        'data-fdt-nav-form',
        'rail'
      );
      // The rail's toggle is the icon square, named by its action.
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      expect((await readNav(page)).form).toBe('labeled');
      // Expanding where the width rule already gives labeled hands it back to auto.
      await expect.poll(async () => await storedPin(extension)).toBe('auto');
      await page.reload({ waitUntil: 'load' });
      await expect(page.locator('[data-fdt="panel-nav"]')).toHaveAttribute(
        'data-fdt-nav-form',
        'labeled'
      );
    } finally {
      await page.close();
    }
  });

  test('a pinned labeled form holds down to 760 px, the rail is forced below it', async ({
    extension
  }) => {
    const page = await openPanel(extension, 900);
    try {
      expect((await readNav(page)).form).toBe('rail');
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      expect((await readNav(page)).form).toBe('labeled');
      await resizeTo(page, 760);
      expect(await readNav(page)).toEqual({
        form: 'labeled',
        columnWidth: 208,
        toggle: true,
        horizontalScroll: false
      });
      await resizeTo(page, 759);
      expect(await readNav(page)).toEqual({
        form: 'rail',
        columnWidth: 52,
        toggle: false,
        horizontalScroll: false
      });
      // Widening again restores the pinned form (the pin was never dropped).
      await resizeTo(page, 800);
      expect((await readNav(page)).form).toBe('labeled');
    } finally {
      await page.close();
    }
  });

  test('a resize sweep switches forms only at the thresholds, never back and forth', async ({
    extension
  }) => {
    const page = await openPanel(extension, 700);
    try {
      // A drag-like sweep through 760 / 830 / 1080 and back, in small steps.
      const widths = [
        ...Array.from({ length: 31 }, (_, i) => 700 + i * 15),
        ...Array.from({ length: 31 }, (_, i) => 1150 - i * 15)
      ];
      const seen: Array<{ width: number; form: string | null }> = [];
      for (const width of widths) {
        await page.setViewportSize({ width, height: 760 });
        await page.waitForTimeout(40);
        const facts = await readNav(page);
        expect(facts.horizontalScroll, `no horizontal scroll at ${String(width)}`).toBe(false);
        seen.push({ width, form: facts.form });
      }
      for (const { width, form } of seen) {
        expect(form, `form at ${String(width)}`).toBe(width >= 1080 ? 'labeled' : 'rail');
      }
    } finally {
      await page.close();
    }
  });

  test('focus stays on the same control when the nav changes form', async ({ extension }) => {
    const page = await openPanel(extension, 1280);
    try {
      // The toggle, pressed from the keyboard both ways: each press swaps its
      // element, the focus stays on it, so the next key toggles straight back.
      await page.getByRole('button', { name: 'Collapse sidebar' }).focus();
      await page.keyboard.press('Enter');
      expect((await readNav(page)).form).toBe('rail');
      await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeFocused();
      await page.keyboard.press('Space');
      expect((await readNav(page)).form).toBe('labeled');
      await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeFocused();
      await expect.poll(async () => await storedPin(extension)).toBe('auto');

      // A focused row across the 1080 px width switch, both ways.
      const row = page.getByRole('link', { name: 'JavaScript' });
      await row.focus();
      await resizeTo(page, 1000);
      expect((await readNav(page)).form).toBe('rail');
      await expect(row).toBeFocused();
      await resizeTo(page, 1280);
      expect((await readNav(page)).form).toBe('labeled');
      await expect(row).toBeFocused();
      // Tab moves on from the row itself (focus never fell to the body).
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Stylesheets' })).toBeFocused();
    } finally {
      await page.close();
    }
  });

  test('no horizontal scroll at the D-1 widths in either form', async ({ extension }) => {
    const page = await openPanel(extension, 320);
    try {
      for (const pin of ['auto', 'labeled', 'rail'] as const) {
        await extension.evaluateInWorker(async (value: string) => {
          await chrome.storage.local.set({ 'panel-nav-pin': value });
        }, pin);
        await page.reload({ waitUntil: 'load' });
        await settleFrames(page);
        for (const width of [320, 420, 480, 760, 1100, 1280]) {
          await resizeTo(page, width);
          const facts = await readNav(page);
          expect(facts.horizontalScroll, `${pin} at ${String(width)}`).toBe(false);
          const content = await page
            .locator('[data-fdt="panel-content"]')
            .evaluate((element) => element.scrollWidth <= element.clientWidth);
          expect(content, `${pin} content at ${String(width)}`).toBe(true);
        }
      }
    } finally {
      await page.close();
    }
  });
});

test.describe('labeled sidebar overflow (the height-shrink affordance)', () => {
  /** The nav's anchors, in DOM order. */
  async function navRows(page: Page): Promise<string[]> {
    return await page
      .locator('[data-fdt="panel-nav"] a[href^="#/"]')
      .evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? '(no href)'));
  }

  test('engages at short heights: the nav never scrolls, nav ⊕ menu = the registry', async ({
    extension
  }) => {
    const page = await openPanel(extension, 1280, 900);
    try {
      expect((await readNav(page)).form).toBe('labeled');
      await expect(page.getByRole('button', { name: 'More pages' })).toHaveCount(0);
      expect(await navRows(page)).toEqual(REGISTRY_ROWS);

      await resizeTo(page, 1280, 300);
      const trigger = page.getByRole('button', { name: 'More pages' });
      await expect(trigger).toBeVisible();
      const rows = await navRows(page);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(REGISTRY_ROWS.length);
      expect(rows).toEqual(REGISTRY_ROWS.slice(0, rows.length));
      const scroll = await page.locator('[data-fdt="panel-nav"]').evaluate((nav) => ({
        overflowY: getComputedStyle(nav).overflowY,
        equal: nav.scrollHeight === nav.clientHeight,
        rowsInside: [...nav.querySelectorAll('a[href^="#/"]')].every(
          (row) => row.getBoundingClientRect().bottom <= nav.getBoundingClientRect().bottom + 0.5
        )
      }));
      expect(scroll).toEqual({ overflowY: 'hidden', equal: true, rowsInside: true });
      // The labeled trigger shows the hidden count beside its words.
      await expect(trigger).toHaveText(`More pages${String(REGISTRY_ROWS.length - rows.length)}`);

      await trigger.click();
      const menu = page.locator('[data-fdt="panel-nav-overflow-menu"]');
      await expect(menu).toBeVisible();
      const menuRows = await menu
        .locator('[data-fdt="nav-overflow-item"]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('href') ?? '(no href)'));
      expect(menuRows).toEqual(REGISTRY_ROWS.slice(rows.length));
      // A hidden route navigates from the menu.
      const target = REGISTRY_ROWS.at(-1) ?? '';
      await menu.locator(`a[href="${target}"]`).click();
      await page.waitForURL(/#\/lcp-vitals$/);
      await expect(menu).not.toBeAttached();

      // Taller again: every row returns, the affordance retires.
      await resizeTo(page, 1280, 900);
      await expect(page.getByRole('button', { name: 'More pages' })).toHaveCount(0);
      expect(await navRows(page)).toEqual(REGISTRY_ROWS);
    } finally {
      await page.close();
    }
  });

  test('the menu opens from the keyboard and Esc returns focus to the trigger', async ({
    extension
  }) => {
    const page = await openPanel(extension, 1280, 300);
    try {
      const trigger = page.getByRole('button', { name: 'More pages' });
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.locator('[data-fdt="panel-nav-overflow-menu"]');
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).not.toBeAttached();
      await expect(trigger).toBeFocused();
    } finally {
      await page.close();
    }
  });
});
