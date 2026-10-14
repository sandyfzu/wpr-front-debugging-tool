/**
 * The containment re-settle watcher: settle-sensing over fake frames — the
 * arm's synchronous sample is the baseline, a still box releases on its
 * first pumped frame, an animating box waits (and its requests coalesce),
 * dead shapes/contexts stop the cycle, the frame bound concedes without
 * applying, and `stop` aborts running cycles and rejects new ones.
 */
import { describe, expect, it } from 'vitest';
import type { DragBox } from './drag';
import { createContainmentWatch, RESETTLE_MAX_FRAMES } from './containment';
import type { ContainmentWatchDeps } from './containment';

/** A fake frame queue: callbacks run only when pumped. */
function fakeFrames(): { nextFrame: (cb: () => void) => void; pump(): boolean } {
  const queue: Array<() => void> = [];
  return {
    nextFrame: (cb) => {
      queue.push(cb);
    },
    // Pump one queued frame; says whether another frame stayed queued.
    pump(): boolean {
      const cb = queue.shift();
      if (cb !== undefined) cb();
      return queue.length > 0;
    }
  };
}

/**
 * The recording seams: a settable box, a settable invalidation flag, and the
 * counters the pins read. The state object was made before the seams so
 * every referenced closure shares one truth.
 */
interface Recorded extends ContainmentWatchDeps {
  setBox(box: DragBox | null): void;
  setInvalid(value: boolean): void;
  reformed(): number;
  debugLines(): string[];
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
    debugLines: () => state.debug
  };
}

describe('createContainmentWatch', () => {
  it('a still box releases on its first pumped frame; the cycle ends after that', () => {
    const frames = fakeFrames();
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
    const frames = fakeFrames();
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request(); // reads the pre-motion box as the baseline
    // The card's open choreography under the reader: every pumped frame the
    // box has moved (30 distinct reads keep the frame budget below concede).
    for (let frame = 1; frame <= 30; frame += 1) {
      deps.setBox({ left: 10 - frame, top: 10 - frame, width: 200, height: 40 });
      expect(deps.reformed()).toBe(0);
      frames.pump();
    }
    // The spring ended: the third consecutive equal read is release work.
    deps.setBox({ left: -20, top: -20, width: 200, height: 40 });
    frames.pump(); // reads the settled box (differs from the 30th read) → keeps waiting
    deps.setBox({ left: -20, top: -20, width: 200, height: 40 });
    frames.pump();
    expect(deps.reformed(), 'the release fires exactly after box stability').toBe(1);
    expect(deps.debugLines()).toEqual([]);
  });

  it('requests during a running cycle coalesce (one release for the whole motion)', () => {
    const frames = fakeFrames();
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
    const frames = fakeFrames();
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

  it('a never-stable box concedes at the frame bound without releasing', () => {
    const frames = fakeFrames();
    const deps = fakeDeps(frames);
    const watch = createContainmentWatch(deps);
    watch.request();
    // The arm read left 10; every sampled frame reads a DIFFERENT left, so
    // no consecutive pair ever agrees: the cycle concedes without a release
    // (a later trigger would have to re-arm it).
    for (let frame = 0; frame < RESETTLE_MAX_FRAMES; frame += 1) {
      deps.setBox({ left: 100 + frame, top: 10, width: 200, height: 40 });
      frames.pump();
    }
    expect(deps.reformed()).toBe(0);
    expect(deps.debugLines()[0]).toContain('conceded');
    // The cycle is over regardless: no more frames were scheduled.
    expect(frames.pump()).toBe(false);
  });

  it('stop aborts a running cycle and rejects new cycles (the teardown belt)', () => {
    const frames = fakeFrames();
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
