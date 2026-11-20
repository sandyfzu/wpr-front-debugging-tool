/**
 * The default factory's wiring: `VirtualList` without a factory seam hands
 * TanStack's core the shrink-deferred scroller watch (`frameDeferredRect`
 * over the library's own watch), never the core's default — that default
 * re-windows rows inside its resize callback, Chromium's "ResizeObserver
 * loop" page error on short panels. Its own file: the library is mocked.
 */
import { cleanup, render } from '@solidjs/testing-library';
import type * as SolidVirtual from '@tanstack/solid-virtual';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from './virtual-list';

/** What the mocked library recorded. */
const seen = vi.hoisted(() => ({
  options: [] as object[],
  /** The core instances the library built (its live `options` included). */
  instances: [] as { options: { count: number; overscan: number } }[],
  emit: undefined as ((rect: { width: number; height: number }) => void) | undefined
}));

vi.mock('@tanstack/solid-virtual', async (importOriginal) => {
  const actual = await importOriginal<typeof SolidVirtual>();
  return {
    ...actual,
    // The library's watch, as a double: a 300 × 300 scroller at attach, then what the test emits.
    observeElementRect: (
      _instance: unknown,
      report: (rect: { width: number; height: number }) => void
    ) => {
      seen.emit = report;
      report({ width: 300, height: 300 });
      return () => undefined;
    },
    createVirtualizer: (options: Parameters<typeof actual.createVirtualizer>[0]) => {
      seen.options.push(options);
      const instance = actual.createVirtualizer(options);
      seen.instances.push(instance);
      return instance;
    }
  };
});

afterEach(() => {
  cleanup();
  seen.options.length = 0;
  seen.instances.length = 0;
  seen.emit = undefined;
});

describe('VirtualList default factory', () => {
  it('watches the scroller through the shrink-deferred wrapper of the library watch', () => {
    render(() => (
      <VirtualList count={3} estimateSize={() => 24}>
        {(row) => <span>{row.index}</span>}
      </VirtualList>
    ));
    expect(seen.options).toHaveLength(1);
    const watch: unknown = Reflect.get(seen.options[0] ?? {}, 'observeElementRect');
    if (typeof watch !== 'function') throw new Error('no observeElementRect passed to the core');
    const report = vi.fn();
    const frames = vi.spyOn(globalThis, 'requestAnimationFrame');
    try {
      (watch as (instance: object, cb: typeof report) => unknown)({}, report);
      // Attach passes through, growth too; a shrink waits for a frame.
      expect(report).toHaveBeenLastCalledWith({ width: 300, height: 300 });
      seen.emit?.({ width: 300, height: 500 });
      expect(report).toHaveBeenLastCalledWith({ width: 300, height: 500 });
      seen.emit?.({ width: 300, height: 200 });
      expect(report).toHaveBeenCalledTimes(2);
      expect(frames).toHaveBeenCalled();
    } finally {
      frames.mockRestore();
    }
  });

  it('keeps the options reactive: a later count or overscan reaches the core instance', () => {
    const [count, setCount] = createSignal(3);
    const [overscan, setOverscan] = createSignal(2);
    render(() => (
      <VirtualList count={count()} overscan={overscan()} estimateSize={() => 24}>
        {(row) => <span>{row.index}</span>}
      </VirtualList>
    ));
    const instance = seen.instances[0];
    if (instance === undefined) throw new Error('no core instance built');
    expect([instance.options.count, instance.options.overscan]).toEqual([3, 2]);
    // A snapshot of the options (an object spread) would keep 3 and 2 here.
    setCount(40);
    setOverscan(7);
    expect([instance.options.count, instance.options.overscan]).toEqual([40, 7]);
    expect(seen.instances).toHaveLength(1);
  });
});
