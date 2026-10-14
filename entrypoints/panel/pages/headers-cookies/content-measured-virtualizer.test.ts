/**
 * The content-measured virtualizer factory: rows are measured by their first
 * child (not the height-pinned wrapper), registered one microtask after the
 * list's ref fires (when `data-index` exists), re-measured when their content
 * resizes, and the shared observer is released with the list. TanStack's
 * `createVirtualizer` is replaced by a recording double — happy-dom has no
 * layout, so the factory's wiring is what is pinned here; the real geometry
 * is verified in the browser.
 */
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VirtualListOptions } from '../../../../components/ui/virtual-list';

/** What the double's `createVirtualizer` recorded. */
const recorded = vi.hoisted(() => ({
  options: undefined as (Record<string, unknown> & { count?: number }) | undefined,
  measured: [] as Array<Element | null>,
  resized: [] as Array<[number, number]>
}));

vi.mock('@tanstack/solid-virtual', () => ({
  createVirtualizer: (options: Record<string, unknown>) => {
    recorded.options = options;
    return {
      getVirtualItems: () => [],
      getTotalSize: () => 123,
      measureElement: (node: Element | null) => {
        recorded.measured.push(node);
      },
      indexFromElement: (node: Element) => Number(node.getAttribute('data-index') ?? -1),
      resizeItem: (index: number, size: number) => {
        recorded.resized.push([index, size]);
      }
    };
  }
}));

// Imported after the mock is declared (vi.mock is hoisted above imports).
import {
  applyContentResizes,
  contentMeasuredVirtualizer,
  rowContentHeight
} from './content-measured-virtualizer';

/** A recording ResizeObserver double (happy-dom's own never fires). */
class ObserverDouble {
  static last: ObserverDouble | undefined;
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    ObserverDouble.last = this;
  }
  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
}

/** A wrapper + content pair with a pinned content height (happy-dom lays nothing out). */
function rowElement(
  index: number | null,
  height: number
): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement('div');
  if (index !== null) wrapper.setAttribute('data-index', String(index));
  const content = document.createElement('div');
  Object.defineProperty(content, 'offsetHeight', { value: height });
  wrapper.append(content);
  document.body.append(wrapper);
  return { wrapper, content };
}

/** List options the way the list hands them: getters over live values. */
function liveOptions(count: () => number): VirtualListOptions {
  return {
    get count() {
      return count();
    },
    estimateSize: () => 40,
    getScrollElement: () => null,
    overscan: 3
  };
}

beforeEach(() => {
  recorded.options = undefined;
  recorded.measured = [];
  recorded.resized = [];
  ObserverDouble.last = undefined;
  vi.stubGlobal('ResizeObserver', ObserverDouble);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('rowContentHeight', () => {
  it('reads the rendered row, not the wrapper', () => {
    const { wrapper } = rowElement(0, 96);
    Object.defineProperty(wrapper, 'offsetHeight', { value: 44 });
    expect(rowContentHeight(wrapper)).toBe(96);
  });

  it("falls back to the wrapper's own height when it holds no element", () => {
    const wrapper = document.createElement('div');
    Object.defineProperty(wrapper, 'offsetHeight', { value: 30 });
    expect(rowContentHeight(wrapper)).toBe(30);
  });

  it('answers 0 for a non-HTML wrapper without content', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expect(rowContentHeight(svg)).toBe(0);
  });
});

describe('applyContentResizes', () => {
  it('feeds each connected row its content height at its wrapper index', () => {
    const a = rowElement(2, 50);
    const b = rowElement(7, 81);
    const resizeItem = vi.fn();
    const unobserve = vi.fn();
    applyContentResizes(
      [{ target: a.content }, { target: b.content }],
      { indexFromElement: (node) => Number(node.getAttribute('data-index')), resizeItem },
      unobserve
    );
    expect(resizeItem.mock.calls).toEqual([
      [2, 50],
      [7, 81]
    ]);
    expect(unobserve).not.toHaveBeenCalled();
  });

  it('stops watching rows that left the document', () => {
    const gone = rowElement(1, 20);
    gone.wrapper.remove();
    const orphan = document.createElement('div');
    const resizeItem = vi.fn();
    const unobserve = vi.fn();
    applyContentResizes(
      [{ target: gone.content }, { target: orphan }],
      { indexFromElement: () => 1, resizeItem },
      unobserve
    );
    expect(resizeItem).not.toHaveBeenCalled();
    expect(unobserve.mock.calls).toEqual([[gone.content], [orphan]]);
  });

  it('skips a wrapper the virtualizer cannot index', () => {
    const row = rowElement(null, 20);
    const resizeItem = vi.fn();
    applyContentResizes(
      [{ target: row.content }],
      { indexFromElement: () => -1, resizeItem },
      vi.fn()
    );
    expect(resizeItem).not.toHaveBeenCalled();
  });
});

describe('contentMeasuredVirtualizer', () => {
  it('keeps the list options live and measures rows by their content', () => {
    createRoot((dispose) => {
      let count = 3;
      contentMeasuredVirtualizer()(liveOptions(() => count));
      const options = recorded.options;
      expect(options?.count).toBe(3);
      count = 9;
      expect(options?.count).toBe(9); // a getter, not a snapshot
      const { wrapper, content } = rowElement(0, 72);
      const measure = options?.measureElement as (element: Element) => number;
      expect(measure(wrapper)).toBe(72);
      // Measuring also starts watching the row's content.
      expect(ObserverDouble.last?.observed.has(content)).toBe(true);
      dispose();
    });
  });

  it('registers a row one microtask after the ref fires, and passes null through', async () => {
    await createRoot(async (dispose) => {
      const instance = contentMeasuredVirtualizer()(liveOptions(() => 1));
      expect(instance.getTotalSize()).toBe(123);
      expect(instance.getVirtualItems()).toEqual([]);
      const { wrapper } = rowElement(0, 10);
      instance.measureElement(wrapper);
      expect(recorded.measured).toEqual([]); // the ref's moment: not yet
      await Promise.resolve();
      expect(recorded.measured).toEqual([wrapper]);
      instance.measureElement(null);
      expect(recorded.measured).toEqual([wrapper, null]); // synchronous cleanup pass
      dispose();
    });
  });

  it('re-measures a row when its content resizes', () => {
    createRoot((dispose) => {
      contentMeasuredVirtualizer()(liveOptions(() => 1));
      const { content } = rowElement(4, 58);
      const observer = ObserverDouble.last;
      observer?.callback([{ target: content } as unknown as ResizeObserverEntry], observer);
      expect(recorded.resized).toEqual([[4, 58]]);
      dispose();
    });
  });

  it('releases the shared observer with the list', () => {
    createRoot((dispose) => {
      contentMeasuredVirtualizer()(liveOptions(() => 1));
      const observer = ObserverDouble.last;
      expect(observer?.disconnected).toBe(false);
      dispose();
      expect(observer?.disconnected).toBe(true);
    });
  });

  it('still measures by content where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    createRoot((dispose) => {
      contentMeasuredVirtualizer()(liveOptions(() => 1));
      const { wrapper } = rowElement(0, 33);
      const measure = recorded.options?.measureElement as (element: Element) => number;
      expect(measure(wrapper)).toBe(33);
      dispose();
    });
  });
});
