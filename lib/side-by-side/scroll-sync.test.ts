/**
 * The scroll-sync engine contract: the proportional mapping matrix (the
 * plan's pinned cases), the refusal of broken reads, and the burst driver's
 * suppression semantics over injected halves and a hand-flushed clock.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  COMPARE_SIDES,
  computeSyncTarget,
  createScrollSyncDriver,
  otherSide,
  type CompareSide,
  type FrameScrollState,
  type ScrollSyncClock,
  type ScrollSyncDriver,
  type ScrollSyncHalf
} from './scroll-sync';

describe('computeSyncTarget', () => {
  it('is identity across equal ranges', () => {
    expect(computeSyncTarget({ y: 50, range: 100 }, { y: 0, range: 100 })).toBe(50);
  });

  it('maps proportionally across differing ranges', () => {
    expect(computeSyncTarget({ y: 500, range: 1000 }, { y: 0, range: 200 })).toBe(100);
    expect(computeSyncTarget({ y: 250, range: 1000 }, { y: 0, range: 200 })).toBe(50);
  });

  it('clamps at both edges of the target range', () => {
    expect(computeSyncTarget({ y: 0, range: 1000 }, { y: 30, range: 200 })).toBe(0);
    expect(computeSyncTarget({ y: 1000, range: 1000 }, { y: 30, range: 200 })).toBe(200);
  });

  it('rounds half up (rounding direction pinned)', () => {
    // 0.375 × 4 = 1.5 → 2
    expect(computeSyncTarget({ y: 3, range: 8 }, { y: 0, range: 4 })).toBe(2);
    // 0.333… × 4 = 1.33… → 1
    expect(computeSyncTarget({ y: 3, range: 9 }, { y: 0, range: 4 })).toBe(1);
  });

  it('accepts fractional positions within bounds', () => {
    expect(computeSyncTarget({ y: 0.5, range: 1 }, { y: 0, range: 10 })).toBe(5);
  });

  it('never drives from a zero-range source', () => {
    expect(computeSyncTarget({ y: 0, range: 0 }, { y: 0, range: 100 })).toBeNull();
  });

  it('applies nothing onto a zero-range target', () => {
    expect(computeSyncTarget({ y: 50, range: 100 }, { y: 0, range: 0 })).toBeNull();
  });

  it('refuses broken reads, naming the offending half and value', () => {
    expect(() => computeSyncTarget({ y: Number.NaN, range: 100 }, { y: 0, range: 100 })).toThrow(
      /source\.y.*NaN/
    );
    expect(() => computeSyncTarget({ y: 0, range: Number.NaN }, { y: 0, range: 100 })).toThrow(
      /source\.range/
    );
    expect(() =>
      computeSyncTarget({ y: 0, range: 100 }, { y: 0, range: Number.POSITIVE_INFINITY })
    ).toThrow(/target\.range/);
    expect(() => computeSyncTarget({ y: -1, range: 100 }, { y: 0, range: 100 })).toThrow(
      /source\.y/
    );
    expect(() => computeSyncTarget({ y: 0, range: -5 }, { y: 0, range: 100 })).toThrow(
      /source\.range/
    );
    expect(() => computeSyncTarget({ y: 101, range: 100 }, { y: 0, range: 100 })).toThrow(
      /source\.y.*101/
    );
  });
});

describe('otherSide / COMPARE_SIDES', () => {
  it('pairs the two fixed halves', () => {
    expect(otherSide('cached')).toBe('bypassed');
    expect(otherSide('bypassed')).toBe('cached');
    expect(COMPARE_SIDES).toEqual(['cached', 'bypassed']);
  });
});

/**
 * A controllable half. Exposed with property signatures (not method
 * signatures) so assertions can reference the mock fns directly.
 */
interface FakeHalf extends ScrollSyncHalf {
  /** Redeclared as properties so referencing the mock in assertions is bound-safe by type. */
  read: () => FrameScrollState | null;
  apply: (y: number) => void;
  applied: number[];
  reads: number;
  /** Make the half unreadable from now on (a blocked or torn half). */
  block(): void;
  /** Change the state the next read returns. */
  set(next: FrameScrollState): void;
}

function createFakeHalf(state: FrameScrollState): FakeHalf {
  const applied: number[] = [];
  let reads = 0;
  let current: FrameScrollState | null = state;
  return {
    applied,
    get reads() {
      return reads;
    },
    block() {
      current = null;
    },
    set(next) {
      current = next;
    },
    read: vi.fn((): FrameScrollState | null => {
      reads += 1;
      return current;
    }),
    apply: vi.fn((y: number): void => {
      applied.push(y);
      if (current !== null) current = { ...current, y };
    })
  };
}

/** A clock whose queued animation frames run by hand, in queue order. */
interface FakeClock extends ScrollSyncClock {
  /** Run every queued callback (and only those — callbacks enqueued by them wait for the next flush). */
  flush(): void;
}

function createFakeClock(): FakeClock {
  let queue: Array<() => void> = [];
  return {
    nextFrame(callback: () => void): void {
      queue.push(callback);
    },
    /** Run every queued callback (and only those — callbacks enqueued by them wait for the next flush). */
    flush(): void {
      const run = queue;
      queue = [];
      for (const callback of run) callback();
    }
  };
}

/** One driver round over two named halves and a hand-flushed clock. */
function setupDriver(
  cached: FrameScrollState,
  bypassed: FrameScrollState
): {
  cachedHalf: FakeHalf;
  bypassedHalf: FakeHalf;
  driver: ScrollSyncDriver;
  clock: FakeClock;
  scroll: (side: CompareSide) => void;
} {
  const cachedHalf = createFakeHalf(cached);
  const bypassedHalf = createFakeHalf(bypassed);
  const clock = createFakeClock();
  const driver = createScrollSyncDriver({ cached: cachedHalf, bypassed: bypassedHalf }, clock);
  return {
    cachedHalf,
    bypassedHalf,
    driver,
    clock,
    scroll: (side: CompareSide): void => {
      driver.onScroll(side);
    }
  };
}

describe('createScrollSyncDriver', () => {
  it('coalesces a scroll burst into one application per frame', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    scroll('cached');
    scroll('cached');
    clock.flush();
    expect(bypassedHalf.apply).toHaveBeenCalledTimes(1);
    expect(bypassedHalf.applied).toEqual([0]);
    expect(cachedHalf.apply).not.toHaveBeenCalled();
  });

  it('drives from the newest scrolled side when both scroll within one frame', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    scroll('bypassed');
    clock.flush();
    // bypassed drives: cached is repositioned, bypassed's echo is suppressed.
    expect(cachedHalf.apply).toHaveBeenCalledTimes(1);
    expect(bypassedHalf.apply).not.toHaveBeenCalled();
  });

  it('the applied position never re-triggers: the echo is ignored inside the window', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    clock.flush();
    expect(bypassedHalf.applied).toEqual([0]);
    // The programmatic application's own echo, plus any further scroll while
    // suppressed, produce no burst at all.
    scroll('bypassed');
    scroll('bypassed');
    clock.flush();
    expect(bypassedHalf.apply).toHaveBeenCalledTimes(1);
    expect(cachedHalf.apply).not.toHaveBeenCalled();
  });

  it('the next user scroll after the window closes retakes driver control', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    clock.flush();
    // Two frames close the suppression window.
    clock.flush();
    clock.flush();
    bypassedHalf.set({ y: 60, range: 200 });
    scroll('bypassed');
    clock.flush();
    expect(cachedHalf.applied).toEqual([30]);
  });

  it('continuous driving keeps the window open; a newer application wins its clear', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    clock.flush(); // burst 1 applies bypassed (epoch 1)
    scroll('cached');
    clock.flush(); // burst 2 applies bypassed again (epoch 2)
    expect(bypassedHalf.applied).toEqual([0, 0]);
    // Both clears flush; only the newest epoch's clear closes the window.
    clock.flush();
    clock.flush();
    scroll('bypassed');
    clock.flush();
    expect(cachedHalf.applied).toEqual([0]);
  });

  it('a zero-range source applies nothing and suppresses nothing (no loop from echoes)', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 0 },
      { y: 40, range: 200 }
    );
    scroll('cached');
    clock.flush();
    expect(bypassedHalf.apply).not.toHaveBeenCalled();
    // The receiving half's echo drives back, but maps onto the unscrollable
    // source — also nothing. The pair stays quiet, never oscillating.
    scroll('bypassed');
    clock.flush();
    expect(cachedHalf.apply).not.toHaveBeenCalled();
  });

  it('an unreadable half cannot drive a burst', () => {
    const { scroll, clock, cachedHalf, bypassedHalf } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    cachedHalf.block();
    scroll('cached');
    clock.flush();
    expect(bypassedHalf.apply).not.toHaveBeenCalled();
  });

  it('dispose makes pending and future steps no-ops', () => {
    const { scroll, clock, cachedHalf, bypassedHalf, driver } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    driver.dispose();
    expect(() => {
      clock.flush();
    }).not.toThrow();
    expect(bypassedHalf.apply).not.toHaveBeenCalled();
    scroll('bypassed');
    clock.flush();
    expect(cachedHalf.apply).not.toHaveBeenCalled();
  });

  it('reads both halves fresh every burst (no cached metrics)', () => {
    const { scroll, clock, cachedHalf, bypassedHalf, driver } = setupDriver(
      { y: 0, range: 100 },
      { y: 0, range: 200 }
    );
    scroll('cached');
    clock.flush();
    const readsAfterFirst = cachedHalf.reads + bypassedHalf.reads;
    cachedHalf.set({ y: 50, range: 100 }); // e.g. the half refreshed and re-reads differently
    scroll('cached');
    clock.flush();
    expect(bypassedHalf.applied).toEqual([0, 100]);
    expect(cachedHalf.reads + bypassedHalf.reads).toBe(readsAfterFirst + 2);
    driver.dispose();
  });
});

describe('the proportional map converges, never fights (the resize-clamp property)', () => {
  /**
   * The engine's mapping exactly: a source read at `y` within `sourceRange`,
   * projected onto a `targetRange` half. Ranges ≥ 1 in these sweeps, so the
   * zero-range null branch is unreachable here.
   */
  const project = (y: number, sourceRange: number, targetRange: number): number => {
    const mapped = computeSyncTarget({ y, range: sourceRange }, { y: 0, range: targetRange });
    if (mapped === null)
      throw new Error(`unreachable: ranges ${String(sourceRange)}/${String(targetRange)}`);
    return mapped;
  };

  it('one rebalanced round trip is final — a further round trip moves nothing, either direction (swept)', () => {
    for (let source = 1; source <= 150; source += 7) {
      for (let target = 1; target <= 150; target += 7) {
        for (let y = 0; y <= source; y++) {
          const mapped = project(y, source, target); // the source half drives
          const echoed = project(mapped, target, source); // the receiver's position, mapped from its side
          expect(project(echoed, source, target)).toBe(mapped);
        }
        for (let y = 0; y <= target; y++) {
          const mapped = project(y, target, source); // the receiver half drives
          const echoed = project(mapped, source, target);
          expect(project(echoed, target, source)).toBe(mapped);
        }
      }
    }
  });

  it('a round trip is NOT position-preserving at extreme range disparities — tolerance is the target rounding granularity', () => {
    expect(project(208, 416, 1)).toBe(1); // a 416:1 disparity quantizes the projection
    expect(project(1, 1, 416)).toBe(416); // the trip back drifts to the extreme…
    expect(project(416, 416, 1)).toBe(1); // …but the next trip moves nothing: the pair is settled
  });

  it('mirrors exactly across equal ranges', () => {
    for (let position = 0; position <= 300; position++) {
      expect(project(position, 300, 300)).toBe(position);
    }
  });
});
