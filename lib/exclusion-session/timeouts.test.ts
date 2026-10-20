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

  it('keeps the apply arm path under the overlay’s apply deadline', () => {
    const steps = SESSION_STEP_TIMEOUTS_MS;
    // wake wait + state read + cap read + arm + record write + saved-set write + push
    const armPath = steps.ready + 2 * steps.store + steps.arm + 2 * steps.store + steps.push;
    expect(armPath).toBeLessThan(EXCLUSION_SESSION_DEADLINES_MS.apply);
  });
});
