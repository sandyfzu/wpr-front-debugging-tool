/**
 * Context timers: they fire unless cancelled or invalidated, and never keep
 * an invalidation listener (nor the callback behind it) once settled.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  WINDOW_FRAMES,
  WINDOW_TIMERS,
  contextFrames,
  contextScheduler,
  type FrameFunctions,
  type TimerContext,
  type TimerFunctions
} from './context-timers';

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

describe('contextFrames', () => {
  it('runs on the next frame, then holds no listener; a cancel or an invalidation stops it', () => {
    const { ctx, listeners, invalidate } = fakeContext();
    const { timers, pending, fireAll } = fakeTimers();
    const frames: FrameFunctions = {
      requestAnimationFrame: (run) => timers.setTimeout(run, 0),
      cancelAnimationFrame: (id) => {
        timers.clearTimeout(id);
      }
    };
    const nextFrame = contextFrames(ctx, frames);
    const run = vi.fn();
    nextFrame(run);
    const cancelled = vi.fn();
    nextFrame(cancelled)();
    fireAll();
    expect(run).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
    const late = vi.fn();
    nextFrame(late);
    invalidate();
    expect(pending.size).toBe(0);
    expect(late).not.toHaveBeenCalled();
  });
});

describe('the window seams', () => {
  it('schedule and cancel on the window', async () => {
    const ran = vi.fn();
    WINDOW_TIMERS.clearTimeout(WINDOW_TIMERS.setTimeout(ran, 0));
    WINDOW_FRAMES.cancelAnimationFrame(WINDOW_FRAMES.requestAnimationFrame(ran));
    const fired = await new Promise<boolean>((resolve) => {
      WINDOW_FRAMES.requestAnimationFrame(() => {
        WINDOW_TIMERS.setTimeout(() => {
          resolve(true);
        }, 0);
      });
    });
    expect(fired).toBe(true);
    expect(ran).not.toHaveBeenCalled();
  });
});
