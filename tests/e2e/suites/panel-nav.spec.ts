/**
 * The panel nav's browser suite: the icon rail is the form at every width
 * (no morphology switch), real hash links carry `aria-current`, the tooltip
 * wiring holds for anchor rows and the disabled reserved row — and a row's
 * open tooltip never covers its sibling rows (the placement regression the
 * below-floating tooltip had).
 *
 * Why a browser pin: happy-dom never applies the stylesheet, so unit tests
 * can only assert the class strings — the flex geometry, the real painted
 * hit-testing (an open tooltip must not intercept the next row's clicks),
 * the pointer/focus tooltip behavior over a real APG trigger, and the focus
 * ring are genuine browser facts. The panel page boots as an extension page
 * (like the popup's suites): with no DevTools window there is no inspected
 * tab, so the store degrades to its recorded error state — itself one of
 * the checked promises — while the nav keeps rendering stateless.
 */
import type { Page } from '@playwright/test';
import { expect, panelPageUrl, test } from '../helpers/extension';

/** The rail geometry, read identically at every width. */
interface NavGeometry {
  /** The nav element's resolved flex direction (the rail's axis). */
  navFlexDirection: string;
  navOverflowX: string;
  headerBorderRightWidth: string;
  headerBorderBottomWidth: string;
  /** One row's resolved row layout. */
  firstRowDisplay: string;
  shellFlexDirection: string;
}

async function readGeometry(page: Page): Promise<NavGeometry> {
  return await page.evaluate((): NavGeometry => {
    const nav = document.querySelector<HTMLElement>('[data-fdt="panel-nav"]');
    const header = document.querySelector<HTMLElement>('[data-fdt="panel-header"]');
    const shell = document.querySelector<HTMLElement>('[data-fdt="panel-shell"]');
    const firstRow = nav === null ? null : nav.querySelector<HTMLElement>('a');
    return {
      navFlexDirection: nav === null ? '' : getComputedStyle(nav).flexDirection,
      navOverflowX: nav === null ? '' : getComputedStyle(nav).overflowX,
      headerBorderRightWidth: header === null ? '' : getComputedStyle(header).borderRightWidth,
      headerBorderBottomWidth: header === null ? '' : getComputedStyle(header).borderBottomWidth,
      firstRowDisplay: firstRow === null ? '' : getComputedStyle(firstRow).display,
      shellFlexDirection: shell === null ? '' : getComputedStyle(shell).flexDirection
    };
  });
}

test.describe('panel nav (icon rail + tooltips)', () => {
  test('keeps the icon rail at every width — no morphology switch, no top bar', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

      // Narrow: the rail column beside the content.
      const narrow = await readGeometry(page);
      expect(narrow.navFlexDirection).toBe('column');
      expect(narrow.shellFlexDirection).toBe('row');
      expect(narrow.headerBorderRightWidth).not.toBe('0px');
      expect(narrow.headerBorderBottomWidth).toBe('0px');

      // RESIZE wide in the SAME page: still the rail — the header keeps its
      // right edge and grows no bottom edge (the top bar is retired).
      await page.setViewportSize({ width: 1000, height: 700 });
      await page.waitForTimeout(120);
      const wide = await readGeometry(page);
      expect(wide.navFlexDirection).toBe('column');
      expect(wide.shellFlexDirection).toBe('row');
      expect(wide.headerBorderRightWidth).not.toBe('0px');
      expect(wide.headerBorderBottomWidth).toBe('0px');
      expect(wide.firstRowDisplay).toBe('flex');

      // And back again without a reload.
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
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

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

  test('a row’s open tooltip sits to its right and never covers the sibling rows', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      // The rail's geometry: icon-only rows answer their tooltips.
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

      const trigger = page.getByRole('link', { name: 'Detections' });
      await trigger.focus();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      expect(await tooltip.textContent()).toContain('Detections');
      expect(await trigger.getAttribute('aria-describedby')).toBe(await tooltip.getAttribute('id'));

      // Placement: the tooltip floats to the row's right (gutter > 0), over
      // the content region — never below the row.
      const placement = await page.evaluate(() => {
        const triggerBox = document
          .querySelector<HTMLAnchorElement>('a[href="#/detections"]')
          ?.getBoundingClientRect();
        const tooltipBox = document
          .querySelector<HTMLElement>('[role="tooltip"]')
          ?.getBoundingClientRect();
        if (triggerBox === undefined || tooltipBox === undefined) return null;
        return { triggerRight: triggerBox.right, tooltipLeft: tooltipBox.left };
      });
      if (placement === null) throw new Error('tooltip or trigger box missing while open');
      expect(placement.tooltipLeft).toBeGreaterThanOrEqual(placement.triggerRight);

      // The user-facing fact: with the tooltip open, the next row's center
      // still hit-tests to the row itself (not to the floating tooltip).
      const nextRowHit = await page.evaluate(() => {
        const next = document.querySelector<HTMLAnchorElement>('a[href="#/javascript"]');
        if (next === null) return null;
        const box = next.getBoundingClientRect();
        const atPoint = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        return atPoint === next || (atPoint !== null && next.contains(atPoint));
      });
      expect(nextRowHit).toBe(true);

      // And at the narrowest docked-right widths: the tooltip keeps its
      // right-of-row placement (shift, never a flip onto the rail) and the
      // sibling rows stay clickable.
      await page.setViewportSize({ width: 320, height: 640 });
      await page.waitForTimeout(120);
      const narrowPlacement = await page.evaluate(() => {
        const trigger = document.querySelector<HTMLAnchorElement>('a[href="#/detections"]');
        const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]');
        const next = document.querySelector<HTMLAnchorElement>('a[href="#/javascript"]');
        if (trigger === null || tooltip === null || next === null) return null;
        const triggerBox = trigger.getBoundingClientRect();
        const tooltipBox = tooltip.getBoundingClientRect();
        const nextBox = next.getBoundingClientRect();
        const atNext = document.elementFromPoint(
          nextBox.left + nextBox.width / 2,
          nextBox.top + nextBox.height / 2
        );
        return {
          tooltipLeft: tooltipBox.left,
          triggerRight: triggerBox.right,
          nextHitIsRow: atNext === next || (atNext !== null && next.contains(atNext))
        };
      });
      if (narrowPlacement === null) throw new Error('tooltip boxes missing at the narrow width');
      expect(narrowPlacement.tooltipLeft).toBeGreaterThanOrEqual(narrowPlacement.triggerRight);
      expect(narrowPlacement.nextHitIsRow).toBe(true);

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
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

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
