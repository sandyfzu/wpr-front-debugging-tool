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
 * The wall-clock span (ms) a re-settle cycle may keep sampling before it
 * concedes. Time, not frames — the motion it waits for is timed in ms, so
 * a frame-counted bound concedes on faster displays: the card's open
 * choreography runs `--dw-enter` = `--motion-slow` = 280 ms, which is
 * ~17 frames at 60 Hz but ~34 frames at 120 Hz before the two stability
 * reads even land, exactly where a 32-frame bound gave up. The figure
 * covers the worst realistic motion chain — a 3-leg open→close→open
 * thrash of ≈ 295 ms of continuous box instability per leg (≈ 885 ms
 * measured: the open and reopen legs run `--dw-enter` whole, and on
 * `.dw-open` removal the close-path pill RE-ENTERS — its base
 * `dw-tool-in` animation restarts and runs another full 280 ms entrance,
 * so the close leg is not the 180 ms exit a leg table would suggest) —
 * plus the two idle stability reads at any realistic pacing (~17 ms per
 * read at 60 Hz, ~8 ms at 120 Hz, ~4 ms at 240 Hz), ≈ 919 ms of honest
 * worst chain and ~80 ms of cap headroom for frame jitter. A longer
 * unbroken thrash overruns the cap and owns its consequence honestly (see
 * the {@link ContainmentWatch.request} contract: one bounded immediate
 * re-cycle carries a trigger that had coalesced into the conceding cycle).
 * It caps the pathological host only (a box that never stands still): a
 * settled pair releases whenever it lands — even past the bound — and a
 * conceded cycle with no coalesced trigger re-arms at the next trigger.
 */
export const RESETTLE_MAX_MS = 1000;

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
   * The wall clock the settle bound reads (ms); injected so tests pace it
   * frame-accurately.
   */
  now(): number;
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
   * (a still chrome, whatever spring ran — within a {@link RESETTLE_MAX_MS}
   * wall-clock cap), then release {@link ContainmentWatchDeps.reform} once.
   * The arm takes its own first sample synchronously (the trigger beat's
   * pre-change box is the right baseline). Requests while a cycle runs
   * coalesce into it: when that cycle settles, its conclusion serves them;
   * when it CONCEDES, one fresh immediate cycle (its own baseline and cap)
   * carries their demand — a coalesced trigger is never swallowed by its
   * cycle's concession. That re-cycle is the only thing a concede starts,
   * and only for triggers that arrived during the conceding cycle: new
   * requests during the re-cycle re-fuel the same one bounded restart, so
   * a batch of coalesced triggers costs at most one re-cycle, an unbroken
   * box with no further triggers concedes twice (the cycle, then the
   * re-cycle) and rests, and a concession of every other kind (teardown, a
   * dead shape or context) starts nothing — a later trigger re-arms the
   * normal way.
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
  /**
   * Whether a trigger landed while the current cycle holds the watcher: the
   * cycle's settlement serves it, and its concession must not swallow it —
   * one bounded immediate re-cycle carries it over. Cleared at EVERY cycle
   * conclusion (spent on the restart, moot on a settle or a teardown death)
   * so it can never outlive the cycle that received the trigger: a later
   * independent cycle runs unfueled and its own concede restarts nothing.
   */
  let coalesced = false;

  const runCycle = (): void => {
    let previous: DragBox | null = null;
    // The cycle's first sample beat is the bound's origin: the entrance's
    // whole ms duration is what the cycle may wait out. True for a re-cycle
    // too — its restarted `startedAt` is what makes its cap self-owned
    // (never an inherited remainder of the conceded cycle's).
    const startedAt = deps.now();
    // The first frame samples the START of a possible motion, so the body
    // sees an unchanged second read only when nothing (or no longer)
    // animates between the ticks.
    const tick = (): void => {
      // Stop wins over the running cycle: whatever the box is doing, this
      // watcher's caller took it down.
      if (stopped) {
        armed = false;
        coalesced = false;
        return;
      }
      if (deps.isInvalid()) {
        // Teardown, not motion: the demand ends WITH the context — no
        // re-cycle (and no fuel left behind for a later cycle's concede).
        armed = false;
        coalesced = false;
        return;
      }
      const box = deps.readBox();
      if (box === null) {
        // A dead chrome cannot be held inside anything: the cycle is over
        // and stays over (the wiring's own teardown owns the rest) — same
        // spend as the context death.
        armed = false;
        coalesced = false;
        return;
      }
      if (previous !== null && sameBox(previous, box)) {
        // A settle has carried the demand to its conclusion: the re-cycle
        // fuel is spent with it, so a later cycle runs unfueled.
        armed = false;
        coalesced = false;
        deps.reform();
        return;
      }
      if (deps.now() - startedAt > RESETTLE_MAX_MS) {
        armed = false;
        // Concede rather than clamp against a mid-motion box. A conceded
        // cycle re-arms at the next trigger — EXCEPT the triggers that
        // already coalesced into THIS cycle: swallowing them would strand
        // their containment demand (the leak persists until some unrelated
        // future trigger). So a conceding cycle that holds fuel spends it
        // on ONE fresh cycle instead of dead-ending. Bounded: the re-cycle
        // starts with an empty flag (only triggers arriving during IT
        // re-fuel it) and `startedAt` gives it its own cap while every
        // non-concede conclusion is a dead end — a batch of coalesced
        // triggers costs at most one re-cycle, and a never-settling box
        // with no further input concedes exactly twice.
        deps.log.debug(
          'the containment re-settle conceded without a still box (no stable read within ' +
            `${String(RESETTLE_MAX_MS)} ms)`
        );
        if (coalesced) {
          coalesced = false;
          runCycle();
        }
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
      if (armed) {
        // Coalesce into the running cycle — and fuel its one bounded
        // re-cycle should this very cycle concede: the flag survives only
        // within this cycle (every conclusion path clears it).
        coalesced = true;
        return;
      }
      armed = true;
      runCycle();
    },
    stop() {
      stopped = true;
      armed = false;
      coalesced = false;
    }
  };
}
