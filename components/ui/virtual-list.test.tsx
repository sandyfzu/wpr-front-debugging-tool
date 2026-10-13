/**
 * Contract tests for the virtual list wrapper: rendered geometry against an
 * injected virtualizer double (serving fixed virtual items), because
 * happy-dom has no layout engine — the wrapper's *contract* (spacer height,
 * absolute translate rows, `data-index` + measurement wiring, overscan and
 * options pass-through) is what needs pinning, not TanStack's internals.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
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
function row(index: number, start: number, size: number): VirtualItem {
  return { key: `key-${String(index)}`, index, start, end: start + size, size, lane: 0 };
}

interface FactoryProbe {
  /** The factory to pass as the `createVirtualizer` seam. */
  factory: VirtualizerFactory;
  /** The last options object the factory received. */
  options: VirtualListOptions | undefined;
  /** The elements bound through measureElement (the ref wiring), in order. */
  measured: Array<HTMLElement | null>;
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
    measured: []
  };
  state.factory = (options: VirtualListOptions): VirtualizerInstanceProbe => {
    state.options = options;
    return {
      getVirtualItems: () => items,
      getTotalSize: () => totalSize,
      measureElement: (node: HTMLElement | null) => {
        state.measured.push(node);
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
    expect((rows[1] as HTMLElement).style.height).toBe('60px');
    expect((rows[1] as HTMLElement).style.position).toBe('absolute');
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
