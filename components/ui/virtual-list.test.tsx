/**
 * Contract tests for the virtual list wrapper: rendered geometry against an
 * injected virtualizer double (serving fixed virtual items), because
 * happy-dom has no layout engine — the wrapper's *contract* (spacer height,
 * absolute translate rows, `data-index` + measurement wiring, overscan and
 * options pass-through) is what needs pinning, not TanStack's internals.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createSignal, mergeProps } from 'solid-js';
import { createVirtualizer } from '@tanstack/solid-virtual';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VirtualList,
  type VirtualItem,
  type VirtualizerFactory,
  type VirtualListOptions,
  type VirtualScrollRequest
} from './virtual-list';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The probe's instance double shape (the declared surface for test doubles). */
interface VirtualizerInstanceProbe {
  /** The rows `getVirtualItems` returns. */
  getVirtualItems: () => VirtualItem[];
  /** The height `getTotalSize` reports (px). */
  getTotalSize: () => number;
  /** The measurement binding the wrapper hands row elements into. */
  measureElement: (node: HTMLElement | null) => void;
  /** The optional core scroll: records every landed row index. */
  scrollToIndex?: (index: number, options?: { align?: string }) => void;
}

/** A fixed virtual row (the core's own shape — verified in the installed types). */
function row(
  index: number,
  start: number,
  size: number,
  key: VirtualItem['key'] = `key-${String(index)}`
): VirtualItem {
  return { key, index, start, end: start + size, size, lane: 0 };
}

interface FactoryProbe {
  /** The factory to pass as the `createVirtualizer` seam. */
  factory: VirtualizerFactory;
  /** The last options object the factory received. */
  options: VirtualListOptions | undefined;
  /** The elements bound through measureElement (the ref wiring), in order. */
  measured: Array<HTMLElement | null>;
  /** Each bound element's `data-index` as it was at measure time. */
  indexAtMeasure: Array<string | null>;
}

/**
 * Build a virtualizer double: serves fixed rows/total size, records the
 * options it was constructed with and the elements it was asked to measure.
 *
 * @param items The rows `getVirtualItems` returns.
 * @param totalSize The height `getTotalSize` reports (px).
 */
function probe(items: VirtualItem[], totalSize: number): FactoryProbe {
  const state: FactoryProbe = {
    factory: () => {
      throw new Error('probe factory not wired');
    },
    options: undefined,
    measured: [],
    indexAtMeasure: []
  };
  state.factory = (options: VirtualListOptions): VirtualizerInstanceProbe => {
    state.options = options;
    return {
      getVirtualItems: () => items,
      getTotalSize: () => totalSize,
      measureElement: (node: HTMLElement | null) => {
        state.measured.push(node);
        state.indexAtMeasure.push(node?.getAttribute('data-index') ?? null);
      }
    };
  };
  return state;
}

describe('VirtualList', () => {
  it('sizes the spacer from getTotalSize and places rows at translateY(start)', () => {
    const p = probe([row(0, 0, 40), row(1, 40, 60), row(2, 100, 30)], 130);
    render(() => (
      <VirtualList count={100} estimateSize={() => 40} createVirtualizer={p.factory}>
        {(item) => <span data-fdt-row={String(item.index)}>row {String(item.index)}</span>}
      </VirtualList>
    ));
    const spacer = document.querySelector('[data-fdt-virtual-spacer]') as HTMLElement;
    expect(spacer.style.height).toBe('130px');
    expect(spacer.style.position).toBe('relative');
    const rows = Array.from(document.querySelectorAll('[data-index]'));
    expect(rows.length).toBe(3);
    expect((rows[1] as HTMLElement).style.transform).toBe('translateY(40px)');
    expect((rows[1] as HTMLElement).style.position).toBe('absolute');
  });

  it('never pins a row height, so measurement reads the content size', () => {
    const p = probe([row(0, 0, 40), row(1, 40, 60)], 100);
    render(() => (
      <VirtualList count={2} estimateSize={() => 40} createVirtualizer={p.factory}>
        {(item) => <span data-fdt-row={String(item.index)}>row {String(item.index)}</span>}
      </VirtualList>
    ));
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-index]'));
    expect(rows.length).toBe(2);
    for (const el of rows) {
      // A pinned height would make the border-box observer read the estimate
      // back and let taller content overflow into the next row.
      expect(el.style.height).toBe('');
      expect(el.style.minHeight).toBe('');
      expect(el.style.maxHeight).toBe('');
    }
    // Every rendered row is handed to measurement already carrying its index
    // (the core resolves the row from `data-index` at call time — read later,
    // after Solid applies attributes, it would be too late).
    expect(p.indexAtMeasure).toEqual(['0', '1']);
  });

  it('calls the row renderer per virtual row; rows carry the data-index contract', () => {
    const p = probe([row(7, 168, 32)], 200);
    render(() => (
      <VirtualList count={10} estimateSize={() => 24} createVirtualizer={p.factory}>
        {(item) => <span data-fdt-row-content={String(item.index)}>row {String(item.index)}</span>}
      </VirtualList>
    ));
    // The page's own row content renders inside the measured wrapper.
    expect(document.querySelector('[data-fdt-row-content="7"]')?.textContent).toBe('row 7');
    // The TanStack measurement protocol: rows expose `data-index` and hand
    // themselves to measureElement through the ref (element, never null at mount).
    expect(document.querySelectorAll('[data-index="7"]').length).toBe(1);
    expect(p.measured.at(-1)).toBeInstanceOf(HTMLElement);
    expect((p.measured.at(-1) as HTMLElement).getAttribute('data-index')).toBe('7');
  });

  it('passes count/overscan/key/gap/padding options through unchanged', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList
        count={123}
        estimateSize={() => 24}
        overscan={5}
        getItemKey={(index) => `r${String(index)}`}
        gap={2}
        paddingStart={4}
        paddingEnd={6}
        createVirtualizer={p.factory}
      >
        {(): JSX.Element => <span data-fdt-row-content="0" />}
      </VirtualList>
    ));
    expect(p.options?.count).toBe(123);
    expect(p.options?.overscan).toBe(5);
    expect(p.options?.getItemKey?.(3)).toBe('r3');
    expect(p.options?.gap).toBe(2);
    expect(p.options?.paddingStart).toBe(4);
    expect(p.options?.paddingEnd).toBe(6);
  });

  it('defaults overscan to 3 and serves its own container as the scroll element', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList count={10} estimateSize={() => 24} createVirtualizer={p.factory}>
        {(): JSX.Element => <span data-fdt-row-content="0" />}
      </VirtualList>
    ));
    expect(p.options?.overscan).toBe(3);
    // The scroll element is the wrapper's own scroller (ref resolution), the
    // getter itself staying null-safe pre-mount.
    expect(p.options?.getScrollElement()).toBe(document.querySelector('[data-fdt="virtual-list"]'));
  });

  it('lets the caller own height/flow classes on the scroller', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList count={2} estimateSize={() => 24} class="h-40" createVirtualizer={p.factory}>
        {(): JSX.Element => <span data-fdt-row-content="0" />}
      </VirtualList>
    ));
    const scroller = document.querySelector('[data-fdt="virtual-list"]');
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.className).toContain('h-40');
  });
});

describe('VirtualList — accessibility seam', () => {
  it('applies no list semantics by default (the caller owns them)', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList count={2} estimateSize={() => 24} createVirtualizer={p.factory}>
        {(): JSX.Element => <span data-fdt-row-content="0" />}
      </VirtualList>
    ));
    const scroller = document.querySelector('[data-fdt="virtual-list"]');
    expect(scroller?.getAttribute('role')).toBeNull();
    expect(scroller?.getAttribute('aria-label')).toBeNull();
  });

  it('carries an explicit scrollerRole when the surface is a true list', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList
        count={2}
        estimateSize={() => 24}
        scrollerRole="list"
        aria-label="Delayed scripts"
        createVirtualizer={p.factory}
      >
        {(): JSX.Element => <span data-fdt-row-content="0" role="listitem" />}
      </VirtualList>
    ));
    const scroller = document.querySelector('[data-fdt="virtual-list"]');
    expect(scroller?.getAttribute('role')).toBe('list');
    expect(scroller?.getAttribute('aria-label')).toBe('Delayed scripts');
    // The contract holds together: the caller's rows supply the listitems
    // (this pin documents the pair — see the scrollerRole prop's note).
    expect(scroller?.querySelector('[role="listitem"]')).toBeTruthy();
  });

  it('accepts the feed role for stream-style surfaces', () => {
    const p = probe([row(0, 0, 24)], 24);
    render(() => (
      <VirtualList
        count={2}
        estimateSize={() => 24}
        scrollerRole="feed"
        createVirtualizer={p.factory}
      >
        {(): JSX.Element => <span data-fdt-row-content="0" />}
      </VirtualList>
    ));
    expect(document.querySelector('[data-fdt="virtual-list"]')?.getAttribute('role')).toBe('feed');
  });
});

/** A store-backed double: mirrors the adapter, which reconciles items by index into one store. */
interface StoreProbe {
  /** The factory to pass as the `createVirtualizer` seam. */
  factory: VirtualizerFactory;
  /** Publish a new window (reconciled by index, like the adapter). */
  publish: (items: VirtualItem[]) => void;
  /** Elements handed to measureElement, with their `data-index` at call time. */
  measured: Array<{ el: HTMLElement; index: string | null }>;
}

/**
 * Build a store-backed virtualizer double.
 *
 * @param initial The first window.
 */
function storeProbe(initial: VirtualItem[]): StoreProbe {
  const [items, setItems] = createStore<VirtualItem[]>(initial);
  const [total, setTotal] = createSignal(initial.at(-1)?.end ?? 0);
  const measured: StoreProbe['measured'] = [];
  return {
    factory: () => ({
      getVirtualItems: () => items,
      getTotalSize: total,
      measureElement: (node: HTMLElement | null) => {
        if (node) measured.push({ el: node, index: node.getAttribute('data-index') });
      }
    }),
    publish: (next) => {
      setItems(reconcile(next, { key: 'index' }));
      setTotal(next.at(-1)?.end ?? 0);
    },
    measured
  };
}

/**
 * Render a list over a store probe; each row hosts a focusable button.
 *
 * @param p The store probe.
 */
function renderKeyed(p: StoreProbe): void {
  render(() => (
    <VirtualList count={10} estimateSize={() => 40} createVirtualizer={p.factory}>
      {(item) => <button type="button">{String(item.key)}</button>}
    </VirtualList>
  ));
}

/** The row element currently holding `key` (via its rendered label). */
function rowOf(key: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-index]')).find(
    (el) => el.textContent === key
  );
}

describe('VirtualList — row identity follows the key', () => {
  it('keeps every element (and focus) across a refresh with the same keys', () => {
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b')]);
    renderKeyed(p);
    const a = rowOf('a');
    const b = rowOf('b');
    b?.querySelector('button')?.focus();
    const measuredBefore = p.measured.length;
    // A soft refresh re-measures row a taller: geometry moves, identity holds.
    p.publish([row(0, 0, 98, 'a'), row(1, 98, 40, 'b')]);
    expect(rowOf('a')).toBe(a);
    expect(rowOf('b')).toBe(b);
    expect(rowOf('b')?.style.transform).toBe('translateY(98px)');
    expect(document.activeElement).toBe(b?.querySelector('button'));
    expect(p.measured.length).toBe(measuredBefore);
    expect((document.querySelector('[data-fdt-virtual-spacer]') as HTMLElement).style.height).toBe(
      '138px'
    );
  });

  it('re-creates and measures the row when an index gets a new key', () => {
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b')]);
    renderKeyed(p);
    const a = rowOf('a');
    // A filter: index 0 now holds key c (a is gone), index 1 keeps b.
    p.publish([row(0, 0, 40, 'c'), row(1, 40, 40, 'b')]);
    expect(rowOf('a')).toBeUndefined();
    expect(a?.isConnected).toBe(false);
    const c = rowOf('c');
    expect(c).toBeInstanceOf(HTMLElement);
    expect(c).not.toBe(a);
    // The fresh element was handed to measurement already carrying its index.
    expect(p.measured.at(-1)).toEqual({ el: c, index: '0' });
  });

  it('keeps the element of a key that moves index, updating only its index and offset', () => {
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b'), row(2, 80, 40, 'c')]);
    renderKeyed(p);
    const c = rowOf('c');
    c?.querySelector('button')?.focus();
    const measuredBefore = p.measured.length;
    // A filter drops a and b: c moves from index 2 to index 0.
    p.publish([row(0, 0, 40, 'c'), row(1, 40, 40, 'd')]);
    expect(rowOf('c')).toBe(c);
    expect(c?.getAttribute('data-index')).toBe('0');
    expect(c?.style.transform).toBe('translateY(0px)');
    expect(document.activeElement).toBe(c?.querySelector('button'));
    // Only the new key d was measured; c keeps its key-cached size.
    expect(p.measured.slice(measuredBefore).map((m) => m.el.textContent)).toEqual(['d']);
  });

  it('renders falsy keys (the default index key 0)', () => {
    const p = storeProbe([row(0, 0, 40, 0), row(1, 40, 40, 1)]);
    renderKeyed(p);
    expect(rowOf('0')?.getAttribute('data-index')).toBe('0');
    expect(document.querySelectorAll('[data-index]').length).toBe(2);
  });

  it('drops a key that leaves the window without throwing, keeping the rest', () => {
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b'), row(2, 80, 40, 'c')]);
    renderKeyed(p);
    const c = rowOf('c');
    // The window shrinks and b leaves: its element goes, c moves up.
    expect(() => {
      p.publish([row(0, 0, 40, 'a'), row(1, 40, 40, 'c')]);
    }).not.toThrow();
    expect(rowOf('b')).toBeUndefined();
    expect(rowOf('c')).toBe(c);
    expect(c?.style.transform).toBe('translateY(40px)');
  });

  it('warns (dev) naming duplicate keys, which drop rows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'a'), row(2, 80, 40, 'b')]);
    renderKeyed(p);
    expect(document.querySelectorAll('[data-index]').length).toBe(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const [message] = warn.mock.calls[0] as [string];
    expect(message).toMatch(/^\[WPR FDT\] \[virtual-list\] duplicate row keys a /);
  });

  it('stays silent when keys are unique', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    renderKeyed(storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b')]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('re-keys the real virtualizer when rows swap at an equal count', () => {
    // The default factory (TanStack's core): it caches row keys until the
    // count or the key function's identity changes — a search replacing one
    // match by another keeps the count, so only the wrapper's key snapshot
    // re-keys it (without it, the old rows stayed rendered).
    const [rows, setRows] = createSignal(['md-19', 'md-20']);
    // The core itself, over a laid-out viewport (happy-dom lays out none).
    const VIEWPORT = { width: 320, height: 400 };
    const real: VirtualizerFactory = (options) =>
      createVirtualizer(
        mergeProps(options, {
          initialRect: VIEWPORT,
          observeElementRect: (_: unknown, report: (rect: typeof VIEWPORT) => void) => {
            report(VIEWPORT);
            return () => undefined;
          }
        })
      );
    render(() => (
      <VirtualList
        count={rows().length}
        estimateSize={() => 40}
        getItemKey={(index) => rows()[index] ?? `missing-${String(index)}`}
        createVirtualizer={real}
      >
        {(item) => <span data-fdt-label>{String(item.key)}</span>}
      </VirtualList>
    ));
    const labels = (): string[] =>
      [...document.querySelectorAll('[data-fdt-label]')].map((label) => label.textContent);
    expect(labels()).toEqual(['md-19', 'md-20']);
    setRows(['md-07', 'md-08']);
    expect(labels()).toEqual(['md-07', 'md-08']);
    // Same keys again: still the listed rows.
    setRows(['md-07', 'md-08']);
    expect(labels()).toEqual(['md-07', 'md-08']);
  });
});

describe('VirtualList — Tab entry masking', () => {
  /** The document-level Tab keydown the navigation dispatches. */
  const press = (): void => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    );
  };

  /**
   * Mount the shared entry-mask scenario: a keyed three-row list (a visible,
   * b crossing the 60 px band edge, c entirely outside) with happy-dom-absent
   * rect/client metrics stubbed on the scroller and rows, resolving after the
   * document-level wiring settles. The caller presses and pops itself.
   *
   * @throws {@link Error} When the mount contract is broken (no scroller/row).
   */
  async function renderEntryScenario(): Promise<void> {
    const p = storeProbe([row(0, 0, 40, 'a'), row(1, 40, 40, 'b'), row(2, 80, 40, 'c')]);
    render(() => (
      <VirtualList count={10} estimateSize={() => 40} createVirtualizer={p.factory}>
        {(item) => <button type="button">{String(item.key)}</button>}
      </VirtualList>
    ));
    // The document-level wiring settles on a microtask after the sync mount.
    await Promise.resolve();
    const scroller = document.querySelector<HTMLElement>('[data-fdt="virtual-list"]');
    if (!(scroller instanceof HTMLElement)) throw new Error('scroller not mounted');
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 60,
      height: 60
    } as DOMRect);
    // The real element reports its content metrics; happy-dom's are zeros —
    // stub a borderless scroller so the content-box band equals the box.
    Object.defineProperty(scroller, 'clientTop', { value: 0 });
    Object.defineProperty(scroller, 'clientHeight', { value: 60 });
    for (const [id, top] of [
      ['a', 0],
      ['b', 40],
      ['c', 80]
    ] as const) {
      const rowEl = rowOf(id);
      if (!rowEl) throw new Error(`row ${id} not mounted`);
      vi.spyOn(rowEl, 'getBoundingClientRect').mockReturnValue({
        top,
        bottom: top + 40,
        height: 40
      } as DOMRect);
    }
  }

  it('masks whole-offscreen overscan rows for a Tab press and pops on focusin', async () => {
    // Window a (0–40) visible, b (40–80) crossing the band edge (0–60), and
    // c (80–120) entirely outside — the masked press must spare a and b and
    // suppress only c, then pop on the navigation's own focusin.
    await renderEntryScenario();
    press();
    expect(rowOf('a')?.inert).toBe(false);
    expect(rowOf('b')?.inert).toBe(false);
    expect(rowOf('c')?.inert).toBe(true);
    document.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(rowOf('c')?.inert).toBe(false);
  });

  it('restores rows and detaches when the list unmounts mid-mask', async () => {
    await renderEntryScenario();
    press();
    const c = rowOf('c');
    expect(c?.inert).toBe(true);
    // An unmount during the one-frame mask window pops the in-flight mask.
    cleanup();
    expect(c?.inert).toBe(false);
  });
});

describe('VirtualList — scroll requests', () => {
  /** A scroll-recording double: the landed indexes, in order. */
  function scrollProbe(
    items: VirtualItem[],
    totalSize: number
  ): {
    factory: VirtualizerFactory;
    landed: number[];
  } {
    const landed: number[] = [];
    const factory: VirtualizerFactory = () => ({
      getVirtualItems: () => items,
      getTotalSize: () => totalSize,
      measureElement: () => {},
      scrollToIndex: (index: number): void => {
        landed.push(index);
      }
    });
    return { factory, landed };
  }

  it('lands a request when it changes; the mount request and retentions never scroll', () => {
    const p = scrollProbe([row(9, 360, 40)], 800);
    const [target, setTarget] = createSignal<VirtualScrollRequest | null>({ index: 9 });
    render(() => (
      <VirtualList
        count={20}
        estimateSize={() => 40}
        createVirtualizer={p.factory}
        scrollTo={target}
      >
        {(item) => <span data-fdt-row={String(item.index)}>row {String(item.index)}</span>}
      </VirtualList>
    ));
    // A request held at mount is not a scroll order (the in-page find only
    // ever follows its own events; the consumer's defer decides).
    expect(p.landed).toEqual([]);

    setTarget({ index: 3 });
    expect(p.landed).toEqual([3]);
    // The request object is the event: a retained identity (the same object
    // flowing from a memo without a find event) re-fires nothing.
    // eslint-disable-next-line solid/reactivity -- the test reads the request at rest to re-send the very same object
    const held = target();
    setTarget(held);
    expect(p.landed).toEqual([3]);
    // A fresh object is a new event even at the same row index (a new
    // query's first match lands exactly the same row again).
    setTarget({ index: 3 });
    expect(p.landed).toEqual([3, 3]);

    setTarget(null);
    expect(p.landed).toEqual([3, 3]);
  });

  it('tolerates a double without the optional scroll seam when a request changes', () => {
    const p = probe([row(0, 0, 40)], 40); // the plain double omits scrollToIndex
    const [target, setTarget] = createSignal<VirtualScrollRequest | null>(null);
    render(() => (
      <VirtualList
        count={2}
        estimateSize={() => 40}
        createVirtualizer={p.factory}
        scrollTo={target}
      >
        {(item) => <span data-fdt-row={String(item.index)}>row {String(item.index)}</span>}
      </VirtualList>
    ));
    expect(() => setTarget({ index: 1 })).not.toThrow();
    expect(document.querySelector('[data-fdt-row="0"]')).not.toBeNull();
  });
});
