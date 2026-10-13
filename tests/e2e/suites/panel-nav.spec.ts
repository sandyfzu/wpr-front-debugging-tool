/**
 * The adaptive nav's browser suite (P5.1 groundwork): the container-query
 * morphologies switch LIVE at real viewport widths, real hash links carry
 * `aria-current`, and the tooltip wiring holds for anchor rows and the
 * disabled reserved row.
 *
 * Why a browser pin: happy-dom never applies the stylesheet, so unit tests
 * can only assert the variant class strings — the container-query cascade
 * (threshold resolution, variant-after-base ordering), the pointer/focus
 * tooltip behavior over a real APG trigger, and the focus ring are genuine
 * browser facts. The panel page boots as an extension page (like the
 * popup's suites): with no DevTools window there is no inspected tab, so
 * the store degrades to its recorded error state — itself one of the
 * checked promises — while the nav keeps rendering stateless.
 */
import type { Page } from '@playwright/test';
import { expect, test, type ExtensionDriver } from '../helpers/extension';

/** The panel page's URL under the driven extension install. */
async function panelUrl(extension: ExtensionDriver): Promise<string> {
  const id = await extension.extensionId();
  return `chrome-extension://${id}/panel.html`;
}

/** Geometry the container queries resolve differently at rail vs bar widths. */
interface NavGeometry {
  /** The nav element's resolved flex direction (the morphology's axis). */
  navFlexDirection: string;
  navOverflowX: string;
  headerBorderRightWidth: string;
  headerBorderBottomWidth: string;
  /** The group caption's own box width (≤ 1px is the sr-only signature). */
  captionRectWidth: number;
  /** Whether the caption's glyphs actually paint (probe via hit-testing). */
  captionTextVisible: boolean;
  /** One row's resolved row layout (label present ⇒ the bar form). */
  firstRowDisplay: string;
  shellFlexDirection: string;
}

async function readGeometry(page: Page): Promise<NavGeometry> {
  return await page.evaluate((): NavGeometry => {
    const nav = document.querySelector<HTMLElement>('[data-fdt="panel-nav"]');
    const header = document.querySelector<HTMLElement>('[data-fdt="panel-header"]');
    const shell = document.querySelector<HTMLElement>('[data-fdt="panel-shell"]');
    const caption = nav === null ? null : nav.querySelector<HTMLElement>('[aria-hidden="true"]');
    const firstRow = nav === null ? null : nav.querySelector<HTMLElement>('a');
    return {
      navFlexDirection: nav === null ? '' : getComputedStyle(nav).flexDirection,
      navOverflowX: nav === null ? '' : getComputedStyle(nav).overflowX,
      headerBorderRightWidth: header === null ? '' : getComputedStyle(header).borderRightWidth,
      headerBorderBottomWidth: header === null ? '' : getComputedStyle(header).borderBottomWidth,
      captionRectWidth: caption === null ? 0 : caption.getBoundingClientRect().width,
      // A real painted-glyph probe: the caption is invisible unless the
      // compositor renders its own pixels at its box (hit-testing truth).
      captionTextVisible: ((): boolean => {
        if (caption === null) return false;
        const box = caption.getBoundingClientRect();
        const atPoint = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        if (atPoint === null) return false;
        return atPoint === caption || caption.contains(atPoint);
      })(),
      firstRowDisplay: firstRow === null ? '' : getComputedStyle(firstRow).display,
      shellFlexDirection: shell === null ? '' : getComputedStyle(shell).flexDirection
    };
  });
}

test.describe('panel nav (adaptive morphology + tooltips)', () => {
  test('switches morphology at the real container width — live, on resize', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelUrl(extension), { waitUntil: 'load' });

      // Narrow (the docked-right reading): the icon rail.
      const narrow = await readGeometry(page);
      expect(narrow.navFlexDirection).toBe('column');
      expect(narrow.shellFlexDirection).toBe('row');
      expect(narrow.headerBorderRightWidth).not.toBe('0px');
      // The rail's captions stay sr-only: a ≤1px clipped box, no glyphs.
      expect(narrow.captionRectWidth).toBeLessThanOrEqual(1.5);
      expect(narrow.captionTextVisible).toBe(false);

      // RESIZE in the SAME page — the browser restyles, nothing re-renders.
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.waitForTimeout(120);
      const wide = await readGeometry(page);
      expect(wide.navFlexDirection).toBe('row');
      expect(wide.shellFlexDirection).toBe('column');
      expect(wide.headerBorderRightWidth).toBe('0px');
      expect(wide.headerBorderBottomWidth).not.toBe('0px');
      // The bar's captions and row labels are real painted ink.
      expect(wide.captionRectWidth).toBeGreaterThan(20);
      expect(wide.captionTextVisible).toBe(true);
      expect(wide.firstRowDisplay).toBe('flex');

      // And back again without a reload — the morph is a restyle.
      await page.setViewportSize({ width: 700, height: 900 });
      await page.waitForTimeout(120);
      expect((await readGeometry(page)).navFlexDirection).toBe('column');
    } finally {
      await page.close();
    }
  });

  test('navigates by real hash links and marks the active row; the boot degrades honestly', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.goto(await panelUrl(extension), { waitUntil: 'load' });

      // Standalone boot: no inspected tab ⇒ the recorded error state with
      // its retry affordance — and the nav still renders stateless.
      await expect(page.getByText("Couldn't load page data")).toBeVisible();

      const detections = page.getByRole('link', { name: 'Detections' });
      await expect(detections).toBeVisible();
      expect(await detections.getAttribute('href')).toBe('#/detections');
      expect(await detections.getAttribute('aria-current')).toBe('page');

      const javascript = page.getByRole('link', { name: 'JavaScript' });
      await javascript.click();
      await page.waitForURL(/#\/javascript$/);
      await expect(javascript).toHaveAttribute('aria-current', 'page');
      await expect(detections).not.toHaveAttribute('aria-current');
    } finally {
      await page.close();
    }
  });

  test('tooltips carry the row name (focus) and the reserved note (disabled row)', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      // The rail's geometry: icon-only rows answer their tooltips.
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelUrl(extension), { waitUntil: 'load' });

      await page.getByRole('link', { name: 'Detections' }).focus();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      expect(await tooltip.textContent()).toContain('Detections');
      const trigger = page.getByRole('link', { name: 'Detections' });
      expect(await trigger.getAttribute('aria-describedby')).toBe(await tooltip.getAttribute('id'));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);

      const reserved = page.getByRole('button', { name: 'Diagnoser' });
      await expect(reserved).toBeDisabled();
      await reserved.hover();
      const note = page.getByRole('tooltip');
      await expect(note).toBeVisible();
      expect(await note.textContent()).toContain('Returns with the Diagnoser plugin v2');
    } finally {
      await page.close();
    }
  });

  test('keyboard-only reach: rows focus with a visible ring', async ({ extension }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelUrl(extension), { waitUntil: 'load' });

      // Tab through the shell until a nav row is focused; keyboard-triggered
      // focus matches :focus-visible, so the accent outline must be real
      // ink. DOM order puts the nav rows before any other focusable, so the
      // reach is immediate (the loop is a guard, not the path).
      let focused = '(initial)';
      for (let step = 0; step < 6; step += 1) {
        await page.keyboard.press('Tab');
        focused = await page.evaluate((): string => {
          const active = document.activeElement;
          if (active === null || active.tagName !== 'A') return '(none)';
          return `${(active.textContent || '').trim()}|A|${getComputedStyle(active).outlineStyle}`;
        });
        if (focused.endsWith('|A|solid')) break;
      }
      expect(focused).toBe('Detections|A|solid');
    } finally {
      await page.close();
    }
  });
});
