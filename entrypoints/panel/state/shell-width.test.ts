/** The shell width signal: observer wiring, sanitizing, re-attach and owner cleanup. */
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createShellWidth,
  observeInlineSize,
  sanitizeWidth,
  type InlineSizeObserver
} from './shell-width';

/** A controllable observer double: records attaches and stops, pushes widths by hand. */
function fakeObserver(): {
  observe: InlineSizeObserver;
  push: (width: number) => void;
  attached: HTMLElement[];
  stops: number;
} {
  const state = {
    attached: [] as HTMLElement[],
    stops: 0,
    listener: undefined as ((width: number) => void) | undefined
  };
  return {
    observe: (element, onWidth) => {
      state.attached.push(element);
      state.listener = onWidth;
      return () => {
        state.stops += 1;
      };
    },
    push: (width) => {
      state.listener?.(width);
    },
    get attached() {
      return state.attached;
    },
    get stops() {
      return state.stops;
    }
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitizeWidth', () => {
  it.each([
    [0, 0],
    [320, 320],
    [759.5, 759.5],
    [-1, 0],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [Number.NEGATIVE_INFINITY, 0]
  ])('%d → %d', (input, output) => {
    expect(sanitizeWidth(input)).toBe(output);
  });
});

describe('createShellWidth', () => {
  it('reads 0 until the first observation, then follows every report', () => {
    const fake = fakeObserver();
    createRoot((dispose) => {
      const shell = createShellWidth(fake.observe);
      expect(shell.width()).toBe(0);
      const element = document.createElement('div');
      shell.attach(element);
      expect(fake.attached).toEqual([element]);
      fake.push(1100);
      expect(shell.width()).toBe(1100);
      fake.push(759.5);
      expect(shell.width()).toBe(759.5);
      fake.push(Number.NaN);
      expect(shell.width()).toBe(0);
      dispose();
    });
  });

  it('moves the observation on re-attach and stops with its owner', () => {
    const fake = fakeObserver();
    createRoot((dispose) => {
      const shell = createShellWidth(fake.observe);
      shell.attach(document.createElement('div'));
      shell.attach(document.createElement('div'));
      expect(fake.attached).toHaveLength(2);
      expect(fake.stops).toBe(1);
      dispose();
      expect(fake.stops).toBe(2);
    });
  });

  it('stops nothing when it never attached', () => {
    const fake = fakeObserver();
    createRoot((dispose) => {
      createShellWidth(fake.observe);
      dispose();
    });
    expect(fake.stops).toBe(0);
  });
});

describe('observeInlineSize', () => {
  it('reports the last entry width and disconnects on stop', () => {
    const disconnect = vi.fn();
    const observed: Element[] = [];
    let callback: ((entries: Array<{ contentRect: { width: number } }>) => void) | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: typeof callback) {
          callback = cb;
        }
        observe(element: Element): void {
          observed.push(element);
        }
        disconnect(): void {
          disconnect();
        }
      }
    );
    const element = document.createElement('div');
    const widths: number[] = [];
    const stop = observeInlineSize(element, (width) => widths.push(width));
    expect(observed).toEqual([element]);
    callback?.([{ contentRect: { width: 400 } }, { contentRect: { width: 800 } }]);
    callback?.([]);
    expect(widths).toEqual([800]);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('degrades to no reports (and a no-op stop) without the API', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const widths: number[] = [];
    const stop = observeInlineSize(document.createElement('div'), (width) => widths.push(width));
    expect(() => {
      stop();
    }).not.toThrow();
    expect(widths).toEqual([]);
  });
});
