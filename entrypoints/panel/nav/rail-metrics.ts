/**
 * The rail-overflows' measure seam — how the computation gets real
 * geometry: the rail renders a full-layout geometry stub (every registry
 * row, no icons, no semantics, invisible and outside the accessible tree)
 * whose boxes are the rail's own layout truth, and the seam turns those
 * boxes plus the rail's content height into the {@link RailRowBox} set
 * the pure computation consumes.
 *
 * The default here is the production DOM read (rectangle math relative to
 * the rail element, so nothing depends on offsetParent chains), injector
 * shape in the type so render tests and suites can feed synthetic
 * geometries without a browser.
 */
import type { RailRowBox } from './visible-rows';
import { isRouteId } from '../routes';
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/** What one measurement yields: every registry row's box plus the height available for them. */
export interface RailMeasurements {
  /** The rail's registry rows, registry-ordered, measured in the full layout. */
  readonly rows: readonly RailRowBox[];
  /** The rail's content-box height in px — the rows' fit budget. */
  readonly availableHeight: number;
}

/** The injectable measure: rail element → measurements, or null when not measurable. */
export type RailMeasureFn = (rail: HTMLElement) => RailMeasurements | null;

/**
 * The DOM hook every geometry stub row carries: its value is the route id,
 * its set is the full-layout mirror the seam measures. Declared here — the
 * seam owns its DOM contract — and rendered by the rail component from this
 * one imported constant, so the hooks can never drift apart.
 */
export const NAV_MIRROR_ROW_ATTR = 'data-fdt-mirror-row';

/**
 * Measure one rail from its live DOM.
 *
 * Reads every geometry stub row's rectangle relative to the rail's box
 * (the stub sits exactly over the rail's content origin, so the deltas are
 * the rows' layout positions in the rail) and the rail's content height.
 *
 * Degenerate measurements are reported as *not measurable* (`null`) rather
 * than invented: a missing or geometry-empty stub, a non-finite height or
 * an empty rail box all mean "no truthful geometry here", and the caller
 * keeps the previous slice instead of acting on noise. The pure
 * computation itself still validates what arrives — this seam is the
 * generous boundary, the function is the strict one.
 *
 * A real rail at a *zero* height (the rail's box genuinely has no room)
 * reads the same as a layout-less environment's zeroes — and in both
 * cases the truthful report is "nothing decided here": the caller keeps
 * its current slice (a real zero-height rail has no visible rows to
 * reclaim anyway, and the affordance's earlier decision stays instead of
 * being re-made from noise).
 *
 * @param rail The rail element (`position: relative` — the stub anchors to it).
 */
export const realRailMeasure: RailMeasureFn = (rail) => {
  const railBox = rail.getBoundingClientRect();
  const availableHeight = rail.clientHeight;
  const stubRows = rail.querySelectorAll<HTMLElement>(`[${NAV_MIRROR_ROW_ATTR}]`);
  if (stubRows.length === 0) return null;
  // A zero-height rail reads clientHeight 0 — in real Chromium that is a
  // genuinely empty rail, but in layout-less environments (happy-dom) every
  // box is 0 and the very same values would silently hide every row. The
  // zero box is exactly the "nothing trustworthy here" case for both: one
  // guard serves the honest empty rail (caller keeps its state, which at a
  // real 0-height rail is "everything fits — nothing was hidden yet") and
  // the unstyled test DOM (which keeps its all-visible default).
  if (railBox.height <= 0 || !Number.isFinite(availableHeight) || availableHeight <= 0) {
    return null;
  }
  const rows: RailRowBox[] = [];
  for (const element of stubRows) {
    const route = element.getAttribute(NAV_MIRROR_ROW_ATTR);
    const box = element.getBoundingClientRect();
    if (route === null || !Number.isFinite(box.top) || !Number.isFinite(box.height)) return null;
    if (!isRouteId(route)) {
      // A stub row outside the registry (or without its route attribute) is
      // an untruthful DOM — refuse the whole measurement rather than slice
      // against invented rows.
      log.warn('Rail measurement refused a stub row outside the registry', { route });
      return null;
    }
    rows.push({ route, top: box.top - railBox.top, height: box.height });
  }
  return { rows, availableHeight };
};

/**
 * Watch a rail's size and re-run the measurement whenever the rail's box
 * changes — the production watcher behind {@link RailWatchFn}.
 *
 * A missing `ResizeObserver` (layout-less environments) degrades to a
 * no-op watch: the caller's boot measurement still runs, the pointer just
 * never re-fires — tests that need resizes inject their own watcher.
 *
 * @param rail The element whose height drives the slice.
 * @param onResize Called on every geometry change of `rail`.
 * @returns The stop handle (idempotent).
 */
export const realRailWatch = (rail: HTMLElement, onResize: () => void): (() => void) => {
  if (typeof ResizeObserver !== 'function') return () => undefined;
  const observer = new ResizeObserver(() => {
    onResize();
  });
  try {
    observer.observe(rail);
  } catch (cause: unknown) {
    // An element that cannot be observed (detached mid-call) must not break
    // the nav's mount: log and keep the static measurement.
    log.error('Rail size watch could not attach — keeping the static measurement', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return () => undefined;
  }
  /** The stop handle: disconnecting twice must stay harmless. */
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
  };
};

/** The injectable size watch: rail element + callback → stop handle. */
export type RailWatchFn = (rail: HTMLElement, onResize: () => void) => () => void;
