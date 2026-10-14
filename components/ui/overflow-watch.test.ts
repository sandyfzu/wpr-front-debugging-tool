/**
 * Unit tests for the overflow watcher: the measurement rule, the shared
 * observer (one per watcher, both elements of a region observed), change-only
 * reporting, per-region dispatch and full teardown. A manual observer double
 * stands in for `ResizeObserver` (happy-dom has no layout).
 */
import { describe, expect, it } from 'vitest';
import {
  createOverflowWatcher,
  isOverflowing,
  watchOverflow,
  type ResizeObserverFactory
} from './overflow-watch';

/** An element whose scroll/client sizes are pinned (happy-dom lays nothing out). */
function sized(size: {
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
}): HTMLElement {
  const element = document.createElement('div');
  for (const [key, value] of Object.entries({
    scrollWidth: 100,
    clientWidth: 100,
    scrollHeight: 20,
    clientHeight: 20,
    ...size
  })) {
    Object.defineProperty(element, key, { configurable: true, get: () => value });
  }
  return element;
}

/** A manual `ResizeObserver` double: counts instances, tracks targets, delivers on demand. */
function manualObservers(): {
  factory: ResizeObserverFactory;
  created: () => number;
  observed: () => Element[];
  deliver: (...targets: Element[]) => void;
} {
  let created = 0;
  const observed = new Set<Element>();
  let callback: Parameters<ResizeObserverFactory>[0] = () => undefined;
  return {
    factory: (onEntries) => {
      created += 1;
      callback = onEntries;
      return {
        observe: (target) => observed.add(target),
        unobserve: (target) => observed.delete(target)
      };
    },
    created: () => created,
    observed: () => [...observed],
    deliver: (...targets) => {
      // Delivered as given (even unobserved targets): the watcher's own
      // bookkeeping, not the double, must drop stopped regions.
      callback(targets.map((target) => ({ target })));
    }
  };
}

describe('isOverflowing', () => {
  it('is true when content exceeds the box on either axis, false when it fits', () => {
    expect(isOverflowing(sized({}))).toBe(false);
    expect(isOverflowing(sized({ scrollWidth: 101 }))).toBe(true);
    expect(isOverflowing(sized({ scrollHeight: 21 }))).toBe(true);
  });
});

describe('createOverflowWatcher', () => {
  it('shares one observer across regions, created lazily on first watch', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    expect(observers.created()).toBe(0);
    watch(sized({}), sized({}), () => undefined);
    watch(sized({}), sized({}), () => undefined);
    expect(observers.created()).toBe(1);
    expect(observers.observed()).toHaveLength(4);
  });

  it('reports the initial state and then only changes, measured on the scroller', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    let width = 100;
    const scroller = sized({});
    Object.defineProperty(scroller, 'scrollWidth', { get: () => width });
    const content = sized({});
    const reports: boolean[] = [];
    watch(scroller, content, (overflowing) => reports.push(overflowing));
    observers.deliver(scroller, content); // the observer's initial notification
    expect(reports).toEqual([false]);
    observers.deliver(content); // same state: no report
    expect(reports).toEqual([false]);
    width = 300; // content grew past the box
    observers.deliver(content);
    expect(reports).toEqual([false, true]);
    width = 50;
    observers.deliver(scroller);
    expect(reports).toEqual([false, true, false]);
  });

  it('measures each region once per delivery and only the regions notified', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const first = { scroller: sized({ scrollWidth: 200 }), content: sized({}) };
    const second = { scroller: sized({}), content: sized({}) };
    const firstReports: boolean[] = [];
    const secondReports: boolean[] = [];
    watch(first.scroller, first.content, (value) => firstReports.push(value));
    watch(second.scroller, second.content, (value) => secondReports.push(value));
    observers.deliver(first.scroller, first.content);
    expect(firstReports).toEqual([true]);
    expect(secondReports).toEqual([]);
  });

  it('stops: unobserves both elements and ignores later deliveries', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const scroller = sized({ scrollWidth: 200 });
    const content = sized({});
    const reports: boolean[] = [];
    const stop = watch(scroller, content, (value) => reports.push(value));
    stop();
    expect(observers.observed()).toEqual([]);
    observers.deliver(scroller, content);
    expect(reports).toEqual([]);
  });
});

describe('watchOverflow (process-wide)', () => {
  it('watches with the real ResizeObserver and stops cleanly', () => {
    const stop = watchOverflow(sized({}), sized({}), () => undefined);
    expect(typeof stop).toBe('function');
    stop();
  });
});
