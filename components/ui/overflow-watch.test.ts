/**
 * Unit tests for the overflow watcher: the measurement rule, the shared
 * observer (one per watcher, both elements of a region observed), change-only
 * reporting, per-region dispatch and full teardown. A manual observer double
 * stands in for `ResizeObserver` (happy-dom has no layout).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  createOverflowWatcher,
  isClippedVertically,
  isOverflowing,
  watchOverflow,
  type ResizeObserverFactory
} from './overflow-watch';

/**
 * An element whose scroll/client sizes are pinned (happy-dom lays nothing
 * out), scrollable on both axes unless `overflow` says otherwise.
 */
function sized(
  size: {
    scrollWidth?: number;
    clientWidth?: number;
    scrollHeight?: number;
    clientHeight?: number;
  },
  overflow = 'auto'
): HTMLElement {
  const element = document.createElement('div');
  // Longhands: the watcher reads them, and happy-dom does not expand the shorthand.
  element.style.overflowX = overflow;
  element.style.overflowY = overflow;
  // Attached, so the computed style resolves.
  document.body.append(element);
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

afterEach(() => {
  document.body.replaceChildren();
});

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

  it('ignores clipping axes: hidden or clipped content cannot be scrolled to', () => {
    expect(isOverflowing(sized({ scrollWidth: 300, scrollHeight: 300 }, 'hidden'))).toBe(false);
    expect(isOverflowing(sized({ scrollWidth: 300 }, 'clip'))).toBe(false);
    expect(isOverflowing(sized({ scrollWidth: 300 }, 'visible'))).toBe(false);
    expect(isOverflowing(sized({ scrollWidth: 300 }, 'scroll'))).toBe(true);
    // Per axis: a clamped preview (y hidden) still scrolls sideways.
    const clamped = sized({ scrollWidth: 300, scrollHeight: 300 });
    clamped.style.overflowY = 'hidden';
    expect(isOverflowing(clamped)).toBe(true);
    clamped.style.overflowX = 'hidden';
    expect(isOverflowing(clamped)).toBe(false);
  });
});

describe('isClippedVertically', () => {
  it('is true only when the content box is taller than the clamp', () => {
    const content = (height: number): HTMLElement => {
      const element = document.createElement('div');
      Object.defineProperty(element, 'offsetHeight', { get: () => height });
      return element;
    };
    // Overflow style does not matter: the question is "is anything cut off".
    const clamp = sized({ clientHeight: 70 }, 'clip');
    expect(isClippedVertically(clamp, content(70))).toBe(false);
    expect(isClippedVertically(clamp, content(71))).toBe(true);
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

describe('createOverflowWatcher — shared elements and custom measures', () => {
  it('runs a custom measure against (box, content)', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const box = sized({});
    const content = sized({});
    const seen: Array<[Element, Element]> = [];
    const reports: boolean[] = [];
    watch(
      box,
      content,
      (value) => reports.push(value),
      (measuredBox, measuredContent) => {
        seen.push([measuredBox, measuredContent]);
        return true;
      }
    );
    observers.deliver(content);
    expect(seen).toEqual([[box, content]]);
    expect(reports).toEqual([true]);
  });

  it('keeps an element shared by two watches observed until both stop', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const scroller = sized({ scrollWidth: 200 });
    const clamp = sized({});
    const content = sized({});
    const scrolls: boolean[] = [];
    const clips: boolean[] = [];
    const stopScroll = watch(scroller, content, (value) => scrolls.push(value));
    const stopClip = watch(
      clamp,
      content,
      (value) => clips.push(value),
      () => true
    );
    expect(observers.observed()).toHaveLength(3);
    observers.deliver(content); // one element, both watches re-measure
    expect(scrolls).toEqual([true]);
    expect(clips).toEqual([true]);
    stopScroll();
    expect(observers.observed()).toContain(content); // the clamp watch still needs it
    expect(observers.observed()).not.toContain(scroller);
    stopClip();
    expect(observers.observed()).toEqual([]);
  });

  it('reports the initial state of a watch whose elements are all already observed', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const box = sized({ scrollWidth: 200 });
    const content = sized({});
    const first: boolean[] = [];
    watch(box, content, (value) => first.push(value));
    observers.deliver(box, content); // the fresh observes' initial notification
    expect(first).toEqual([true]);
    // Same pair again: nothing newly observed, so no notification will come;
    // the watch must report at watch time — once.
    const second: boolean[] = [];
    watch(box, content, (value) => second.push(value));
    expect(second).toEqual([true]);
    expect(first).toEqual([true]); // the first watch is not re-reported
    // Reversed pair + custom measure: also fully pre-observed.
    const third: boolean[] = [];
    const seen: Array<[Element, Element]> = [];
    watch(
      content,
      box,
      (value) => third.push(value),
      (measuredBox, measuredContent) => {
        seen.push([measuredBox, measuredContent]);
        return false;
      }
    );
    expect(third).toEqual([false]);
    expect(seen).toEqual([[content, box]]);
    expect(observers.created()).toBe(1);
  });

  it('leaves the initial report to the observer when an element is newly observed', () => {
    const observers = manualObservers();
    const watch = createOverflowWatcher(observers.factory);
    const shared = sized({});
    watch(sized({}), shared, () => undefined);
    const reports: boolean[] = [];
    const box = sized({ scrollWidth: 200 });
    watch(box, shared, (value) => reports.push(value)); // `box` is new
    expect(reports).toEqual([]); // no synchronous measure
    observers.deliver(box);
    expect(reports).toEqual([true]);
  });
});
