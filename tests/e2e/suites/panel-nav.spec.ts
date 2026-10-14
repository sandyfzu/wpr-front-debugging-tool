/**
 * The panel nav's browser suite: the icon rail is the form at every width
 * (no morphology switch), real hash links carry `aria-current`, the tooltip
 * wiring holds for anchor rows and the disabled reserved row — and a row's
 * open tooltip never covers its sibling rows (the placement regression the
 * below-floating tooltip had).
 *
 * The height axis is the rail's overflow contract: shrinking the panel
 * until rows no longer fit engages the "More pages" affordance — the rail
 * never scrolls (no scrollbar of any kind, designed or native: `overflow`
 * computes `hidden` and the rail's `scrollHeight` stays equal to its
 * `clientHeight` whenever the affordance is up), the trigger's APG menu
 * holds exactly the rows that left the rail (rail prefix + menu suffix =
 * the registry), every route stays reachable through it by pointer and
 * keyboard, and the rail's bottom-edge tooltip keeps floating right without
 * leaving the window. happy-dom never applies the stylesheet, so unit tests
 * can only assert the class strings — the flex geometry, the real painted
 * hit-testing, the pointer/focus behavior over a real APG trigger, the
 * focus ring and the harness-resizable thresholds are genuine browser
 * facts.
 *
 * The panel page boots as an extension page (like the popup's suites):
 * with no DevTools window there is no inspected tab, so the store degrades
 * to its recorded error state — itself one of the checked promises — while
 * the nav keeps rendering stateless.
 */
import type { Page } from '@playwright/test';
import { expect, panelPageUrl, test } from '../helpers/extension';

/** The rail row controls' tag/attr selector (anchors + the reserved disabled button). */
const RAIL_ROW_SELECTOR = 'a[href^="#/"], button[disabled]';

/** The overflow trigger's role/name (its tooltip content is attribution). */
const TRIGGER = { role: 'button' as const, name: 'More pages' };

/** The rail's scroll-free + content-equals-visible facts, read identically at every size. */
interface RailScrollState {
  /** The computed overflow of the vertical axis (must always be `hidden`). */
  overflowY: string;
  /** True when the rail's rendered content fits its box exactly (no scrollable overflow). */
  scrollbarEqual: boolean;
}

/** Read the rail's scroll facts. */
async function readScrollState(page: Page): Promise<RailScrollState> {
  return await page.evaluate((): RailScrollState => {
    const nav = document.querySelector<HTMLElement>('[data-fdt="panel-nav"]');
    if (nav === null) throw new Error('the rail is not mounted');
    return {
      overflowY: getComputedStyle(nav).overflowY,
      scrollbarEqual: nav.scrollHeight === nav.clientHeight
    };
  });
}

/** Which registry controls currently live in the rail, in DOM order. */
async function readRailRows(page: Page): Promise<string[]> {
  return await page.evaluate((selector: string) => {
    const nav = document.querySelector<HTMLElement>('[data-fdt="panel-nav"]');
    if (nav === null) throw new Error('the rail is not mounted');
    return [...nav.querySelectorAll<HTMLElement>(selector)].map(
      (element) => element.getAttribute('href') ?? 'reserved'
    );
  }, RAIL_ROW_SELECTOR);
}

/**
 * Whether every currently-rendered rail row's own box sits inside the
 * rail's box (the no-visual-clip fact the fit computation promises).
 */
async function readRowsInside(page: Page): Promise<boolean> {
  return await page.evaluate((selector: string) => {
    const nav = document.querySelector<HTMLElement>('[data-fdt="panel-nav"]');
    if (nav === null) throw new Error('the rail is not mounted');
    const box = nav.getBoundingClientRect();
    return [...nav.querySelectorAll<HTMLElement>(selector)].every(
      (element) => element.getBoundingClientRect().bottom <= box.bottom + 0.5
    );
  }, RAIL_ROW_SELECTOR);
}

/** The registry routes a rail+menu pair must cover, with the rail's expected prefix. */
const REGISTRY_ROWS = [
  '#/detections',
  '#/javascript',
  '#/lazyload',
  '#/preloaded-resources',
  '#/undefined-references',
  'reserved'
];

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

test.describe('rail overflow (the height-shrink affordance)', () => {
  /** The rail at `height` (resized, settled) read fact-by-fact. */
  async function shrinkTo(page: Page, height: number): Promise<void> {
    await page.setViewportSize({ width: 700, height });
    // Two settled frames: the ResizeObserver's slice decision is a
    // post-layout callback, and the trigger mount can shrink the rail once
    // more — waiting twice leaves any two-round convergence done.
    await page.waitForTimeout(90);
    await page.waitForTimeout(90);
  }

  test('engages at the height threshold and the rail never scrolls', async ({ extension }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 900 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

      // Full height: no affordance — every row is a rail row, and the rail
      // is already scroll-free (no scrollbar appears on the first squeeze).
      expect(await page.getByRole(TRIGGER.role, { name: TRIGGER.name }).count()).toBe(0);
      expect(await readRailRows(page)).toEqual(REGISTRY_ROWS);
      expect(await readScrollState(page)).toEqual({ overflowY: 'hidden', scrollbarEqual: true });

      // Past the threshold: the trigger engages, the rail keeps its fitting
      // prefix (not one clipped row more), and the scroll facts hold.
      await shrinkTo(page, 250);
      await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();
      const railRows = await readRailRows(page);
      expect(railRows.length).toBeGreaterThan(0);
      expect(railRows.length).toBeLessThan(REGISTRY_ROWS.length);
      expect(railRows).toEqual(REGISTRY_ROWS.slice(0, railRows.length)); // registry prefix
      expect(await readRowsInside(page)).toBe(true);
      expect(await readScrollState(page)).toEqual({ overflowY: 'hidden', scrollbarEqual: true });

      // The rail + the closed affordance cover the registry exactly once,
      // in registry order (the rail prefix, the menu suffix).
      await page.getByRole('button', { name: 'More pages' }).click();
      const menuRows = await page.locator('[data-fdt="nav-overflow-item"]').evaluateAll((items) =>
        items.map((element) => {
          const href = (element as HTMLAnchorElement).getAttribute('href');
          return href ?? 'reserved';
        })
      );
      expect(menuRows).toEqual(REGISTRY_ROWS.slice(railRows.length));

      // And taller again: every row returns, the affordance retires
      // (no DOM, no tab stop), the rail stays scroll-free.
      await shrinkTo(page, 900);
      expect(await page.getByRole('button', { name: 'More pages' }).count()).toBe(0);
      expect(await readRailRows(page)).toEqual(REGISTRY_ROWS);
      expect(await readScrollState(page)).toEqual({ overflowY: 'hidden', scrollbarEqual: true });
    } finally {
      await page.close();
    }
  });

  test('every hidden route is reachable through the affordance (pointer + keyboard)', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 200 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();

      // The registry prefix that still fits at 200 px decides which hrefs
      // the menu must carry (rail ⊕ menu = the registry).
      const railRows = await readRailRows(page);
      const pageHrefs = [
        '#/javascript',
        '#/lazyload',
        '#/preloaded-resources',
        '#/undefined-references'
      ];
      const menuHrefs = pageHrefs.filter((href) => !railRows.includes(href));

      const menu = page.locator('[data-fdt="panel-nav-overflow-menu"]');
      await page.getByRole('button', { name: 'More pages' }).click();
      await expect(menu).toBeVisible();
      for (const href of menuHrefs) {
        await expect(menu.locator(`a[href="${href}"]`)).toBeVisible();
      }
      // The reserved row, when hidden, stays its disabled explained self
      // (a menu item div with `aria-disabled`; the note reads its words).
      const reserved = menu.locator('[data-fdt="nav-overflow-item"][aria-disabled="true"]');
      if (railRows.includes('reserved')) {
        expect(await reserved.count()).toBe(0);
      } else {
        await expect(reserved.first()).toBeVisible();
        await expect(reserved.first()).toHaveAttribute('aria-disabled', 'true');
        await expect(reserved.first()).toContainText('Returns with the Diagnoser plugin v2');
      }
      await page.keyboard.press('Escape');
      await expect(menu).not.toBeAttached();

      // A hidden route navigates: the menu closes and the hash swaps. The
      // standalone harness's data path settles at the recorded error state
      // (no content script answers the runtime broadcast — the P5I-verified
      // transport reason), so no page h1 renders here; the route's own
      // marker is honest anyway: reopening the menu shows the navigated row
      // with `aria-current="page"`.
      await page.getByRole('button', { name: 'More pages' }).click();
      const fallbackHrefs = menuHrefs.filter((href) => href !== '#/lazyload');
      const target = menuHrefs.includes('#/lazyload') ? '#/lazyload' : fallbackHrefs[0];
      if (target === undefined) throw new Error('expected at least one hidden href');
      await menu.locator(`a[href="${target}"]`).click();
      await page.waitForURL(new RegExp(`${target.replace('/', '\\/')}$`));
      await expect(menu).not.toBeAttached();
      await page.getByRole('button', { name: 'More pages' }).click();
      const activeItem = menu.locator(`[data-fdt="nav-overflow-item"][aria-current="page"]`);
      await expect(activeItem).toHaveAttribute('href', target);
    } finally {
      await page.close();
    }
  });

  test('keyboard reach at overflow: trigger focus ring, menu arrows, Enter navigates, Esc returns', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 200 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });

      // Tab reaches the trigger (it follows the rail rows in DOM order) and
      // keyboard focus rings it — the affordance is keyboard-complete.
      let reached = false;
      for (let step = 0; step < 8; step += 1) {
        await page.keyboard.press('Tab');
        const active = await page.evaluate((): string => {
          const element = document.activeElement;
          if (element === null || element.getAttribute('aria-haspopup') !== 'menu') return '(none)';
          return element.getAttribute('aria-label') ?? '(nameless)';
        });
        if (active === 'More pages') {
          reached = true;
          break;
        }
      }
      expect(reached).toBe(true);
      const ring = await page.evaluate((): string => {
        const active = document.activeElement;
        return active === null ? '' : getComputedStyle(active).outlineStyle;
      });
      expect(ring).toBe('solid');

      // ArrowDown opens the APG menu with focus inside it (a menu item
      // focused from the trigger's keyboard-open path).
      await page.keyboard.press('ArrowDown');
      const menu = page.locator('[data-fdt="panel-nav-overflow-menu"]');
      await expect(menu).toBeVisible();
      await expect
        .poll(async () => {
          return await page.evaluate((): string => {
            const active = document.activeElement;
            return active === null
              ? '(none)'
              : (active.getAttribute('role') ?? active.tagName.toLowerCase());
          });
        })
        .toBe('menuitem');

      // Enter on the focused item navigates; the selection closes the menu.
      // The standalone harness's data path settles at the recorded error
      // state (no content script answers the broadcast — the P5I-verified
      // transport reason), so the selection's own fact is the hash landing
      // plus the reopened menu's `aria-current` on that row.
      const target = await menu
        .locator('a[data-fdt="nav-overflow-item"]')
        .first()
        .getAttribute('href');
      if (target === null) throw new Error('no hidden anchor row in the menu');
      await expect(menu.locator(`a[href="${target}"]`)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).not.toBeAttached();
      await page.waitForURL(new RegExp(`${target.replace('/', '\\/')}$`));
      await page.getByRole('button', { name: 'More pages' }).click();
      await expect(
        page.locator('[data-fdt="panel-nav-overflow-menu"] a[aria-current="page"]')
      ).toHaveAttribute('href', target);

      // Escape closes the menu and hands focus back to the trigger.
      await page.keyboard.press('Escape');
      const active = await page.evaluate((): string =>
        document.activeElement === null
          ? ''
          : (document.activeElement.getAttribute('aria-label') ?? '')
      );
      expect(active).toBe('More pages');
    } finally {
      await page.close();
    }
  });

  test('the rail’s bottom-edge tooltip floats right and stays inside the window', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      // The trigger sits at the rail's very bottom edge — the worst case
      // for a floating tooltip — with the menu closed.
      await page.setViewportSize({ width: 700, height: 250 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();

      const trigger = page.getByRole('button', { name: 'More pages' });
      await trigger.focus();
      const tooltip = page.getByRole('tooltip');
      await expect(tooltip).toBeVisible();
      expect(await tooltip.textContent()).toContain('More pages');
      const boxes = await page.evaluate(
        (): null | {
          tooltipLeft: number;
          triggerRight: number;
          tooltipBottom: number;
          windowBottom: number;
        } => {
          const triggerBox = document
            .querySelector<HTMLElement>('[aria-haspopup="menu"]')
            ?.getBoundingClientRect();
          const tooltipBox = document
            .querySelector<HTMLElement>('[role="tooltip"]')
            ?.getBoundingClientRect();
          if (triggerBox === undefined || tooltipBox === undefined) return null;
          return {
            tooltipLeft: tooltipBox.left,
            triggerRight: triggerBox.right,
            tooltipBottom: tooltipBox.bottom,
            windowBottom: window.innerHeight
          };
        }
      );
      if (boxes === null) throw new Error('tooltip or trigger box missing while open');
      // Right of the trigger (the rail's own convention) — and inside the
      // window: the collision handling keeps the bottom-edge tooltip in.
      expect(boxes.tooltipLeft).toBeGreaterThanOrEqual(boxes.triggerRight - 0.5);
      expect(boxes.tooltipBottom).toBeLessThanOrEqual(boxes.windowBottom);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toHaveCount(0);
    } finally {
      await page.close();
    }
  });

  test('the palette remains the zero-scroll launcher at overflow heights', async ({
    extension
  }) => {
    const page = await extension.browserContext.newPage();
    try {
      await page.setViewportSize({ width: 700, height: 200 });
      await page.goto(await panelPageUrl(extension), { waitUntil: 'load' });
      await expect(page.getByRole('button', { name: 'More pages' })).toBeVisible();

      await page.keyboard.press('ControlOrMeta+k');
      const palette = page.getByRole('combobox');
      await expect(palette).toBeVisible();
      await palette.fill('lazy');
      // The matcher re-arms the highlight one settle-tick after ranking —
      // give the ranked row its render before accepting it.
      await page.waitForTimeout(120);
      await page.keyboard.press('Enter');
      // The palette's jump: the route lands (the standalone harness settles
      // at the recorded error state — no page h1 renders — so the route
      // swap itself is the fact) and the palette is gone.
      await page.waitForURL(/#\/lazyload$/);
      await expect(palette).not.toBeAttached();
      await page.getByRole('button', { name: 'More pages' }).click();
      await expect(
        page.locator('[data-fdt="panel-nav-overflow-menu"] a[aria-current="page"]')
      ).toHaveAttribute('href', '#/lazyload');
    } finally {
      await page.close();
    }
  });
});
