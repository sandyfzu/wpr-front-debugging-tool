/**
 * The containment re-settle watcher: settle-sensing over fake frames paced
 * against an injected wall clock — the arm's synchronous sample is the
 * baseline, a still box releases on its first pumped frame, an animating box
 * waits (and its requests coalesce), stability beats the bound (a settled
 * pair releases even past `RESETTLE_MAX_MS`), a never-settling box concedes
 * just past the time bound without applying, the outcome follows elapsed
 * time — not frame count — dead shapes/contexts stop the cycle, and `stop`
 * aborts running cycles and rejects new ones.
 */
import { describe, expect, it } from 'vitest';
import type { DragBox } from './drag';
import { createContainmentWatch, RESETTLE_MAX_MS } from './containment';
import type { ContainmentWatchDeps } from './containment';

/**
 * A fake frame queue over a controllable wall clock: callbacks run only
 * when pumped, and every pump advances the clock by the frame's pace
 * before it runs one queued callback — elapsed time moving in lockstep
 * with the sampled frames is what the bound's honesty is pinned against.
 */
function fakeFrames(paceMs: number): {
  nextFrame: (cb: () => void) => void;
  pump(): boolean;
  clockMs(): number;
} {
  const queue: Array<() => void> = [];
  let clock = 0;
  return {
    nextFrame: (cb) => {
      queue.push(cb);
    },
    // Pump one queued frame (advancing the clock by the pace first); says
    // whether another frame stayed queued.
    pump(): boolean {
      const cb = queue.shift();
      if (cb === undefined) return queue.length > 0;
      clock += paceMs;
      cb();
      return queue.length > 0;
    },
    clockMs: () => clock
  };
}

/**
 * The recording seams: a settable box, a settable invalidation flag, a
 * controllable clock, and the counters the pins read. The state object was
 * made before the seams so every referenced closure shares one truth.
 */
interface Recorded extends ContainmentWatchDeps {
  setBox(box: DragBox | null): void;
  setInvalid(value: boolean): void;
  reformed(): number;
  debugLines(): string[];
  clockMs(): number;
}

function fakeDeps(frames: ReturnType<typeof fakeFrames>): Recorded {
  const state = {
    box: { left: 10, top: 10, width: 200, height: 40 } as DragBox | null,
    invalid: false,
    reforms: 0,
    debug: [] as string[]
  };
  return {
    readBox: () => state.box,
    isInvalid: () => state.invalid,
    nextFrame: frames.nextFrame,
    now: () => frames.clockMs(),
    reform: () => {
      state.reforms += 1;
    },
    log: {
      debug: (message: string) => {
        state.debug.push(message);
      }
    },
    setBox: (box) => {
      state.box = box;
    },
    setInvalid: (value) => {
      state.invalid = value;
    },
    reformed: () => state.reforms,
    debugLines: () => state.debug,
    clockMs: () => frames.clockMs()
  };
}

describe('createContainmentWatch', () => {
  it('a still box releases on its first pumped frame; the cycle ends after that', () => {
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    // The arm's synchronous sample is the baseline; the first pumped frame
    // sees the same box and releases.
    expect(deps.reformed()).toBe(0);
    frames.pump();
    expect(deps.reformed(), 'a still chrome releases at once').toBe(1);
    // The cycle is over: more pumps do nothing.
    frames.pump();
    expect(deps.reformed()).toBe(1);
    expect(deps.debugLines()).toEqual([]);
  });

  it('an animating box waits; the release lands on its settled read', () => {
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request(); // reads the pre-motion box as the baseline
    // The card's open choreography under the reader: every pumped frame the
    // box has moved (30 distinct reads stay far inside the time bound —
    // 30 × 16.7 ms ≈ 501 ms).
    for (let frame = 1; frame <= 30; frame += 1) {
      deps.setBox({ left: 10 - frame, top: 10 - frame, width: 200, height: 40 });
      expect(deps.reformed()).toBe(0);
      frames.pump();
    }
    // The spring ends: the settled write repeats the 30th read's values, so
    // the FIRST pumped frame after it sees two equal reads in a row and the
    // release fires right there.
    deps.setBox({ left: -20, top: -20, width: 200, height: 40 }); // the settled pose again
    frames.pump(); // the equal consecutive pair → the release fires on this frame
    deps.setBox({ left: -20, top: -20, width: 200, height: 40 });
    frames.pump(); // the cycle is over: nothing is scheduled, this pump runs nothing
    expect(deps.reformed(), 'the release fires exactly after box stability').toBe(1);
    expect(deps.debugLines()).toEqual([]);
  });

  it('requests during a running cycle coalesce (one release for the whole motion)', () => {
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    deps.setBox({ left: 60, top: 10, width: 200, height: 40 }); // a resize re-laid the chrome
    frames.pump(); // the base read vs the moved read → keeps counting
    watch.request(); // a fresh trigger mid-motion must not fork a second cycle
    deps.setBox({ left: 62, top: 10, width: 200, height: 40 });
    frames.pump(); // still changing → keeps counting
    deps.setBox({ left: 62, top: 10, width: 200, height: 40 });
    frames.pump(); // equal read → the release
    expect(deps.reformed()).toBe(1);
    expect(deps.debugLines()).toEqual([]);
  });

  it('a dead shape or a dead context stops the cycle without releasing', () => {
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    deps.setBox(null); // the disable beat removed the chrome mid-cycle
    frames.pump();
    expect(deps.reformed()).toBe(0);
    frames.pump(); // the cycle ended; nothing else was scheduled
    expect(deps.reformed()).toBe(0);

    const other = createContainmentWatch(deps);
    other.request();
    deps.setInvalid(true); // the context ended before any other read
    frames.pump();
    expect(deps.reformed()).toBe(0);
    expect(frames.pump()).toBe(false);
  });

  it('the 120 Hz open choreography reforms (the frame bound would have conceded)', () => {
    // The owner bug, deterministic in the unit tier: the card's 280 ms
    // entrance read at ProMotion-like pacing (8.3 ms frames) needs ~34
    // frames + the two stability reads — the frame-counted bound conceded
    // before that and never pulled the chrome back inside. The wall-clock
    // bound (≈302 ms at the settle) must reform.
    const frames = fakeFrames(8.3);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    // The entrance animates (distinct reads) for 36 frames, then holds.
    for (let frame = 1; frame <= 36; frame += 1) {
      deps.setBox({ left: 8 - frame, top: 6 - frame, width: 200, height: 40 });
      expect(deps.reformed()).toBe(0);
      frames.pump();
    }
    // The settle: the first equal pair after frame 36 fires the release.
    deps.setBox({ left: 8 - 36, top: 6 - 36, width: 200, height: 40 });
    frames.pump();
    expect(deps.reformed(), 'the 280 ms entrance reforms under the time bound').toBe(1);
    expect(deps.clockMs()).toBeLessThan(RESETTLE_MAX_MS); // elapsed ≈ 8.3 × 37 ≈ 308 ms
    expect(deps.debugLines()).toEqual([]);
  });

  it('the same choreography reforms at any frame pacing — elapsed time decides, not frames', () => {
    // 36 changing frames is the SAME choreography under every pacing; only
    // its wall-clock span differs (≈151 / 302 / 605 ms). The frame-counted
    // bound would concede the very same shape at all three; the time bound
    // reforms at every one of them.
    for (const paceMs of [4.2, 8.3, 16.7]) {
      const frames = fakeFrames(paceMs);
      const deps = fakeDeps(frames);
      const watch = createContainmentWatch(deps);
      watch.request();
      for (let frame = 1; frame <= 36; frame += 1) {
        deps.setBox({ left: 8 - frame, top: 6 - frame, width: 200, height: 40 });
        frames.pump();
      }
      deps.setBox({ left: 8 - 36, top: 6 - 36, width: 200, height: 40 });
      frames.pump();
      expect(deps.reformed(), `reforms at ${String(paceMs)} ms pacing`).toBe(1);
      expect(deps.reformed(), `the release is once at ${String(paceMs)} ms pacing`).toBe(1);
      expect(deps.debugLines()).toEqual([]);
    }
  });

  it('a never-stable box concedes just past the time bound; a later request re-arms', () => {
    const frames = fakeFrames(8.3);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    // The arm read left 10 as the baseline. Every sampled frame reads a
    // DIFFERENT left; the bound's crossing lands when the clock first runs
    // past RESETTLE_MAX_MS — 8.3 × 120 = 996 ms still inside, 8.3 × 121 =
    // 1004.3 ms over — so the concede fires on that very pump, once.
    for (let frame = 0; frame < 120; frame += 1) {
      deps.setBox({ left: 100 + frame, top: 10, width: 200, height: 40 });
      frames.pump();
    }
    expect(deps.reformed()).toBe(0);
    expect(deps.debugLines()).toEqual([]);
    deps.setBox({ left: 220, top: 10, width: 200, height: 40 });
    frames.pump();
    expect(deps.reformed(), 'the concede applies nothing').toBe(0);
    expect(deps.debugLines()[0]).toContain('conceded');
    expect(deps.clockMs()).toBeGreaterThan(RESETTLE_MAX_MS);
    // The cycle is over regardless: no more frames were scheduled.
    expect(frames.pump()).toBe(false);
    // The re-arm rule: a later request, with the chrome now held still,
    // runs a fresh cycle that releases.
    deps.setBox({ left: 220, top: 10, width: 200, height: 40 });
    watch.request();
    frames.pump();
    expect(deps.reformed(), 'a later trigger re-arms after a concession').toBe(1);
  });

  it('a stability pair completing inside the bound releases; unchanged reads past it still release', () => {
    // Stability is the release criterion and the bound caps only the WAIT:
    // the pair lands at 16.7 × 59 ≈ 985 ms (inside) → release.
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    for (let frame = 1; frame <= 58; frame += 1) {
      deps.setBox({ left: 10 - frame, top: 10, width: 200, height: 40 });
      frames.pump();
    }
    // The box held: the 59th read equals the 58th — inside the bound.
    deps.setBox({ left: 10 - 58, top: 10, width: 200, height: 40 });
    frames.pump();
    expect(deps.reformed(), 'the pair inside the bound releases').toBe(1);

    // The same-shape case landing PAST the bound still releases: a settled
    // pair is honest at any age, and only an UNSTABLE span may be capped.
    const late = fakeFrames(16.7);
    const lateDeps = fakeDeps(late);
    const lateWatch = createContainmentWatch(lateDeps);
    lateWatch.request();
    for (let frame = 1; frame <= 59; frame += 1) {
      lateDeps.setBox({ left: 10 - frame, top: 10, width: 200, height: 40 });
      late.pump();
    }
    lateDeps.setBox({ left: 10 - 59, top: 10, width: 200, height: 40 }); // still: the equal pair lands at ≈1002 ms
    late.pump();
    expect(lateDeps.reformed(), 'a pair past the bound still releases').toBe(1);
    expect(lateDeps.debugLines()).toEqual([]);
  });

  it('stop aborts a running cycle and rejects new cycles (the teardown belt)', () => {
    const frames = fakeFrames(16.7);
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    deps.setBox({ left: 50, top: 10, width: 200, height: 40 }); // keep the cycle counting
    frames.pump();
    watch.stop();
    deps.setBox({ left: 300, top: 10, width: 200, height: 40 }); // any motion at all
    expect(frames.pump(), 'the aborted cycle scheduled nothing').toBe(false);
    expect(deps.reformed()).toBe(0);
    // A stopped watcher accepts no new cycle: a fresh request is inert.
    watch.request();
    frames.pump();
    expect(deps.reformed()).toBe(0);
  });
});
