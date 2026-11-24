/**
 * The presentation glue the overlay's halves render through: the inline
 * style records derived from the fit math (pure, pinned by test) and a live
 * rescale controller — a per-half `ResizeObserver` feeding the same helper,
 * torn down cleanly on close and invalidation.
 *
 * One layout, two side-by-side halves: the column keeps its half width in
 * every presentation. The phone dress fits inside it letterboxed (the
 * stacking tradeoff is recorded, not taken — see `lib/device-simulation/
 * scale-fit`'s notes); the desktop dress fills the column exactly while the
 * iframe's own content box holds a desktop-width viewport, so in-frame media
 * queries resolve at real desktop widths.
 */

import { DEVICE_SIMULATION_PROFILE } from '../../../lib/device-simulation/profiles';
import { scaleFit, type PhoneFrameFit } from '../../../lib/device-simulation/scale-fit';
import { desktopFit, type DesktopFrameFit } from '../../../lib/side-by-side/desktop-fit';
import type { Logger } from '../../../lib/logger';
import type { FramePresentation } from '../../../lib/side-by-side/presentation-state';
import { COMPARE_SIDES, type CompareSide } from '../../../lib/side-by-side/scroll-sync';

/**
 * Inline style pixels of the unscaled phone frame, derived once from the
 * profile the fit math scales from.
 */
const FRAME_STYLE_WIDTH = `${String(DEVICE_SIMULATION_PROFILE.viewport.width)}px`;
const FRAME_STYLE_HEIGHT = `${String(DEVICE_SIMULATION_PROFILE.viewport.height)}px`;

/** Inline style record with hyphen-keyed CSS declarations (Solid's style-object shape; unset properties stay undefined). */
export interface FrameStyleRecord {
  [property: string]: string | undefined;
}

/** The two boxes one half renders through: the wrapper (layout box) and the inner frame (transform). */
export interface FrameStyles {
  /** The wrapper's styles: the box the transform lands in, so layout matches visuals. */
  viewport: FrameStyleRecord;
  /** The frame's styles: its own (unscaled) box plus the top-left-origin scale transform. */
  frame: FrameStyleRecord;
}

/**
 * The per-half fit as the rescale last reported it: which presentation's
 * math produced it, along with the numbers that math computed. `null` = not
 * measured (or a spaceless column — a transient that renders nothing).
 * A presentation whose flavor has not been reported yet renders nothing
 * inline (the styles' dispatch requires the kind to match) — the wiring
 * re-measures on every presentation change, so the mismatch lives only until
 * the next measure lands.
 */
export type FrameFit =
  ({ kind: 'phone' } & PhoneFrameFit) | ({ kind: 'desktop' } & DesktopFrameFit);

/** The per-half fit record the rescale's reports feed, keyed by side. */
export type FrameFitRecord = Partial<Record<CompareSide, FrameFit | null>>;

/**
 * The inline styles a half's presentation needs. Pure — the component
 * derives its `style` props from this per render.
 *
 * @param presentation The presentation the overlay is in right now.
 * @param fit The half's live fit; null or a mismatched flavor renders like the fluid dress until a measurement lands.
 * @returns The two inline records — empty (no inline styles) for the fluid dress.
 */
export function frameStylesFor(presentation: FramePresentation, fit: FrameFit | null): FrameStyles {
  if (fit === null || fit.kind !== presentation) return { viewport: {}, frame: {} };
  if (fit.kind === 'phone') {
    return {
      viewport: { width: `${String(fit.boxWidth)}px`, height: `${String(fit.boxHeight)}px` },
      frame: {
        width: FRAME_STYLE_WIDTH,
        height: FRAME_STYLE_HEIGHT,
        // Zero-shrink basis: the flex container must not clamp the frame's
        // own box — the media queries inside it resolve against it.
        flex: '0 0 auto',
        transform: `scale(${String(fit.scale)})`,
        'transform-origin': '0 0'
      }
    };
  }
  // The desktop dress: the wrapper is the column itself, the frame's own
  // box is a desktop-width viewport scaled into it. Overflow clips the
  // scaled document at the column edge, the role the phone box's class owns
  // in its presentation. Zero-shrink basis as above: the flex container
  // must not clamp the desktop-width box the whole feature exists for.
  return {
    viewport: {
      width: `${String(fit.boxWidth)}px`,
      height: `${String(fit.boxHeight)}px`,
      overflow: 'hidden'
    },
    frame: {
      width: `${String(fit.frameWidth)}px`,
      height: `${String(fit.frameHeight)}px`,
      flex: '0 0 auto',
      transform: `scale(${String(fit.scale)})`,
      'transform-origin': '0 0'
    }
  };
}

/**
 * The inline style a side label needs to stay over its own frame. The fluid
 * and desktop dresses fill the half, so the label's grid column already
 * centres it there (no inline style). The phone dress packs each device
 * against the shared edge, so the label takes the device's width and the
 * stylesheet packs it the same way: centred over the device, not the
 * letterboxed half.
 *
 * @param presentation The presentation the overlay is in right now.
 * @param fit The half's live fit; null or a mismatched flavor yields no inline style.
 * @returns The label's inline record, empty unless a phone fit is in place.
 */
export function sideLabelStyleFor(
  presentation: FramePresentation,
  fit: FrameFit | null
): FrameStyleRecord {
  if (fit === null || fit.kind !== presentation || fit.kind !== 'phone') return {};
  return { width: `${String(fit.boxWidth)}px` };
}

/**
 * Whether the halves may carry their URLs: the fluid dress needs no fit at
 * all (boxes navigate immediately); the phone and desktop dresses hold the
 * first navigation until both fits exist, computed by that dress's own
 * math — each half loads once, at its rendered size, after the open has
 * established the session's rule (or the persisted dress). A foreign
 * flavor's fit keeps the gate closed: the sizing a wrong flavor describes
 * is exactly the media-query lie the dresses exist to prevent. The rest of
 * "later fits never ungate — the urls are set once" is the view's latch
 * (the ui component unlocks the first load and never re-locks); this
 * reporter is the pure live availability.
 *
 * @param presentation The current presentation.
 * @param fits The per-half fit record as the rescale last reported it.
 */
export function framesMayNavigate(presentation: FramePresentation, fits: FrameFitRecord): boolean {
  if (presentation === 'auto') return true;
  return COMPARE_SIDES.every((side) => {
    const fit = fits[side];
    return fit !== undefined && fit !== null && fit.kind === presentation;
  });
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
   * The current presentation. Fluid columns are still measured (a dress
   * adoption wants the fits immediately), only the reporting is
   * presentation-independent — the caller decides what a fit means.
   */
  presentation(): FramePresentation;
  /** The two column elements (the overlay halves), as the component's refs registered them. */
  columns(): Partial<Record<CompareSide, HTMLElement>>;
  /** The fit oracle for one column, flavored for the current presentation — the wiring passes `measureColumnFit` bound to the live presentation. */
  measure(column: HTMLElement): FrameFit | null;
  /** Per-half fit reporting — the wiring writes it into the styles signal the component reads. */
  onFit(side: CompareSide, fit: FrameFit | null): void;
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
      log.debug('ResizeObserver is unavailable: the dressed frames scale once per open, not live');
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
    let fit: FrameFit | null;
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
 * The production measure a real phone-dressed column goes through: its
 * layout box (never a `getBoundingClientRect` — the transform's own feedback
 * would poison the fit) through the device-simulation module's pure fit math.
 *
 * @param column The half's wrapper element as laid out.
 * @throws {@link Error} propagating `scaleFit`'s broken-measurement throw (the presenter contains it per side).
 */
export function measureColumnScale(column: HTMLElement): PhoneFrameFit | null {
  return scaleFit({ width: column.clientWidth, height: column.clientHeight });
}

/**
 * The production measure the wiring binds: the column's layout box through
 * the math of the presentation it will render at, already flavored — a
 * desktop dress seeks its desktop-width fit, everything else the phone fit
 * (the fluid dress consumes no fit; its measurement keeps an adoption
 * instant).
 *
 * @param column The half's wrapper element as laid out.
 * @param presentation The presentation the measurement is for right now.
 * @returns The flavored fit, or null when the column holds no space (or the measurement reports no fit).
 * @throws {@link Error} propagating the underlying math's broken-measurement throw (the presenter contains it per side).
 */
export function measureColumnFit(
  column: HTMLElement,
  presentation: FramePresentation
): FrameFit | null {
  if (presentation === 'desktop') {
    const fit = desktopFit({ width: column.clientWidth, height: column.clientHeight });
    return fit === null ? null : { kind: 'desktop', ...fit };
  }
  const fit = measureColumnScale(column);
  return fit === null ? null : { kind: 'phone', ...fit };
}
