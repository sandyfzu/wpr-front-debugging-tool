/**
 * The exclusion builder panel stays pinned inside the viewport on short
 * windows: after Simulated → Apply → reload → As served on each mode lane,
 * the panel keeps its gutter offset, the overlay's layer never scrolls, and
 * nothing inside the panel lays out past it (the focused radio is revealed
 * by the panel's own body scroller instead).
 *
 * The invariant is checked on its cause too, not only on the symptom: a
 * focus move scrolls the layer only when something escapes the body's
 * scroller, so the layer's scroll height must equal its height.
 *
 * The move to As served is made with the keyboard (focus the checked radio,
 * arrow to its neighbour): a pointer click scrolls its target into view
 * first, which would mask where the browser's own focus reveal lands.
 */
import type { Locator, Page } from '@playwright/test';

import { OVERLAY_HOST, clearDrafts } from '../helpers/exclusion-overlay';
import { expect, openFixturePage, test } from '../helpers/extension';
import {
  applySimulated,
  deferModeGroup,
  delayModeGroup,
  lazyloadModeGroup,
  openCapturedBuilder
} from '../helpers/simulation';
import { clearWidgetMap } from '../helpers/strip-pill';

/** Short windows: every lane's control sits below the fold of the panel's body. */
const VIEWPORTS = [
  { width: 760, height: 480 },
  { width: 320, height: 420 }
] as const;

/** The panel's gutter from the viewport's edge (`--xo-gutter`). */
const GUTTER = 12;

/** A mode lane under test: its control and a fixture page that offers Simulated. */
interface LaneCase {
  readonly name: string;
  readonly group: (page: Page) => Locator;
  readonly fixture: string;
  /**
   * Whether the control sits below the fold of the panel's body, so focusing
   * it must scroll the body. Delay's sits in the body's first screen (no body
   * scroll to assert): there the layer-overflow and panel-top assertions are
   * the discriminating ones.
   */
  readonly belowFold: boolean;
}

const LANES: readonly LaneCase[] = [
  { name: 'Delay JS', group: delayModeGroup, fixture: '/simulation/plain.html', belowFold: false },
  { name: 'Defer JS', group: deferModeGroup, fixture: '/simulation/plain.html', belowFold: true },
  {
    name: 'LazyLoad',
    group: lazyloadModeGroup,
    fixture: '/__e2e/csp/lazyload-placeholders',
    belowFold: true
  }
];

/** Where the panel sits and how the layer and body scroll. */
interface PanelPlacement {
  readonly top: number;
  readonly bottom: number;
  readonly viewport: number;
  readonly layerScrollTop: number;
  readonly layerOverflow: number;
  readonly panelScrollTop: number;
  readonly bodyScrollTop: number;
}

/**
 * Read the panel's placement in the viewport and the layer's scroll state.
 *
 * @param page The page with the overlay.
 */
async function placement(page: Page): Promise<PanelPlacement> {
  return await page.evaluate((host) => {
    const root = document.querySelector(host)?.shadowRoot;
    const layer = root?.querySelector<HTMLElement>('.xo-layer');
    const panel = root?.querySelector<HTMLElement>('.xo-panel');
    const body = root?.querySelector<HTMLElement>('.xo-body');
    if (!layer || !panel || !body) {
      throw new Error(`placement: no overlay layer/panel/body under ${host}`);
    }
    const box = panel.getBoundingClientRect();
    return {
      top: box.top,
      bottom: box.bottom,
      // The visible viewport: a page's horizontal scrollbar is not in it.
      viewport: document.documentElement.clientHeight,
      layerScrollTop: layer.scrollTop,
      layerOverflow: layer.scrollHeight - layer.clientHeight,
      panelScrollTop: panel.scrollTop,
      bodyScrollTop: body.scrollTop
    };
  }, OVERLAY_HOST);
}

/**
 * Assert the panel is pinned: at its gutter, inside the viewport, nothing scrolled.
 *
 * @param page The page with the overlay.
 * @param step The step's name, carried into the failure message.
 */
async function expectPinned(page: Page, step: string): Promise<void> {
  const at = await placement(page);
  expect(at, step).toMatchObject({ layerScrollTop: 0, layerOverflow: 0, panelScrollTop: 0 });
  expect(Math.round(at.top), step).toBe(GUTTER);
  expect(Math.round(at.bottom), step).toBe(at.viewport - GUTTER);
}

/**
 * The focused element's vertical extent inside the overlay's shadow root.
 *
 * @param page The page with the overlay.
 * @returns Its rect's top/bottom and the visible viewport's height.
 */
async function focusedExtent(
  page: Page
): Promise<{ top: number; bottom: number; viewport: number }> {
  return await page.evaluate((host) => {
    const focused = document.querySelector(host)?.shadowRoot?.activeElement;
    if (!focused) throw new Error(`focusedExtent: nothing focused under ${host}`);
    const box = focused.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, viewport: document.documentElement.clientHeight };
  }, OVERLAY_HOST);
}

test.describe('exclusion builder panel stays pinned on short windows', () => {
  test.beforeEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  test.afterEach(async ({ extension }) => {
    await clearDrafts(extension);
    await clearWidgetMap(extension);
  });

  for (const viewport of VIEWPORTS) {
    for (const lane of LANES) {
      test(`${lane.name} at ${String(viewport.width)}×${String(viewport.height)}: Simulated → Apply → As served keeps the panel in view`, async ({
        extension
      }) => {
        const { opened } = await openCapturedBuilder(extension, (hook) =>
          openFixturePage(extension, lane.fixture, undefined, hook)
        );
        const { page } = opened;
        try {
          await page.setViewportSize(viewport);
          await expectPinned(page, 'opened');
          expect(await applySimulated(page, [lane.group(page)])).toBe('Applied');
          await expectPinned(page, 'after the reload');
          // Keyboard, not pointer: the browser's focus reveal decides what scrolls.
          const group = lane.group(page);
          await group.getByRole('radio', { name: 'Simulated', exact: true }).focus();
          await page.keyboard.press('ArrowLeft');
          const served = group.getByRole('radio', { name: 'As served', exact: true });
          await expect(served).toBeChecked();
          await expect(served).toBeFocused();
          await expectPinned(page, 'after As served');
          // The focused radio is revealed by the body's own scroller.
          if (lane.belowFold) expect((await placement(page)).bodyScrollTop).toBeGreaterThan(0);
          const focused = await focusedExtent(page);
          expect(focused.top).toBeGreaterThanOrEqual(0);
          expect(focused.bottom).toBeLessThanOrEqual(focused.viewport);
          await expect(group).toBeInViewport();
        } finally {
          await page.close();
        }
      });
    }
  }
});
