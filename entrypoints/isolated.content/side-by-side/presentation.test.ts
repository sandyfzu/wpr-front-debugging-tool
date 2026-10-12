/**
 * The presentation seam: the inline style records' exact shapes per
 * presentation (phone, desktop, fluid), the first-navigation gate, the
 * flavored measure dispatch, and the rescale controller's lifecycle —
 * measure once at sync, live on resize, clean teardown, and the explicit
 * degrade when the engine has no ResizeObserver.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import { DESKTOP_WIDTH_FLOOR } from '../../../lib/side-by-side/desktop-fit';
import type { Logger } from '../../../lib/logger';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import {
  createFramePresenter,
  framesMayNavigate,
  measureColumnFit,
  measureColumnScale,
  frameStylesFor,
  type FrameFit,
  type FrameFitRecord
} from './presentation';

const VW = DEVICE_SIMULATION_PROFILE.viewport.width;
const VH = DEVICE_SIMULATION_PROFILE.viewport.height;

const logDebug = vi.fn();
const logError = vi.fn();
const log: Logger = { debug: logDebug, info: vi.fn(), warn: vi.fn(), error: logError };

/** A phone fit for a column of the given size (the natural, uncapped scale), already flavored. */
function phoneFitFor(columnWidth: number, columnHeight: number): FrameFit {
  const scale = Math.min(columnWidth / VW, columnHeight / VH, 2);
  return { kind: 'phone', scale, boxWidth: VW * scale, boxHeight: VH * scale };
}

/** A desktop fit for a column of the given size, already flavored. */
function desktopFitFor(columnWidth: number, columnHeight: number): FrameFit {
  const measured = measureColumnFit(columnWith(columnWidth, columnHeight), 'desktop');
  expect(measured).not.toBeNull();
  if (measured === null) throw new Error('desktopFit reported no fit for a real column');
  expect(measured.kind, 'the desktop presentation measures the desktop math').toBe('desktop');
  if (measured.kind !== 'desktop') throw new Error('unreachable: the kind is pinned above');
  return measured;
}

/** A half's column element with addressable layout numbers. */
function columnWith(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

describe('frameStylesFor', () => {
  it('defers to the stylesheet in the fluid dress, and to it while a fit is missing', () => {
    const fit = phoneFitFor(800, 1200);
    expect(frameStylesFor('auto', fit)).toEqual({ viewport: {}, frame: {} });
    expect(frameStylesFor('phone', null)).toEqual({ viewport: {}, frame: {} });
  });

  it('a fit of a foreign flavor renders nothing inline (the re-measure converges the pair)', () => {
    // The transient between a presentation change and its re-measure: the
    // dress must never style a frame with the other dress's numbers.
    expect(frameStylesFor('phone', desktopFitFor(600, 400))).toEqual({
      viewport: {},
      frame: {}
    });
    expect(frameStylesFor('desktop', phoneFitFor(600, 400))).toEqual({
      viewport: {},
      frame: {}
    });
    expect(frameStylesFor('auto', desktopFitFor(600, 400))).toEqual({
      viewport: {},
      frame: {}
    });
  });

  it('sizes the phone wrapper to the fitted box and transforms the frame at the top-left origin', () => {
    const styles = frameStylesFor('phone', {
      kind: 'phone',
      scale: 0.5,
      boxWidth: VW * 0.5,
      boxHeight: VH * 0.5
    });
    expect(styles.viewport).toEqual({
      width: `${String(VW * 0.5)}px`,
      height: `${String(VH * 0.5)}px`
    });
    expect(styles.frame).toEqual({
      width: `${String(VW)}px`,
      height: `${String(VH)}px`,
      flex: '0 0 auto',
      transform: 'scale(0.5)',
      'transform-origin': '0 0'
    });
  });

  it('grows the phone wrapper with the scale up to the capped fit', () => {
    const styles = frameStylesFor('phone', {
      kind: 'phone',
      scale: 2,
      boxWidth: VW * 2,
      boxHeight: VH * 2
    });
    expect(styles.viewport['width']).toBe(`${String(VW * 2)}px`);
    expect(styles.frame['transform']).toBe('scale(2)');
  });

  it('the desktop dress styles the column as the wrapper and a desktop-width frame in it', () => {
    const styles = frameStylesFor('desktop', desktopFitFor(800, 600));
    // The wrapper is exactly the column (layout untouched); the frame's own
    // box is the floor width and the proportionally taller height.
    expect(styles.viewport).toEqual({
      width: '800px',
      height: '600px',
      overflow: 'hidden'
    });
    expect(styles.frame).toEqual({
      width: `${String(DESKTOP_WIDTH_FLOOR)}px`,
      height: String(600 / (800 / DESKTOP_WIDTH_FLOOR)) + 'px',
      flex: '0 0 auto',
      transform: `scale(${String(800 / DESKTOP_WIDTH_FLOOR)})`,
      'transform-origin': '0 0'
    });
  });

  it('the desktop dress at or above the floor is the natural full-width box, inert at scale(1)', () => {
    const styles = frameStylesFor('desktop', desktopFitFor(1600, 900));
    expect(styles.viewport['width']).toBe('1600px');
    expect(styles.frame['transform']).toBe('scale(1)');
    expect(styles.frame['width']).toBe('1600px');
  });
});

describe('framesMayNavigate', () => {
  it('navigates immediately in the fluid dress and holds until both fits exist in a dressed one', () => {
    expect(framesMayNavigate('auto', {})).toBe(true);
    expect(framesMayNavigate('phone', {})).toBe(false);
    expect(framesMayNavigate('desktop', {})).toBe(false);
    expect(framesMayNavigate('phone', { cached: null, bypassed: null })).toBe(false);
    expect(
      framesMayNavigate('phone', { cached: phoneFitFor(600, 900), bypassed: phoneFitFor(600, 900) })
    ).toBe(true);
    // One half measured, one not: the gate stays closed (both halves load at the same truth).
    expect(framesMayNavigate('phone', { cached: phoneFitFor(600, 900) })).toBe(false);
    expect(
      framesMayNavigate('desktop', {
        cached: desktopFitFor(600, 900),
        bypassed: desktopFitFor(600, 900)
      })
    ).toBe(true);
    // A match matters as the enforced contract: a foreign flavor's fit keeps
    // the gate closed (the gate is kind-aware — the styles' dispatch and the
    // measure oracle keep the flavors coherent; the gate enforces it too).
    expect(
      framesMayNavigate('desktop', {
        cached: phoneFitFor(600, 900),
        bypassed: phoneFitFor(600, 900)
      })
    ).toBe(false);
  });
});

describe('measure dispatch', () => {
  it('measureColumnScale feeds the layout box (clientWidth/Height) into the shared fit math', () => {
    expect(measureColumnScale(columnWith(824, 1784))).toEqual(
      (() => {
        const scale = Math.min(824 / VW, 1784 / VH, 2);
        return { scale, boxWidth: VW * scale, boxHeight: VH * scale };
      })()
    );
  });

  it('measureColumnFit flavors the phone math and the desktop math per presentation', () => {
    expect(measureColumnFit(columnWith(824, 1784), 'phone')).toEqual({
      kind: 'phone',
      scale: Math.min(824 / VW, 1784 / VH, 2),
      boxWidth: VW * Math.min(824 / VW, 1784 / VH, 2),
      boxHeight: VH * Math.min(824 / VW, 1784 / VH, 2)
    });
    expect(measureColumnFit(columnWith(824, 1784), 'desktop')).toEqual({
      kind: 'desktop',
      frameWidth: DESKTOP_WIDTH_FLOOR,
      frameHeight: 1784 / (824 / DESKTOP_WIDTH_FLOOR),
      scale: 824 / DESKTOP_WIDTH_FLOOR,
      boxWidth: 824,
      boxHeight: 1784
    });
    // The fluid dress measures as a phone fit (an adoption wants it instantly).
    expect(measureColumnFit(columnWith(824, 1784), 'auto')).toEqual(
      measureColumnFit(columnWith(824, 1784), 'phone')
    );
  });

  it('both measures report no fit for a spaceless column', () => {
    expect(measureColumnScale(columnWith(0, 400))).toBeNull();
    expect(measureColumnFit(columnWith(0, 400), 'desktop')).toBeNull();
    expect(measureColumnFit(columnWith(0, 400), 'phone')).toBeNull();
  });

  it('a broken layout measurement throws (the presenter contains it per side)', () => {
    expect(() => measureColumnScale(columnWith(-1, 400))).toThrow(/real column size/);
    expect(() => measureColumnFit(columnWith(-1, 400), 'desktop')).toThrow(/real column size/);
  });
});

describe('createFramePresenter', () => {
  /** Stand a presenter over a traced ('live') or degrading ('degrade') rescale factory. */
  function setup(deps: { mode: 'live' | 'degrade'; presentation?: () => 'phone' | 'desktop' }): {
    columns: Partial<Record<CompareSide, HTMLElement>>;
    recorded: FrameFitRecord;
    presenter: ReturnType<typeof createFramePresenter>;
    events(): Array<() => void>;
  } {
    const columns: Partial<Record<CompareSide, HTMLElement>> = {
      cached: columnWith(700, 900),
      bypassed: columnWith(320, 1600)
    };
    const recorded: FrameFitRecord = {};
    const events: Array<() => void> = [];
    const presented = (): 'phone' | 'desktop' => deps.presentation?.() ?? 'phone';
    const presenter = createFramePresenter({
      presentation: presented,
      columns: () => columns,
      measure: (column) => measureColumnFit(column, presented()),
      onFit: (side, fit) => {
        recorded[side] = fit;
      },
      rescaleFactory:
        deps.mode === 'live'
          ? (onFrameRescale) => {
              events.push(onFrameRescale);
              return { observe: () => undefined, disconnect: () => undefined };
            }
          : () => null,
      log
    });
    return { columns, recorded, presenter, events: () => events };
  }

  it('sync reports both halves through the shared fit measure, flavored as the presentation', () => {
    const fx = setup({ mode: 'degrade' });
    fx.presenter.syncNow();
    expect(fx.recorded['cached']?.kind).toBe('phone');
    expect(fx.recorded['cached']?.scale).toBeCloseTo(Math.min(700 / VW, 900 / VH, 2));
    expect(fx.recorded['bypassed']?.scale).toBeCloseTo(Math.min(320 / VW, 1600 / VH, 2));
  });

  it('the desktop presentation measures the desktop math', () => {
    const fx = setup({ mode: 'degrade', presentation: () => 'desktop' });
    fx.presenter.syncNow();
    expect(fx.recorded['cached']?.kind).toBe('desktop');
    expect(fx.recorded['cached']?.scale).toBeCloseTo(700 / DESKTOP_WIDTH_FLOOR);
    expect(fx.recorded['bypassed']?.scale).toBeCloseTo(320 / DESKTOP_WIDTH_FLOOR);
  });

  it('a missing column is a lifecycle transient: the next sync picks its registration up', () => {
    const registered: Partial<Record<CompareSide, HTMLElement>> = { cached: columnWith(700, 900) };
    const recorded: FrameFitRecord = {};
    const presenter = createFramePresenter({
      presentation: () => 'auto',
      columns: () => registered,
      measure: (column) => measureColumnFit(column, 'auto'),
      onFit: (side, fit) => {
        recorded[side] = fit;
      },
      rescaleFactory: () => null,
      log
    });
    presenter.syncNow();
    expect(recorded['cached']).toBeDefined();
    expect(recorded['bypassed']).toBeUndefined();
    registered['bypassed'] = columnWith(320, 1600);
    presenter.syncNow();
    expect(recorded['bypassed']?.scale).toBeCloseTo(Math.min(320 / VW, 1600 / VH, 2));
  });

  it('the rescale fires a re-measure of its side only', () => {
    const fx = setup({ mode: 'live' });
    fx.presenter.syncNow();
    expect(fx.recorded['cached']?.scale).toBeCloseTo(Math.min(700 / VW, 900 / VH, 2));
    expect(fx.recorded['bypassed']?.scale).toBeCloseTo(Math.min(320 / VW, 1600 / VH, 2));
    // The window shrank under the cached half only: its observer's entry re-measures that side.
    fx.columns['cached'] = columnWith(240, 900);
    fx.events()[0]?.();
    expect(fx.recorded['cached']?.scale).toBeCloseTo(Math.min(240 / VW, 900 / VH, 2));
    expect(fx.recorded['bypassed']?.scale).toBeCloseTo(Math.min(320 / VW, 1600 / VH, 2));
  });

  it('a broken measurement is contained: one error line, the healthy half still reports', () => {
    const broken = columnWith(-1, 900);
    const onFit = vi.fn();
    const presenter = createFramePresenter({
      presentation: () => 'auto',
      columns: () => ({ cached: broken, bypassed: columnWith(400, 900) }),
      measure: (column) => measureColumnFit(column, 'auto'),
      onFit,
      rescaleFactory: () => null,
      log
    });
    presenter.syncNow();
    expect(logError).toHaveBeenCalledWith(
      "The cached half's fit measurement failed",
      expect.anything()
    );
    expect(logError).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledTimes(1); // only the healthy bypassed half
    expect(onFit.mock.calls[0]?.[0]).toBe('bypassed');
  });

  it('arms one rescaler per side across syncs, disconnects both at stop, re-arms on the next sync', () => {
    let rescalers = 0;
    const disconnectIds: number[] = [];
    const presenter = createFramePresenter({
      presentation: () => 'auto',
      columns: () => ({ cached: columnWith(700, 900), bypassed: columnWith(320, 1600) }),
      measure: (column) => measureColumnFit(column, 'auto'),
      onFit: vi.fn(),
      rescaleFactory: () => {
        rescalers += 1;
        return {
          observe: () => undefined,
          disconnect: () => {
            disconnectIds.push(rescalers);
          }
        };
      },
      log
    });
    presenter.syncNow();
    expect(rescalers).toBe(2);
    presenter.syncNow(); // idempotent: the armed rescalers re-observe, none re-created
    expect(rescalers).toBe(2);
    presenter.stop();
    expect(disconnectIds).toEqual([2, 2]);
    presenter.syncNow(); // the next open re-arms fresh
    expect(rescalers).toBe(4);
  });

  it('a null rescale keeps the fits reporting with no live updates and no error', () => {
    const fx = setup({ mode: 'degrade' });
    fx.presenter.syncNow();
    fx.presenter.syncNow(); // measured again, no rescale armed, no error
    fx.presenter.stop();
    expect(fx.recorded['cached']).toBeDefined();
    expect(logError).not.toHaveBeenCalled();
  });
});
