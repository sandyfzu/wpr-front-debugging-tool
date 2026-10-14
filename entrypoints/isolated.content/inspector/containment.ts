/**
 * The containment re-settle watcher: the pure orchestration behind the
 * owner binding "no part of the widget may leave the viewport — ever". A
 * drag clamps itself (the drag machine's own job); this module holds the
 * OTHER containment legs — a viewport that changed, a card that grew or
 * shrank, a zoom step — by waiting for the chrome to stop moving and then
 * releasing the re-clamp once. It owns no geometry (the drag machine
 * computes the clamp) and no CSS (the wiring renders the move); it is the
 * settle-sensing seam that makes a post-change re-clamp honest instead of
 * fighting a spring.
 */

import type { DragBox } from './drag';

/**
 * The frames a re-settle cycle may wait for box stability before conceding.
 * The open/close choreography springs are ~17 frames (~280 ms) plus the
 * two stability frames; the bound exists for the pathological host (a box
 * that never stands still) — concedes without applying, never loops forever.
 */
export const RESETTLE_MAX_FRAMES = 32;

/** The watch's seams: reads and callbacks injected, nothing reached around. */
export interface ContainmentWatchDeps {
  /**
   * The visible chrome shape's live box (the drag machine's same read) —
   * sampled per frame for stability.
   */
  readBox(): DragBox | null;
  /** Fresh liveness per call: a dead content-script context ends the cycle. */
  isInvalid(): boolean;
  /**
   * One animation-frame callback behind the content script's own lifecycle
   * (the context's rAF seam — it never fires past invalidation).
   */
  nextFrame(callback: () => void): void;
  /**
   * The re-clamp release itself: the wiring calls the drag machine here and
   * renders a moved result smoothly. Runs exactly once per settled cycle.
   */
  reform(): void;
  /** Bounded-exhaustion visibility (the cycle's one honest degradation). */
  log: { debug(message: string, ...details: unknown[]): void };
}

/** One watcher instance per mount; cycles never overlap. */
export interface ContainmentWatch {
  /**
   * Arm a re-settle cycle: sample the box until two consecutive reads agree
   * (a still chrome, whatever spring ran), then release {@link ContainmentWatchDeps.reform}
   * once. The arm takes its own first sample synchronously (the trigger
   * beat's pre-change box is the right baseline); requests while a cycle
   * runs coalesce — the running cycle's conclusion already reflects the
   * latest motion.
   */
  request(): void;
  /**
   * End the watcher: the running cycle aborts at its next frame and no new
   * cycle may arm (the teardown belt over the context's own invalidation).
   */
  stop(): void;
}

/** Field-true box equality: two rects that read identical are "the chrome stood still". */
function sameBox(a: DragBox, b: DragBox): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Build the watcher.
 *
 * @param deps The settle-sensing seams.
 */
export function createContainmentWatch(deps: ContainmentWatchDeps): ContainmentWatch {
  /** Whether a cycle is running (one at a time; later requests coalesce). */
  let armed = false;
  /** Whether the caller stopped the watcher (the teardown belt). */
  let stopped = false;

  const runCycle = (): void => {
    let previous: DragBox | null = null;
    let frames = 0;
    // The first frame samples the START of a possible motion, so the body
    // sees an unchanged second read only when nothing (or no longer)
    // animates between the ticks.
    const tick = (): void => {
      // Stop wins over the running cycle: whatever the box is doing, this
      // watcher's caller took it down.
      if (stopped) {
        armed = false;
        return;
      }
      if (deps.isInvalid()) {
        armed = false;
        return;
      }
      const box = deps.readBox();
      if (box === null) {
        // A dead chrome cannot be held inside anything: the cycle is over
        // and stays over (the wiring's own teardown owns the rest).
        armed = false;
        return;
      }
      if (previous !== null && sameBox(previous, box)) {
        armed = false;
        deps.reform();
        return;
      }
      frames += 1;
      if (frames > RESETTLE_MAX_FRAMES) {
        armed = false;
        // Concede rather than clamp against a mid-motion box: a later
        // trigger re-arms, so a stable moment is only ever one request away.
        deps.log.debug(
          'the containment re-settle conceded without a still box (no stable read within ' +
            `${String(RESETTLE_MAX_FRAMES)} frames)`
        );
        return;
      }
      previous = box;
      deps.nextFrame(tick);
    };
    tick();
  };

  return {
    request() {
      if (stopped) return; // a stopped watcher accepts no new cycle
      if (armed) return; // coalesce: the running cycle settles on the latest motion
      armed = true;
      runCycle();
    },
    stop() {
      stopped = true;
      armed = false;
    }
  };
}
