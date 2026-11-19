/**
 * Render tests for the loading shapes: one per nav group, each shaped like
 * its page (tiles + grouped cards, a calm list, the run card over the empty
 * result), every placeholder bounded by its column, the whole decorative.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { HEADER_ACTION_ROUTES, NAV_GROUPS, NAV_ROUTES, ROUTE_IDS, type RouteId } from '../routes';
import {
  GROUP_SHAPE_ROWS,
  LIST_SHAPE_ROWS,
  LOADING_SHAPES,
  LoadingActions,
  LoadingSubtitle,
  RouteLoading,
  loadingShapeFor
} from './loading-shapes';

afterEach(() => {
  cleanup();
});

/**
 * Render a route's loading body.
 *
 * @param route The route.
 * @returns The shape's root.
 */
function mount(route: RouteId): HTMLElement {
  render(() => <RouteLoading route={route} />);
  const root = document.querySelector<HTMLElement>('[data-fdt="route-loading"]');
  if (root === null) throw new Error('no loading body');
  return root;
}

describe('LOADING_SHAPES', () => {
  it('has one shape per nav group, and every route resolves to its group’s', () => {
    expect(Object.keys(LOADING_SHAPES).sort()).toEqual([...NAV_GROUPS].sort());
    for (const route of NAV_ROUTES) {
      expect(loadingShapeFor(route.id)).toBe(LOADING_SHAPES[route.group]);
    }
  });
});

describe('RouteLoading', () => {
  it.each(ROUTE_IDS)('%s: decorative, named by its group, every placeholder bounded', (id) => {
    const root = mount(id);
    expect(root.getAttribute('aria-hidden')).toBe('true');
    expect(root.getAttribute('data-fdt-loading-shape')).toBe(
      NAV_ROUTES.find((route) => route.id === id)?.group
    );
    const bars = [...root.querySelectorAll('[data-fdt="skeleton"]')];
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      if (!bar.classList.contains('w-full')) expect(bar.classList).toContain('max-w-full');
    }
    // Nothing interactive inside a decorative subtree.
    expect(root.querySelector('button, a, input, [tabindex]')).toBeNull();
  });

  it('Overview: the overview tiles, the filter tray, then two grouped cards', () => {
    const root = mount('detections');
    expect(root.querySelector('[data-fdt="detections-overview-skeleton"]')).not.toBeNull();
    const groups = [...root.querySelectorAll(':scope > div:last-child > [data-fdt="card"]')];
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      // A heading line, then the rows (dot + line each).
      expect(group.querySelectorAll('[data-fdt="skeleton"]')).toHaveLength(
        1 + GROUP_SHAPE_ROWS * 2
      );
    }
  });

  it('Inspect and Diagnose: a toolbar over calm two-line rows on the canvas (no card)', () => {
    for (const id of ['javascript', 'undefined-references'] as const) {
      const root = mount(id);
      expect(root.querySelector('[data-fdt="card"]')).toBeNull();
      const rows = root.querySelectorAll('.min-h-\\[58px\\]');
      expect(rows).toHaveLength(LIST_SHAPE_ROWS);
      for (const row of rows) {
        // Icon tile + name + preview.
        expect(row.querySelectorAll('[data-fdt="skeleton"]')).toHaveLength(3);
      }
      cleanup();
    }
  });

  it('Tools: the raised run card over the dashed empty-result card', () => {
    const root = mount('rucss-tester');
    const cards = [...root.querySelectorAll(':scope > [data-fdt="card"]')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.classList).toContain('shadow-elev-1');
    expect(cards[1]?.classList).toContain('border-dashed');
    expect(cards[0]?.querySelector('.rounded-control')).not.toBeNull();
  });
});

describe('LoadingSubtitle', () => {
  it('reserves two text lines while compact, one beside the title from the regular tier', () => {
    render(() => <LoadingSubtitle />);
    const root = document.querySelector<HTMLElement>('[data-fdt="loading-subtitle"]');
    expect(root?.getAttribute('aria-hidden')).toBe('true');
    // Its own line under the title (full width) while compact, a sentence's run beside it after.
    expect(root?.classList).toContain('w-[calc(100cqw-1.5rem)]');
    expect(root?.classList).toContain('@regular:w-72');
    // Two 10 px pills in 16 px line boxes: 3 + 10 + 6 + 10 + 3 = the two lines' 32 px.
    expect(root?.classList).toContain('py-[3px]');
    expect(root?.classList).toContain('gap-1.5');
    const lines = [...(root?.querySelectorAll('[data-fdt="skeleton"]') ?? [])];
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.classList).toContain('h-2.5');
    expect(lines[0]?.classList).not.toContain('@regular:hidden');
    expect(lines[1]?.classList).toContain('@regular:hidden');
  });
});

describe('LoadingActions', () => {
  it.each(ROUTE_IDS)('%s: one small-button box only when its header has actions', (id) => {
    render(() => (
      <div data-probe>
        <LoadingActions route={id} />
      </div>
    ));
    const bars = document.querySelectorAll('[data-probe] [data-fdt="skeleton"]');
    expect(bars).toHaveLength((HEADER_ACTION_ROUTES as readonly RouteId[]).includes(id) ? 1 : 0);
    // The `sm` button's 24 px height, bounded by its column.
    if (bars[0] !== undefined) {
      expect(bars[0].classList).toContain('h-6');
      expect(bars[0].classList).toContain('max-w-full');
    }
  });
});
