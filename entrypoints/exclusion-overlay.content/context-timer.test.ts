/**
 * Context timers: they fire unless cancelled or invalidated, and never keep
 * an invalidation listener (nor the callback behind it) once settled.
 */
import { describe, expect, it, vi } from 'vitest';
import { contextScheduler, type TimerContext, type TimerFunctions } from './context-timer';

/** A fake context counting its live invalidation listeners. */
function fakeContext() {
  const listeners = new Set<() => void>();
  const ctx: { isValid: boolean; onInvalidated: TimerContext['onInvalidated'] } = {
    isValid: true,
    onInvalidated(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }
  };
  const invalidate = (): void => {
    ctx.isValid = false;
    for (const cb of [...listeners]) cb();
  };
  return { ctx, listeners, invalidate };
}

/** Fake platform timers run by hand. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let next = 1;
  const timers: TimerFunctions = {
    setTimeout: (run) => {
      pending.set(next, run);
      return next++;
    },
    clearTimeout: (id) => {
      pending.delete(id);
    }
  };
  const fireAll = (): void => {
    for (const [id, run] of [...pending]) {
      pending.delete(id);
      run();
    }
  };
  return { timers, pending, fireAll };
}

describe('contextScheduler', () => {
  it('fires once and then holds no listener', () => {
    const { ctx, listeners } = fakeContext();
    const { timers, fireAll } = fakeTimers();
    const run = vi.fn();
    contextScheduler(ctx, timers)(run, 0);
    expect(listeners.size).toBe(1);
    fireAll();
    expect(run).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('a cancel clears the timer and its listener', () => {
    const { ctx, listeners } = fakeContext();
    const { timers, pending, fireAll } = fakeTimers();
    const run = vi.fn();
    const cancel = contextScheduler(ctx, timers)(run, 10);
    cancel();
    fireAll();
    expect(run).not.toHaveBeenCalled();
    expect(pending.size).toBe(0);
    expect(listeners.size).toBe(0);
    // Cancelling again (or after firing) is harmless.
    cancel();
  });

  it('an invalidated context clears its timers, and a stray fire never runs', () => {
    const { ctx, invalidate } = fakeContext();
    const { timers, pending } = fakeTimers();
    const run = vi.fn();
    const schedule = contextScheduler(ctx, timers);
    schedule(run, 0);
    const stray = [...pending.values()][0];
    invalidate();
    expect(pending.size).toBe(0);
    // A timer already queued by the platform when the context went.
    stray?.();
    expect(run).not.toHaveBeenCalled();
  });

  it('keeps no listener after many slices', () => {
    const { ctx, listeners } = fakeContext();
    const { timers, fireAll } = fakeTimers();
    const schedule = contextScheduler(ctx, timers);
    for (let n = 0; n < 100; n++) schedule(() => undefined, 0);
    fireAll();
    expect(listeners.size).toBe(0);
  });
});
