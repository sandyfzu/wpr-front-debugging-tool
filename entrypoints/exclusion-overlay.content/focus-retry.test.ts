import { describe, expect, it, vi } from 'vitest';
import { retryFocus, type FocusRetryDeps } from './focus-retry';

/** A manual frame queue plus a scripted focus world. */
function harness(outcomes: (boolean | undefined)[], startActive = 'body') {
  const frames: (() => void)[] = [];
  const world = { active: startActive };
  const attempt = vi.fn(() => {
    const next = outcomes.shift();
    if (next === true) world.active = 'builder';
    return next;
  });
  const deps: FocusRetryDeps<string> = {
    requestFrame: (run) => frames.push(run),
    attempt,
    active: () => world.active,
    isFree: (el) => el === 'body' || el === 'builder'
  };
  /** Runs queued frames until none are left; returns how many ran. */
  const flush = (): number => {
    let ran = 0;
    for (let run = frames.shift(); run; run = frames.shift()) {
      run();
      ran += 1;
    }
    return ran;
  };
  return { deps, world, attempt, frames, flush };
}

describe('retryFocus', () => {
  it('waits a frame, then focuses once when the first attempt takes', () => {
    const h = harness([true]);
    retryFocus(h.deps, 3);
    expect(h.attempt).not.toHaveBeenCalled();
    expect(h.flush()).toBe(1);
    expect(h.attempt).toHaveBeenCalledTimes(1);
  });

  it('retries on the next frames until the move takes', () => {
    const h = harness([false, false, true]);
    retryFocus(h.deps, 5);
    expect(h.flush()).toBe(3);
    expect(h.world.active).toBe('builder');
  });

  it('stops at its cap when the move never takes', () => {
    const h = harness([false, false, false, false]);
    retryFocus(h.deps, 3);
    expect(h.flush()).toBe(3);
    expect(h.attempt).toHaveBeenCalledTimes(3);
  });

  it('gives up when there is nothing to focus', () => {
    const h = harness([undefined, true]);
    retryFocus(h.deps, 3);
    expect(h.flush()).toBe(1);
  });

  it('stops once another UI claimed focus between frames, never stealing it', () => {
    const h = harness([false, true]);
    retryFocus(h.deps, 3);
    h.frames.shift()?.();
    h.world.active = 'palette';
    expect(h.flush()).toBe(1);
    expect(h.attempt).toHaveBeenCalledTimes(1);
    expect(h.world.active).toBe('palette');
  });

  it('does not attempt at all when focus was claimed before its first frame', () => {
    const h = harness([true]);
    retryFocus(h.deps, 3);
    h.world.active = 'palette';
    h.flush();
    expect(h.attempt).not.toHaveBeenCalled();
  });

  it('keeps going when focus fell back to the body (a hidden control blurred)', () => {
    const h = harness([false, true], 'builder');
    retryFocus(h.deps, 3);
    h.world.active = 'body';
    expect(h.flush()).toBe(2);
    expect(h.world.active).toBe('builder');
  });

  it('takes over focus that sat where it was at call time (a page control)', () => {
    const h = harness([false, true], 'page-input');
    retryFocus(h.deps, 3);
    expect(h.flush()).toBe(2);
    expect(h.world.active).toBe('builder');
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %s tries', (tries) => {
    const h = harness([]);
    expect(() => {
      retryFocus(h.deps, tries);
    }).toThrow(RangeError);
  });
});
