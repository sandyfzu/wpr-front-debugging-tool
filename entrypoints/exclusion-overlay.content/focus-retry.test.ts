/**
 * The overlay's frame-retried focus move: when it retries, when it gives up,
 * and that it never takes focus from someone who claimed it.
 */
import { describe, expect, it, vi } from 'vitest';
import { lostFocusAction, retryFocus, type FocusRetryDeps } from './focus-retry';

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
    isFree: (el) => el === 'body' || el === 'builder',
    isClaimed: (el) => el === 'palette-host'
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

  it('never attempts when another surface held focus at call time', () => {
    const h = harness([true], 'palette-host');
    retryFocus(h.deps, 3);
    expect(h.flush()).toBe(1);
    expect(h.attempt).not.toHaveBeenCalled();
    expect(h.world.active).toBe('palette-host');
  });

  it('stops when another surface holds focus on a retry frame, even back at its call-time baseline', () => {
    const h = harness([false, true], 'palette-host');
    retryFocus(h.deps, 3);
    // Free on the first frame: the attempt runs (and is refused)…
    h.world.active = 'body';
    h.frames.shift()?.();
    expect(h.attempt).toHaveBeenCalledTimes(1);
    // …then the surface holds focus again before the retry frame.
    h.world.active = 'palette-host';
    expect(h.flush()).toBe(1);
    expect(h.attempt).toHaveBeenCalledTimes(1);
    expect(h.world.active).toBe('palette-host');
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %s tries', (tries) => {
    const h = harness([]);
    expect(() => {
      retryFocus(h.deps, tries);
    }).toThrow(RangeError);
  });
});

describe('lostFocusAction', () => {
  it('keeps waiting while the last focused control is still mounted', () => {
    expect(lostFocusAction(false, null, 'body', 'html')).toBe('keep');
    expect(lostFocusAction(false, 'strip-host', 'body', 'html')).toBe('keep');
    expect(lostFocusAction(false, 'body', 'body', 'html')).toBe('keep');
  });

  it('reclaims when the control is gone and focus fell to the page', () => {
    expect(lostFocusAction(true, 'body', 'body', 'html')).toBe('reclaim');
    expect(lostFocusAction(true, null, 'body', 'html')).toBe('reclaim');
    expect(lostFocusAction(true, 'html', 'body', 'html')).toBe('reclaim');
  });

  it('forgets the loss when another UI holds focus (an injected strip reads as its host)', () => {
    expect(lostFocusAction(true, 'strip-host', 'body', 'html')).toBe('forget');
    expect(lostFocusAction(true, 'page-input', 'body', 'html')).toBe('forget');
  });

  it('reads a body-less document (XHTML, SVG) focused on its root element as nothing focused', () => {
    expect(lostFocusAction(true, null, null, 'svg')).toBe('reclaim');
    expect(lostFocusAction(true, 'svg', null, 'svg')).toBe('reclaim');
    expect(lostFocusAction(true, 'page-input', null, 'svg')).toBe('forget');
  });
});
