/**
 * The presentation seam: the inline style records' exact shapes, the
 * first-navigation gate, and the rescale controller's lifecycle — measure
 * once at sync, live on resize, clean teardown, and the explicit degrade
 * when the engine has no ResizeObserver.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import type { PhoneFrameFit } from '../../../lib/device-simulation/scale-fit';
import type { Logger } from '../../../lib/logger';
import type { CompareSide } from '../../../lib/side-by-side/scroll-sync';
import {
  createFramePresenter,
  framesMayNavigate,
  measureColumnScale,
  phoneFrameStyles,
  type FrameFitRecord
} from './presentation';

const VW = DEVICE_SIMULATION_PROFILE.viewport.width;
const VH = DEVICE_SIMULATION_PROFILE.viewport.height;

const logDebug = vi.fn();
const logError = vi.fn();
const log: Logger = { debug: logDebug, info: vi.fn(), warn: vi.fn(), error: logError };

/** A fit for a column of the given size (the natural, uncapped scale). */
function fitFor(columnWidth: number, columnHeight: number): PhoneFrameFit {
  const scale = Math.min(columnWidth / VW, columnHeight / VH, 2);
  return { scale, boxWidth: VW * scale, boxHeight: VH * scale };
}

/** A half's column element with addressable layout numbers. */
function columnWith(width: number, height: number): HTMLElement {
  return { clientWidth: width, clientHeight: height } as HTMLElement;
}

describe('phoneFrameStyles', () => {
  it('defers to the stylesheet in auto, and to the auto look while a fit is missing', () => {
    const fit = fitFor(800, 1200);
    expect(phoneFrameStyles('auto', fit)).toEqual({ viewport: {}, frame: {} });
    expect(phoneFrameStyles('phone', null)).toEqual({ viewport: {}, frame: {} });
  });

  it('sizes the wrapper to the fitted box and transforms the frame at the top-left origin', () => {
    const fit: PhoneFrameFit = { scale: 0.5, boxWidth: VW * 0.5, boxHeight: VH * 0.5 };
    const styles = phoneFrameStyles('phone', fit);
    expect(styles.viewport).toEqual({
      width: `${String(VW * 0.5)}px`,
      height: `${String(VH * 0.5)}px`
    });
    expect(styles.frame).toEqual({
      width: `${String(VW)}px`,
      height: `${String(VH)}px`,
      transform: 'scale(0.5)',
      'transform-origin': '0 0'
    });
  });

  it('grows the wrapper with the scale up to the capped fit', () => {
    const fit: PhoneFrameFit = { scale: 2, boxWidth: VW * 2, boxHeight: VH * 2 };
    const styles = phoneFrameStyles('phone', fit);
    expect(styles.viewport['width']).toBe(`${String(VW * 2)}px`);
    expect(styles.frame['transform']).toBe('scale(2)');
  });
});

describe('framesMayNavigate', () => {
  it('navigates immediately in auto and holds until both phone fits exist', () => {
    expect(framesMayNavigate('auto', {})).toBe(true);
    expect(framesMayNavigate('phone', {})).toBe(false);
    expect(framesMayNavigate('phone', { cached: null, bypassed: null })).toBe(false);
    expect(
      framesMayNavigate('phone', { cached: fitFor(600, 900), bypassed: fitFor(600, 900) })
    ).toBe(true);
    // One half measured, one not: the gate stays closed (both halves load at the same truth).
    expect(framesMayNavigate('phone', { cached: fitFor(600, 900) })).toBe(false);
  });
});

describe('measureColumnScale', () => {
  it('feeds the layout box (clientWidth/Height) into the shared fit math', () => {
    expect(measureColumnScale(columnWith(824, 1784))).toEqual(fitFor(824, 1784));
  });

  it('a spaceless column reports no fit instead of inventing one', () => {
    expect(measureColumnScale(columnWith(0, 400))).toBeNull();
  });

  it('a broken layout measurement throws (the presenter contains it per side)', () => {
    expect(() => measureColumnScale(columnWith(-1, 400))).toThrow(/real column size/);
  });
});

describe('createFramePresenter', () => {
  /** Stand a presenter over a traced ('live') or degrading ('degrade') rescale factory. */
  function setup(deps: { mode: 'live' | 'degrade' }): {
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
    const presenter = createFramePresenter({
      presentation: () => 'phone',
      columns: () => columns,
      measure: measureColumnScale,
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

  it('sync reports both halves through the shared fit measure', () => {
    const fx = setup({ mode: 'degrade' });
    fx.presenter.syncNow();
    expect(fx.recorded['cached']?.scale).toBeCloseTo(Math.min(700 / VW, 900 / VH, 2));
    expect(fx.recorded['bypassed']?.scale).toBeCloseTo(Math.min(320 / VW, 1600 / VH, 2));
  });

  it('a missing column is a lifecycle transient: the next sync picks its registration up', () => {
    const registered: Partial<Record<CompareSide, HTMLElement>> = { cached: columnWith(700, 900) };
    const recorded: FrameFitRecord = {};
    const presenter = createFramePresenter({
      presentation: () => 'auto',
      columns: () => registered,
      measure: measureColumnScale,
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
      measure: measureColumnScale,
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
      measure: measureColumnScale,
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
