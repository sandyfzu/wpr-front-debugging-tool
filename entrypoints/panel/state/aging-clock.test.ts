/**
 * The aging clock's behavior: the cadence arms only while data is loaded
 * (and the document is visible), a visibility pause disarms without idle
 * work, coming back re-fires the reading immediately, re-arming never
 * doubles the timer, and stop releases everything once.
 */
import { describe, expect, it, vi } from 'vitest';
import { createAgingClock, type AgingClockDeps } from './aging-clock';

/**
 * A manual clock world: the schedule captures handlers (no real timers),
 * the reading and visibility are test-controlled.
 */
function manualDeps(): {
  deps: AgingClockDeps;
  /** The maturing handlers the schedule armed (latest armed last). */
  ticks: Array<() => void>;
  /** The cancel handles armed (one per arm). */
  cancels: Array<() => void>;
  /** The visibility-change handlers subscribed (callbacks fire them). */
  visibility: Array<() => void>;
  /** The clock's reading seam. */
  nowMs: { value: number };
  /** The visibility seam. */
  visible: { value: boolean };
} {
  const ticks: Array<() => void> = [];
  const cancels: Array<() => void> = [];
  const visibility: Array<() => void> = [];
  const nowMs = { value: 1_000_000 };
  const visible = { value: true };
  const deps: AgingClockDeps = {
    intervalMs: 30_000,
    schedule: (handler) => {
      ticks.push(handler);
      const cancel = vi.fn();
      cancels.push(cancel);
      return cancel;
    },
    isVisible: () => visible.value,
    onVisibilityChange: (handler) => {
      visibility.push(handler);
      return () => {
        const index = visibility.indexOf(handler);
        if (index >= 0) visibility.splice(index, 1);
      };
    },
    now: () => nowMs.value
  };
  return { deps, ticks, cancels, visibility, nowMs, visible };
}

describe('createAgingClock', () => {
  it('takes its first reading at creation', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    expect(clock.now()).toBe(1_000_000);
  });

  it('disarms until page data is loaded', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    expect(world.ticks).toHaveLength(0);
    clock.setLoaded(false);
    expect(world.ticks).toHaveLength(0);
    clock.setLoaded(true);
    expect(world.ticks).toHaveLength(1);
  });

  it('advances the reading on each tick, only while armed', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    clock.setLoaded(true);
    world.nowMs.value = 1_040_000;
    world.ticks[0]?.();
    expect(clock.now()).toBe(1_040_000);
    // Disarmed: a stray tick changes nothing (no reading work without data).
    clock.setLoaded(false);
    world.nowMs.value = 1_080_000;
    expect(clock.now()).toBe(1_040_000);
  });

  it('re-arms on load and never doubles the timer (a clean cancel first)', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    clock.setLoaded(true);
    clock.setLoaded(true);
    expect(world.ticks).toHaveLength(1);
    expect(world.cancels).toHaveLength(1);
    clock.setLoaded(false);
    // The disarm cancels the armed timer.
    expect(world.cancels[0]).toHaveBeenCalled();
    clock.setLoaded(true);
    expect(world.ticks).toHaveLength(2);
  });

  it('pauses when the document hides and resumes re-firing the reading on show', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    clock.setLoaded(true);
    expect(world.ticks).toHaveLength(1);

    // Hide: the armed timer cancels — no idle work while hidden.
    world.visible.value = false;
    world.visibility[0]?.();
    expect(world.cancels[0]).toHaveBeenCalled();

    // A tick the orphaned timer was about to fire does not reach the reading.
    world.nowMs.value = 1_100_000;
    expect(clock.now()).toBe(1_000_000);

    // Show again: the reading re-fires immediately (no up-to-one-cadence lag)
    // and the cadence re-arms.
    world.nowMs.value = 1_200_000;
    world.visible.value = true;
    world.visibility[0]?.();
    expect(clock.now()).toBe(1_200_000);
    expect(world.ticks).toHaveLength(2);
  });

  it('stays disarmed while unloaded even when visibility flips', () => {
    const world = manualDeps();
    createAgingClock(world.deps);
    world.visible.value = false;
    world.visibility[0]?.();
    world.visible.value = true;
    world.visibility[0]?.();
    expect(world.ticks).toHaveLength(0);
  });

  it('keeps the cadence when the wall clock throws mid-flight (guarded tick, logged)', () => {
    const world = manualDeps();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The seam starts healthy (creation takes its reading through it) and
    // breaks afterwards — the tick must degrade, not die.
    const broken = { value: false };
    const clock = createAgingClock({
      ...world.deps,
      now: () => {
        if (broken.value) throw new Error('clock broke');
        return world.nowMs.value;
      }
    });
    clock.setLoaded(true);
    broken.value = true;
    world.ticks[0]?.();
    expect(clock.now()).toBe(1_000_000);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Repaired: the cadence still fires and the reading follows again.
    broken.value = false;
    world.nowMs.value = 1_500_000;
    world.ticks[0]?.();
    expect(clock.now()).toBe(1_500_000);
    warnSpy.mockRestore();
  });

  it('stop releases the timer and the visibility subscription, exactly once', () => {
    const world = manualDeps();
    const clock = createAgingClock(world.deps);
    clock.setLoaded(true);
    expect(world.visibility).toHaveLength(1);
    clock.stop();
    expect(world.cancels[0]).toHaveBeenCalled();
    expect(world.visibility).toHaveLength(0);
    // Idempotent — and later lifecycle calls do nothing (no resurrection).
    clock.stop();
    clock.setLoaded(true);
    world.visible.value = false;
    world.visibility[0]?.();
    expect(world.ticks).toHaveLength(1);
  });
});
