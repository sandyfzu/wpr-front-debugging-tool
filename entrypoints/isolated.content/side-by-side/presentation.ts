/**
 * The phone-frame presentation glue the overlay's halves render through:
 * the inline style records derived from the fit math (pure, pinned by test)
 * and a live rescale controller — a per-half `ResizeObserver` feeding the
 * same helper, torn down cleanly on close and invalidation.
 *
 * One layout, two side-by-side halves: the column keeps its half width in
 * both presentations, and the phone fits inside it letterboxed. The stacking
 * tradeoff (a tall portrait window could fit bigger phones stacked) is
 * recorded, not taken — an aspect-triggered flip would oscillate under live
 * resize and break the two-halves model. See `lib/device-simulation/scale-fit`'s
 * notes.
 */

import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import { scaleFit, type PhoneFrameFit } from '../../../lib/device-simulation/scale-fit';
import type { Logger } from '../../../lib/logger';
import type { SimPresentation } from '../../../lib/side-by-side/mobile-sim';
import { COMPARE_SIDES, type CompareSide } from '../../../lib/side-by-side/scroll-sync';

/**
 * Inline style pixels of the unscaled frame, derived once from the profile
 * the fit math scales from.
 */
const FRAME_STYLE_WIDTH = `${String(DEVICE_SIMULATION_PROFILE.viewport.width)}px`;
const FRAME_STYLE_HEIGHT = `${String(DEVICE_SIMULATION_PROFILE.viewport.height)}px`;

/** Inline style record with hyphen-keyed CSS declarations (Solid's style-object shape; unset properties stay undefined). */
export interface FrameStyleRecord {
  [property: string]: string | undefined;
}

/** The two boxes one half renders through: the wrapper (layout box) and the inner frame (transform). */
export interface PhoneFrameStyles {
  /** The wrapper's styles: exactly `viewport × scale` CSS px so layout matches visuals. */
  viewport: FrameStyleRecord;
  /** The frame's styles: the profile's CSS px plus the top-left-origin scale transform. */
  frame: FrameStyleRecord;
}

/**
 * The per-half fit as the rescale last reported it; `null` = not measured
 * (or a spaceless column — a transient that renders nothing).
 */
export type FrameFitRecord = Partial<Record<CompareSide, PhoneFrameFit | null>>;

/**
 * The inline styles a half's presentation needs. Pure — the component
 * derives its `style` props from this per render.
 *
 * @param presentation The presentation the overlay is in right now.
 * @param fit The half's live fit; null renders like the auto presentation until a measurement lands.
 * @returns The two inline records — empty (no inline styles) for the auto presentation.
 */
export function phoneFrameStyles(
  presentation: SimPresentation,
  fit: PhoneFrameFit | null
): PhoneFrameStyles {
  if (presentation !== 'phone' || fit === null) return { viewport: {}, frame: {} };
  return {
    viewport: { width: `${String(fit.boxWidth)}px`, height: `${String(fit.boxHeight)}px` },
    frame: {
      width: FRAME_STYLE_WIDTH,
      height: FRAME_STYLE_HEIGHT,
      transform: `scale(${String(fit.scale)})`,
      'transform-origin': '0 0'
    }
  };
}

/**
 * Whether the halves may carry their URLs: `'auto'` needs no fit at all
 * (fluid boxes navigate immediately); the phone presentation holds the first
 * navigation until both fits exist, so each half loads once, at the device
 * size, after the open has established the rule. The rest of "later fits
 * never ungate — the urls are set once" is the view's latch (the ui
 * component unlocks the first load and never re-locks); this reporter is
 * the pure live availability.
 *
 * @param presentation The current presentation.
 * @param fits The per-half fit record as the rescale last reported it.
 */
export function framesMayNavigate(presentation: SimPresentation, fits: FrameFitRecord): boolean {
  if (presentation === 'auto') return true;
  return COMPARE_SIDES.every((side) => fits[side] !== undefined && fits[side] !== null);
}

/** A live rescaler for one column; the wiring passes the engine's `ResizeObserver` state through. */
export interface FrameLiveRescaler {
  /** Start reporting the given column's size changes to this rescaler. */
  observe(column: HTMLElement): void;
  /** Release all reporting; a disconnected rescaler reports nothing anymore. */
  disconnect(): void;
}

/** The presentation controller's inputs: what it reads and reports, all injected so tests drive without a DOM. */
export interface FramePresenterDeps {
  /**
   * The current presentation. Auto columns are still measured (a phone
   * adoption wants the fits immediately), only the reporting is
   * presentation-independent — the caller decides what a fit means.
   */
  presentation(): SimPresentation;
  /** The two column elements (the overlay halves), as the component's refs registered them. */
  columns(): Partial<Record<CompareSide, HTMLElement>>;
  /** The fit oracle for one column — the wiring passes `measureColumnScale`. */
  measure(column: HTMLElement): PhoneFrameFit | null;
  /** Per-half fit reporting — the wiring writes it into the styles signal the component reads. */
  onFit(side: CompareSide, fit: PhoneFrameFit | null): void;
  /**
   * The live-rescale factory, invoked at most once per column; a null result
   * means fits are taken once per sync (the explicit degrade when the engine
   * lacks `ResizeObserver`).
   */
  rescaleFactory(onFrameRescale: () => void): FrameLiveRescaler | null;
  /** Degradation diagnostics (the no-`ResizeObserver` engine note among them). */
  log: Logger;
}

/** The presentation controller the overlay's wiring keeps for its lifetime. */
export interface FramePresenter {
  /**
   * Recompute every column's fit and arm its live rescale; repeat calls are
   * idempotent (re-measure + re-observe, both harmless on stability).
   */
  syncNow(): void;
  /** Tear the live rescalers down (close / invalidation); the next sync re-arms them. */
  stop(): void;
}

/**
 * The production rescale factory: the engine's `ResizeObserver` when
 * feature-detected (`'ResizeObserver' in window`), else null with a debug
 * line — never a silent half-working skip. The overlay's wiring passes it;
 * tests inject a traced factory instead.
 *
 * @param onFrameRescale The observer's entries collapse into this one re-measure.
 */
export function engineRescaleFactory(
  log: Logger
): NonNullable<FramePresenterDeps['rescaleFactory']> {
  return (onFrameRescale) => {
    if (!('ResizeObserver' in window)) {
      log.debug('ResizeObserver is unavailable: the phone frames scale once per open, not live');
      return null;
    }
    const observer = new ResizeObserver(() => {
      onFrameRescale();
    });
    return {
      observe: (column) => {
        observer.observe(column);
      },
      disconnect: () => {
        observer.disconnect();
      }
    };
  };
}

/**
 * Create the presentation controller.
 *
 * @param deps The overlay slices the presenter reads (columns) and reports into (onFit).
 */
export function createFramePresenter(deps: FramePresenterDeps): FramePresenter {
  /** Per-side live rescalers: created once, re-observed per sync, disconnected at stop. */
  const live: Partial<Record<CompareSide, FrameLiveRescaler | null>> = {};

  /**
   * Measure one column through the injected oracle and report the fit for
   * its side. A missing column is a lifecycle transient (registered by the
   * next sync); a broken measurement is a bug — logged, the previous fit
   * kept.
   */
  const measureOnce = (side: CompareSide): void => {
    const column = deps.columns()[side];
    if (column === undefined) return;
    let fit: PhoneFrameFit | null;
    try {
      fit = deps.measure(column);
    } catch (cause) {
      deps.log.error(`The ${side} half's fit measurement failed`, cause);
      return;
    }
    deps.onFit(side, fit);
  };

  return {
    syncNow(): void {
      for (const side of COMPARE_SIDES) {
        measureOnce(side);
        if (live[side] === undefined) {
          live[side] = deps.rescaleFactory(() => {
            measureOnce(side);
          });
        }
        const column = deps.columns()[side];
        if (column !== undefined) live[side]?.observe(column);
      }
    },
    stop(): void {
      for (const side of COMPARE_SIDES) {
        live[side]?.disconnect();
        live[side] = undefined;
      }
    }
  };
}

/**
 * The production measure a real column goes through: its layout box (never a
 * `getBoundingClientRect` — the transform's own feedback would poison the
 * fit) through the device-simulation module's pure fit math.
 *
 * @param column The half's wrapper element as laid out.
 * @throws {@link Error} propagating `scaleFit`'s broken-measurement throw (the presenter contains it per side).
 */
export function measureColumnScale(column: HTMLElement): PhoneFrameFit | null {
  return scaleFit({ width: column.clientWidth, height: column.clientHeight });
}
