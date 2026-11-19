/** The top bar's fold wiring: the size watch, the layout read, the fold state and its boxes. */
import { cleanup, render } from '@solidjs/testing-library';
import { createRoot, createSignal, Show } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopBarFoldPart } from '../../../lib/panel/top-bar-fold';
import {
  FOLD_ELIDE_ATTRIBUTE,
  FOLD_ELIDE_MARK,
  FOLD_STATE_ATTRIBUTE,
  FoldBox,
  FoldPart,
  createTopBarFold,
  foldStateMark,
  readFoldMetrics,
  watchFoldSizes,
  type FoldMetrics,
  type TopBarFoldSeams
} from './fold';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Give a layout-less element a fixed border-box width (and, for a label,
 * its scroll/client widths).
 */
function sized(
  element: HTMLElement,
  width: number,
  scroll?: { scrollWidth: number; clientWidth: number }
): HTMLElement {
  element.getBoundingClientRect = () => ({ width }) as DOMRect;
  if (scroll !== undefined) {
    Object.defineProperty(element, 'scrollWidth', { value: scroll.scrollWidth });
    Object.defineProperty(element, 'clientWidth', { value: scroll.clientWidth });
  }
  return element;
}

/** A seams double: records watched elements, delivers changes, reads canned metrics. */
function seamsDouble(metrics: () => FoldMetrics | null): {
  seams: TopBarFoldSeams;
  change: () => void;
  observed: Set<Element>;
  disconnected: () => boolean;
} {
  const observed = new Set<Element>();
  let onChange: (() => void) | undefined;
  let disconnected = false;
  return {
    seams: {
      watch: (callback) => {
        onChange = callback;
        return {
          observe: (element) => observed.add(element),
          unobserve: (element) => observed.delete(element),
          disconnect: () => {
            disconnected = true;
          }
        };
      },
      read: () => metrics()
    },
    change: () => onChange?.(),
    observed,
    disconnected: () => disconnected
  };
}

describe('watchFoldSizes', () => {
  it('forwards observe/unobserve/disconnect and calls back on a size change', () => {
    const calls: string[] = [];
    let callback: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe(): void {
          calls.push('observe');
        }
        unobserve(): void {
          calls.push('unobserve');
        }
        disconnect(): void {
          calls.push('disconnect');
        }
      }
    );
    const onChange = vi.fn();
    const watch = watchFoldSizes(onChange);
    const element = document.createElement('span');
    watch.observe(element);
    watch.unobserve(element);
    callback?.();
    watch.disconnect();
    expect(calls).toEqual(['observe', 'unobserve', 'disconnect']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('contains a failing measure to one logged error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let callback: (() => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    );
    watchFoldSizes(() => {
      throw new Error('bad width');
    });
    expect(() => callback?.()).not.toThrow();
    expect(error.mock.calls.some((call) => /Top bar fold failed/.test(String(call[0])))).toBe(true);
  });

  it('degrades to a no-op watch (logged) without the API', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('ResizeObserver', undefined);
    const watch = watchFoldSizes(vi.fn());
    expect(() => {
      watch.observe(document.createElement('span'));
      watch.unobserve(document.createElement('span'));
      watch.disconnect();
    }).not.toThrow();
    expect(
      warn.mock.calls.some((call) => /ResizeObserver is unavailable/.test(String(call[0])))
    ).toBe(true);
  });
});

describe('readFoldMetrics', () => {
  /** The bar double: a padded start slot holding the start row; an end slot with "⋯". */
  function bar(): {
    start: HTMLElement;
    parts: Map<TopBarFoldPart, HTMLElement>;
    menu: HTMLElement;
  } {
    const slot = sized(document.createElement('div'), 306);
    slot.style.paddingLeft = '3px';
    slot.style.paddingRight = '3px';
    const start = sized(document.createElement('div'), 250);
    start.style.columnGap = '6px';
    slot.append(start);
    const label = sized(document.createElement('span'), 40, { scrollWidth: 70, clientWidth: 40 });
    label.setAttribute(FOLD_ELIDE_ATTRIBUTE, '');
    // A capped label: elided at its 50 px cap by design, only 10 px lost to the squeeze.
    const capped = sized(document.createElement('span'), 40, { scrollWidth: 90, clientWidth: 40 });
    capped.setAttribute(FOLD_ELIDE_ATTRIBUTE, '');
    capped.style.maxWidth = '50px';
    const brand = sized(document.createElement('span'), 24);
    brand.setAttribute(FOLD_STATE_ATTRIBUTE, 'inline');
    const address = sized(document.createElement('span'), 100);
    address.setAttribute(FOLD_STATE_ATTRIBUTE, 'folded');
    start.append(brand, label, capped, address);
    const end = document.createElement('div');
    end.style.columnGap = '2px';
    const menu = sized(document.createElement('span'), 28);
    menu.setAttribute(FOLD_STATE_ATTRIBUTE, 'inline');
    end.append(menu);
    // Computed styles resolve on connected elements only.
    document.body.append(slot, end);
    return {
      start,
      parts: new Map<TopBarFoldPart, HTMLElement>([
        ['brand', brand],
        ['address', address]
      ]),
      menu
    };
  }

  it('reads the free px, each part’s cost (gap included), the inline sum and the menu', () => {
    const { start, parts, menu } = bar();
    // Slot content 300; natural 250 + 30 (squeezed label) + 10 (capped label) = 290.
    expect(readFoldMetrics({ start, parts, menu })).toEqual({
      free: 10,
      widths: { brand: 30, address: 106 },
      inlineCost: 30,
      menuWidth: 30,
      menuShown: true
    });
  });

  it('counts content overflowing the start row (its scroll extent)', () => {
    const { start, parts, menu } = bar();
    Object.defineProperty(start, 'scrollWidth', { value: 270 });
    expect(readFoldMetrics({ start, parts, menu })?.free).toBe(-10);
  });

  it('reads a hidden "⋯" as not shown', () => {
    const { start, parts, menu } = bar();
    menu.setAttribute(FOLD_STATE_ATTRIBUTE, 'folded');
    expect(readFoldMetrics({ start, parts, menu })?.menuShown).toBe(false);
  });

  it('reads nothing before the bar is mounted', () => {
    const { start, parts, menu } = bar();
    expect(readFoldMetrics({ start: null, parts, menu })).toBeNull();
    expect(readFoldMetrics({ start, parts, menu: null })).toBeNull();
    expect(readFoldMetrics({ start: document.createElement('div'), parts, menu })).toBeNull();
  });
});

describe('createTopBarFold', () => {
  /** Canned metrics: every registered part costs 50 px, "⋯" 30 px. */
  const metricsFor = (room: () => number, parts: () => TopBarFoldPart[]) => (): FoldMetrics => ({
    free: room(),
    widths: Object.fromEntries(parts().map((part) => [part, 50])),
    inlineCost: 0,
    menuWidth: 30,
    menuShown: false
  });

  it('starts inline with no menu, then follows each measure', () => {
    let roomPx = 1000;
    const room = (): number => roomPx;
    const double = seamsDouble(metricsFor(room, () => ['address', 'brand']));
    createRoot((dispose) => {
      const fold = createTopBarFold(() => false, double.seams);
      expect(fold.inline('address')).toBe(true);
      expect(fold.menu()).toBe(false);
      fold.attachStart(document.createElement('div'));
      fold.attachMenu(document.createElement('span'));
      double.change();
      expect(fold.inline('address')).toBe(true);
      roomPx = 80; // brand (50) + "⋯" (30)
      double.change();
      expect(fold.inline('address')).toBe(false);
      expect(fold.inline('brand')).toBe(true);
      expect(fold.menu()).toBe(true);
      dispose();
    });
    expect(double.disconnected()).toBe(true);
  });

  it('folds the compact bar’s secondaries by rule and always shows "⋯" there', () => {
    const [compact, setCompact] = createSignal(true);
    const double = seamsDouble(() => null);
    createRoot((dispose) => {
      const fold = createTopBarFold(compact, double.seams);
      for (const part of ['address', 'server', 'cacheAge', 'freshness'] as const)
        expect(fold.inline(part)).toBe(false);
      expect(fold.inline('brand')).toBe(true);
      expect(fold.menu()).toBe(true);
      setCompact(false);
      expect(fold.inline('server')).toBe(true);
      expect(fold.menu()).toBe(false);
      dispose();
    });
  });

  it('watches registered parts, the start row, its slot, "⋯" and the row’s pill labels', async () => {
    const double = seamsDouble(() => null);
    await createRoot(async (dispose) => {
      const fold = createTopBarFold(() => false, double.seams);
      const slot = document.createElement('div');
      const start = document.createElement('div');
      slot.append(start);
      const label = document.createElement('span');
      label.setAttribute(FOLD_ELIDE_ATTRIBUTE, '');
      start.append(label);
      const part = document.createElement('span');
      const menu = document.createElement('span');
      fold.attachStart(start);
      fold.attachMenu(menu);
      const unregister = fold.register('server', part);
      await Promise.resolve(); // the slot is watched once the row is in place
      expect([...double.observed]).toEqual(expect.arrayContaining([start, slot, menu, part]));

      double.change();
      expect(double.observed.has(label)).toBe(true);
      label.remove();
      double.change();
      expect(double.observed.has(label)).toBe(false);

      unregister();
      expect(double.observed.has(part)).toBe(false);
      dispose();
    });
  });

  it('keeps a newer registration when an older one unregisters late', () => {
    let roomPx = 1000;
    const room = (): number => roomPx;
    const registered: TopBarFoldPart[] = [];
    const double = seamsDouble(metricsFor(room, () => registered));
    createRoot((dispose) => {
      const fold = createTopBarFold(() => false, double.seams);
      fold.attachStart(document.createElement('div'));
      fold.attachMenu(document.createElement('span'));
      const first = document.createElement('span');
      const second = document.createElement('span');
      const dropFirst = fold.register('server', first);
      fold.register('server', second);
      dropFirst();
      expect(double.observed.has(second)).toBe(true);
      registered.push('server');
      roomPx = 0;
      double.change();
      expect(fold.inline('server')).toBe(false);
      dispose();
    });
  });
});

describe('fold marks', () => {
  it('names the state and elide attributes the measure reads', () => {
    expect(foldStateMark(true)).toEqual({ 'data-fdt-fold': 'inline' });
    expect(foldStateMark(false)).toEqual({ 'data-fdt-fold': 'folded' });
    expect(FOLD_ELIDE_MARK).toEqual({ 'data-fdt-fold-elide': '' });
  });

  it('lands on a rendered label, where the measure finds it', () => {
    const { container } = render(() => <span {...FOLD_ELIDE_MARK}>label</span>);
    expect(container.querySelectorAll(`[${FOLD_ELIDE_ATTRIBUTE}]`)).toHaveLength(1);
  });
});

describe('FoldBox / FoldPart', () => {
  it('lays a folded box out of sight, an inline one in the flow', () => {
    const [inline, setInline] = createSignal(true);
    render(() => (
      <FoldBox inline={inline()} ref={() => undefined} data-fdt="box" part="server">
        <span>value</span>
      </FoldBox>
    ));
    const box = document.querySelector('[data-fdt="box"]') as HTMLElement;
    expect(box.getAttribute(FOLD_STATE_ATTRIBUTE)).toBe('inline');
    expect(box.getAttribute('data-fdt-fold-part')).toBe('server');
    expect(box.getAttribute('style')).toBeNull();
    expect(box.classList).toContain('shrink-0');
    setInline(false);
    expect(box.getAttribute(FOLD_STATE_ATTRIBUTE)).toBe('folded');
    expect(box.style.position).toBe('absolute');
    expect(box.style.visibility).toBe('hidden');
  });

  it('registers a part while mounted and unregisters it on unmount', () => {
    const double = seamsDouble(() => null);
    const [shown, setShown] = createSignal(true);
    let fold: ReturnType<typeof createTopBarFold> | undefined;
    render(() => {
      fold = createTopBarFold(() => false, double.seams);
      const current = fold;
      return (
        <Show when={shown()}>
          <FoldPart fold={current} part="freshness" data-fdt="part">
            <span>11 min ago</span>
          </FoldPart>
        </Show>
      );
    });
    const part = document.querySelector('[data-fdt="part"]') as HTMLElement;
    expect(double.observed.has(part)).toBe(true);
    expect(part.getAttribute('data-fdt-fold-part')).toBe('freshness');
    setShown(false);
    expect(double.observed.has(part)).toBe(false);
    expect(fold).toBeDefined();
  });
});
