/**
 * Contract tests for the virtual list wrapper: rendered geometry against an
 * injected virtualizer double (serving fixed virtual items), because
 * happy-dom has no layout engine — the wrapper's *contract* (spacer height,
 * absolute translate rows, `data-index` + measurement wiring, overscan and
 * options pass-through) is what needs pinning, not TanStack's internals.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { afterEach, describe, expect, it } from 'vitest';
import {
  VirtualList,
  type VirtualItem,
  type VirtualizerFactory,
  type VirtualListOptions
} from './virtual-list';

afterEach(() => {
  cleanup();
});

/** The probe's instance double shape (the declared surface for test doubles). */
interface VirtualizerInstanceProbe {
  /** The rows `getVirtualItems` returns. */
  getVirtualItems: () => VirtualItem[];
  /** The height `getTotalSize` reports (px). */
  getTotalSize: () => number;
  /** The measurement binding the wrapper hands row elements into. */
  measureElement: (node: HTMLElement | null) => void;
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
});
