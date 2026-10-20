/**
 * The deadline helper (settle, reject, time out, late settlements, sync
 * throws, default timer) and the declared host bounds' arithmetic.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import { EXCLUSION_SESSION_DEADLINES_MS } from '../messaging/exclusion-session';
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './document-transform';
import {
  DeadlineExceededError,
  INTERCEPTION_HOST_BOUNDS_MS,
  SESSION_ASK_WORST_CASE_MS,
  SESSION_STEP_TIMEOUTS_MS,
  withinDeadline
} from './timeouts';

/** A timer seam whose single pending timer fires on demand. */
function oneTimer(): { schedule: ScheduleTimer; fire: () => void; cancelled: () => boolean } {
  let pending: (() => void) | null = null;
  let cancelled = false;
  return {
    schedule: (run) => {
      pending = run;
      return () => {
        cancelled = true;
        pending = null;
      };
    },
    fire: () => {
      pending?.();
    },
    cancelled: () => cancelled
  };
}

describe('withinDeadline', () => {
  it('resolves with the step and cancels its timer', async () => {
    const timer = oneTimer();
    await expect(withinDeadline('x', 5, () => Promise.resolve(7), timer.schedule)).resolves.toBe(7);
    expect(timer.cancelled()).toBe(true);
  });

  it('passes a rejection through unchanged (non-Error values included)', async () => {
    const timer = oneTimer();
    const boom = new Error('boom');
    await expect(withinDeadline('x', 5, () => Promise.reject(boom), timer.schedule)).rejects.toBe(
      boom
    );
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error rejection is the case under test
    await expect(withinDeadline('x', 5, () => Promise.reject('raw'), timer.schedule)).rejects.toBe(
      'raw'
    );
    expect(timer.cancelled()).toBe(true);
  });

  it('turns a synchronous throw into a rejection', async () => {
    const boom = new Error('sync');
    await expect(
      withinDeadline(
        'x',
        5,
        () => {
          throw boom;
        },
        oneTimer().schedule
      )
    ).rejects.toBe(boom);
  });

  it('rejects with DeadlineExceededError naming the step; a late settlement is ignored', async () => {
    const timer = oneTimer();
    let settle: (value: number) => void = () => undefined;
    const late = new Promise<number>((resolve) => {
      settle = resolve;
    });
    const bounded = withinDeadline('Backend arm', 42, () => late, timer.schedule);
    timer.fire();
    const error = await bounded.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(DeadlineExceededError);
    expect(error).toMatchObject({
      step: 'Backend arm',
      ms: 42,
      message: 'Backend arm did not settle within 42 ms'
    });
    settle(1); // no effect, no unhandled rejection
    await late;
  });

  it('swallows a late rejection after the deadline (no unhandled rejection)', async () => {
    const timer = oneTimer();
    let fail: (cause: Error) => void = () => undefined;
    const late = new Promise<number>((_resolve, reject) => {
      fail = reject;
    });
    const bounded = withinDeadline('x', 1, () => late, timer.schedule);
    timer.fire();
    await expect(bounded).rejects.toBeInstanceOf(DeadlineExceededError);
    fail(new Error('late'));
    await expect(late).rejects.toThrow('late');
  });

  it('uses the platform timer by default', async () => {
    vi.useFakeTimers();
    try {
      const bounded = withinDeadline('x', 10, () => new Promise<never>(() => undefined));
      const settled = bounded.catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(10);
      await expect(settled).resolves.toBeInstanceOf(DeadlineExceededError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('declared bounds', () => {
  it('derives each host bound from the steps it awaits', () => {
    const steps = SESSION_STEP_TIMEOUTS_MS;
    expect(INTERCEPTION_HOST_BOUNDS_MS).toEqual({
      shouldIntercept: steps.ready + steps.store,
      rewriteDocument:
        steps.ready + 2 * steps.store + DOCUMENT_TRANSFORM_BUDGET_MS + steps.runnerOverhead,
      documentBodyUnavailable: steps.ready + steps.store + steps.record,
      interceptionEnded: steps.ready + steps.record
    });
  });

  /** Each ask path, step by step (the worst of them is the declared worst case). */
  const steps = SESSION_STEP_TIMEOUTS_MS;
  const before = steps.ready + steps.queueWait;
  const APPLY_PATHS: Record<string, number> = {
    // read + cap read + arm + record write + saved-set write + push
    armed: before + 2 * steps.store + steps.arm + 2 * steps.store + steps.push,
    // read + cap read + arm (or its timeout) + disarm + warning write + push
    unavailable: before + 2 * steps.store + steps.arm + steps.disarm + steps.store + steps.push,
    // … the warning write failed: + re-read
    'unavailable, write failed':
      before + 2 * steps.store + steps.arm + steps.disarm + 2 * steps.store + steps.push,
    // read + cap read + arm + record write refused at the cap + disarm + warning write + re-read + push
    'store-side cap':
      before +
      2 * steps.store +
      steps.arm +
      steps.store +
      steps.disarm +
      2 * steps.store +
      steps.push,
    // read + cap read + arm throws + disarm + removal + re-read + push
    'arm-failed':
      before + 2 * steps.store + steps.arm + steps.disarm + 2 * steps.store + steps.push,
    // read + cap read (at the cap) + disarm + warning write + re-read + push
    'cap pre-check': before + 2 * steps.store + steps.disarm + 2 * steps.store + steps.push
  };
  const STOP_PATHS: Record<string, number> = {
    stopped: before + steps.store + steps.disarm + steps.store + steps.push,
    'removal failed': before + steps.store + steps.disarm + 2 * steps.store + steps.push
  };

  it('declares each ask’s worst case as the max of its paths', () => {
    expect(SESSION_ASK_WORST_CASE_MS.apply).toBe(Math.max(...Object.values(APPLY_PATHS)));
    expect(SESSION_ASK_WORST_CASE_MS.stop).toBe(Math.max(...Object.values(STOP_PATHS)));
    expect(SESSION_ASK_WORST_CASE_MS.status).toBe(before + steps.store);
  });

  it.each([
    ...Object.entries(APPLY_PATHS).map(([path, ms]) => ['apply', path, ms] as const),
    ...Object.entries(STOP_PATHS).map(([path, ms]) => ['stop', path, ms] as const),
    ['status', 'read', SESSION_ASK_WORST_CASE_MS.status] as const
  ])('keeps the %s path “%s” under 90 %% of the sender’s deadline', (ask, _path, ms) => {
    expect(ms).toBeLessThan(0.9 * EXCLUSION_SESSION_DEADLINES_MS[ask]);
  });
});
