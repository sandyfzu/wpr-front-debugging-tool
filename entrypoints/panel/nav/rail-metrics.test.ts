/**
 * The measure seam's tests, over synthetic element graphs (the real
 * happy-dom/Chromium geometry is the browser tier's job): every stub row's
 * rectangle is reported rail-relative, the measurements are validated — a
 * missing stub, a degenerate box, or a non-finite value answers "not
 * measurable" so the caller keeps its previous slice instead of acting on
 * noise — and the registry order of the DOM flows through unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { NAV_MIRROR_ROW_ATTR, realRailMeasure, realRailWatch } from './rail-metrics';
import { visibleRowsInRail } from './visible-rows';

/** A stub row element: the attribute + rectangle the seam reads. */
interface StubRow {
  readonly route: string;
  readonly top: number;
  readonly height: number;
  readonly left: number;
}

/** An element-graph node: its rectangle plus its stub-row children, in DOM order. */
interface FakeElement {
  getBoundingClientRect(): { top: number; height: number; left: number; bottom: number };
  clientHeight: number;
  querySelectorAll(selector: string): ArrayLike<StubLike>;
}

interface StubLike {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { top: number; height: number };
}

/** Build a rail graph: root box at railTop with rows laid out from its content top. The stub rows are built once, so a test can mutate one to simulate a broken read. */
function makeRail(options: {
  railTop: number;
  railHeight: number;
  clientHeight: number;
  rows: readonly StubRow[];
}): FakeElement {
  // Built once per makeRail call: a mutation on a returned stub (a test
  // forcing a broken attribute) is observably part of "the same DOM".
  const stubs: StubLike[] = options.rows.map((row) => ({
    getAttribute: (name: string) => (name === NAV_MIRROR_ROW_ATTR ? row.route : null),
    getBoundingClientRect: () => ({ top: row.top, height: row.height })
  }));
  const root = {
    clientHeight: options.clientHeight,
    getBoundingClientRect: () => ({
      top: options.railTop,
      height: options.railHeight,
      left: 8,
      bottom: options.railTop + options.railHeight
    }),
    // The stub rows in DOM order, each carrying its own rectangle.
    querySelectorAll: (selector: string): ArrayLike<StubLike> =>
      selector === `[${NAV_MIRROR_ROW_ATTR}]` ? stubs : []
  };
  return root;
}

describe('realRailMeasure', () => {
  it('reports the rail’s boxes relative to the rail and its content height', () => {
    const rail = makeRail({
      railTop: 120.25,
      railHeight: 150,
      clientHeight: 150,
      rows: [
        { route: 'detections', left: 0, top: 120.25, height: 32 },
        { route: 'javascript', left: 0, top: 159.25, height: 32 }
      ]
    });
    expect(realRailMeasure(rail as unknown as HTMLElement)).toEqual({
      availableHeight: 150,
      rows: [
        { route: 'detections', top: 0, height: 32 },
        { route: 'javascript', top: 39, height: 32 }
      ]
    });
  });

  it('preserves the DOM’s registry order (the stub renders in registry order)', () => {
    const rail = makeRail({
      railTop: 0,
      railHeight: 200,
      clientHeight: 200,
      rows: [
        { route: 'detections', left: 0, top: 0, height: 32 },
        { route: 'lazyload', left: 0, top: 75, height: 32 },
        { route: 'undefined-references', left: 0, top: 186, height: 32 }
      ]
    });
    const measured = realRailMeasure(rail as unknown as HTMLElement);
    expect(measured?.rows.map((row) => row.route)).toEqual([
      'detections',
      'lazyload',
      'undefined-references'
    ]);
  });

  it('answers null for a missing stub (nothing to measure)', () => {
    const rail = makeRail({ railTop: 0, railHeight: 200, clientHeight: 200, rows: [] });
    expect(realRailMeasure(rail as unknown as HTMLElement)).toBeNull();
  });

  it('answers null for a degenerate rail box (a real zero-height rail tells the truth)', () => {
    const rail = makeRail({
      railTop: 0,
      railHeight: 0,
      clientHeight: 0,
      rows: [{ route: 'detections', left: 0, top: 0, height: 32 }]
    });
    expect(realRailMeasure(rail as unknown as HTMLElement)).toBeNull();
  });

  it('answers null when a non-finite value slips into a rect (a broken read is noise)', () => {
    const rail = makeRail({
      railTop: 0,
      railHeight: 200,
      clientHeight: Number.NaN,
      rows: [{ route: 'detections', left: 0, top: 0, height: 32 }]
    });
    expect(realRailMeasure(rail as unknown as HTMLElement)).toBeNull();
    const brokenRect = makeRail({
      railTop: 0,
      railHeight: 200,
      clientHeight: 200,
      rows: [{ route: 'detections', left: 0, top: Number.NaN, height: 32 }]
    });
    expect(realRailMeasure(brokenRect as unknown as HTMLElement)).toBeNull();
  });

  it('answers null when a stub row loses its route attribute', () => {
    const rail = makeRail({
      railTop: 0,
      railHeight: 200,
      clientHeight: 200,
      rows: [{ route: 'detections', left: 0, top: 0, height: 32 }]
    });
    const first = rail.querySelectorAll(`[${NAV_MIRROR_ROW_ATTR}]`)[0];
    // Force the attribute empty: the seam refuses rather than inventing a row.
    Object.defineProperty(first, 'getAttribute', { value: () => null });
    expect(realRailMeasure(rail as unknown as HTMLElement)).toBeNull();
  });

  it('feeds the computation end-to-end: synthetic geometry → real partition', () => {
    const rail = makeRail({
      railTop: 0,
      railHeight: 100,
      clientHeight: 100,
      rows: [
        { route: 'detections', left: 0, top: 0, height: 32 },
        { route: 'javascript', left: 0, top: 39, height: 32 },
        { route: 'lazyload', left: 0, top: 75, height: 32 }
      ]
    });
    const measured = realRailMeasure(rail as unknown as HTMLElement);
    const overflow = measured && visibleRowsInRail(measured.rows, measured.availableHeight);
    expect(overflow?.visible.map((row) => row.route)).toEqual(['detections', 'javascript']);
    expect(overflow?.hidden.map((row) => row.route)).toEqual(['lazyload']);
  });
});

describe('realRailWatch', () => {
  it('only re-fires the callback through the observer and stops idempotently', () => {
    type Observed = { element: Element; callback: ResizeObserverCallback };
    const disconnect = vi.fn();
    const observed: Observed = { element: {} as Element, callback: () => undefined };
    const ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        observed.callback = callback;
      }
      observe(element: Element): void {
        observed.element = element;
      }
      disconnect(): void {
        disconnect();
      }
    };
    vi.stubGlobal('ResizeObserver', ResizeObserver);
    try {
      const rail = document.createElement('div');
      const onResize = vi.fn();
      const stop = realRailWatch(rail, onResize);
      expect(observed.element).toBe(rail);
      // A ResizeObserver notification re-runs the caller's measurement.
      observed.callback([], { disconnect: vi.fn() } as unknown as ResizeObserver);
      expect(onResize).toHaveBeenCalledTimes(1);
      stop();
      stop();
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('degrades to a no-op watch when ResizeObserver is missing (layout-less envs)', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    try {
      const rail = document.createElement('div');
      const onResize = vi.fn();
      const stop = realRailWatch(rail, onResize);
      expect(stop).toBeTypeOf('function');
      stop();
      expect(onResize).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
