/**
 * The deadline helper (settle, reject, time out, late settlements, sync
 * throws, default timer) and the declared host bounds' arithmetic.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ScheduleTimer } from '../messaging/bounded-ask';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../exclusion-builder/set';
import { analysisWorkBudget, analyzeRegexRisk } from '../exclusion-builder/regex-risk';
import { prevalidateExclusionSet } from '../exclusion-builder/validate';
import {
  EXCLUSION_SESSION_DEADLINES_MS,
  EXCLUSION_SET_LIMITS
} from '../messaging/exclusion-session';
import { DOCUMENT_TRANSFORM_BUDGET_MS } from './document-transform';
import {
  DeadlineExceededError,
  INTERCEPTION_HOST_BOUNDS_MS,
  PREVALIDATION_CPU_BOUND_MS,
  PREVALIDATION_FIXED_MS,
  PREVALIDATION_NS_PER_WORK_UNIT,
  PREVALIDATION_WORK_BOUND,
  SESSION_ASK_WORST_CASE_MS,
  SESSION_STEP_TIMEOUTS_MS,
  SIMULATION_PREPARATION_BOUND_MS,
  SIMULATION_PREPARATION_CPU_BOUND_MS,
  SIMULATION_SOURCE_TIMEOUTS_MS,
  rewriteDocumentBoundMs,
  withinDeadline,
  withinExtensibleDeadline
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

/** A timer seam firing pending timers by delay, recording every armed one. */
function delayTimers(): {
  schedule: ScheduleTimer;
  fire: (ms: number) => void;
  pending: () => number[];
} {
  const timers = new Set<{ run: () => void; ms: number }>();
  return {
    schedule: (run, ms) => {
      const timer = { run, ms };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    fire: (ms) => {
      for (const timer of [...timers]) {
        if (timer.ms !== ms) continue;
        timers.delete(timer);
        timer.run();
      }
    },
    pending: () => [...timers].map((timer) => timer.ms)
  };
}

describe('withinExtensibleDeadline', () => {
  const never = (): Promise<number> => new Promise<number>(() => undefined);

  it('times out at the base deadline when the work never extends it', async () => {
    const timers = delayTimers();
    const bounded = withinExtensibleDeadline('x', 5, 9, never, timers.schedule);
    expect(timers.pending()).toEqual([9, 5]);
    timers.fire(5);
    await expect(bounded).rejects.toMatchObject({ name: 'DeadlineExceededError', ms: 5 });
    // Settled: every timer cancelled.
    expect(timers.pending()).toEqual([]);
  });

  it('outlives the base deadline once extended, then times out at the extended one', async () => {
    const timers = delayTimers();
    const bounded = withinExtensibleDeadline(
      'x',
      5,
      9,
      (extend) => {
        extend();
        return never();
      },
      timers.schedule
    );
    timers.fire(5);
    timers.fire(9);
    await expect(bounded).rejects.toMatchObject({ name: 'DeadlineExceededError', ms: 9 });
    expect(timers.pending()).toEqual([]);
  });

  it('resolves with the work and cancels both timers', async () => {
    const timers = delayTimers();
    await expect(
      withinExtensibleDeadline('x', 5, 9, () => Promise.resolve(7), timers.schedule)
    ).resolves.toBe(7);
    expect(timers.pending()).toEqual([]);
  });

  it('passes a rejection or a synchronous throw through unchanged', async () => {
    const timers = delayTimers();
    const boom = new Error('boom');
    await expect(
      withinExtensibleDeadline('x', 5, 9, () => Promise.reject(boom), timers.schedule)
    ).rejects.toBe(boom);
    await expect(
      withinExtensibleDeadline(
        'x',
        5,
        9,
        () => {
          throw boom;
        },
        timers.schedule
      )
    ).rejects.toBe(boom);
    expect(timers.pending()).toEqual([]);
  });

  it('refuses an extended deadline below its base', () => {
    expect(() => withinExtensibleDeadline('x', 9, 5, never)).toThrow(RangeError);
  });

  it('uses the platform timer by default', async () => {
    vi.useFakeTimers();
    try {
      const settled = withinExtensibleDeadline('x', 10, 20, never).catch((cause: unknown) => cause);
      await vi.advanceTimersByTimeAsync(10);
      await expect(settled).resolves.toMatchObject({ ms: 10 });
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
      // Exclusions only — exactly the bound before simulation existed.
      rewriteDocument:
        steps.ready + 2 * steps.store + DOCUMENT_TRANSFORM_BUDGET_MS + steps.runnerOverhead,
      documentBodyUnavailable: steps.ready + steps.store + steps.record,
      documentNotServed: steps.ready + steps.store + steps.record,
      interceptionEnded: steps.ready + steps.record
    });
  });

  it('adds the simulation preparation to the rewrite bound only for a simulating session', () => {
    expect(rewriteDocumentBoundMs(false)).toBe(INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument);
    expect(rewriteDocumentBoundMs(true)).toBe(
      INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument + SIMULATION_PREPARATION_BOUND_MS
    );
  });

  it('bounds a simulation preparation by every awaited source deadline plus its CPU', () => {
    const sources = SIMULATION_SOURCE_TIMEOUTS_MS;
    expect(SIMULATION_PREPARATION_BOUND_MS).toBe(
      sources.runtime +
        sources.list +
        sources.markerId +
        sources.settleMarker +
        SIMULATION_PREPARATION_CPU_BOUND_MS
    );
    // The stored-copy read and the memo writes are one store step each.
    expect(sources.list).toBe(SESSION_STEP_TIMEOUTS_MS.store);
    expect(sources.markerId).toBe(SESSION_STEP_TIMEOUTS_MS.store);
    expect(sources.settleMarker).toBe(SESSION_STEP_TIMEOUTS_MS.store);
    // ≥ 10× the ~58 ms measured on a 4 MiB page.
    expect(SIMULATION_PREPARATION_CPU_BOUND_MS).toBeGreaterThanOrEqual(580);
  });

  /** Each ask path, step by step (the worst of them is the declared worst case). */
  const steps = SESSION_STEP_TIMEOUTS_MS;
  const before = steps.ready + steps.queueWait;
  const prevalidated = before + PREVALIDATION_CPU_BOUND_MS;
  const APPLY_PATHS: Record<string, number> = {
    // read + cap read + arm + record write + saved-set write + push
    armed: prevalidated + 2 * steps.store + steps.arm + 2 * steps.store + steps.push,
    // read + cap read + arm (or its timeout) + disarm + warning write + push
    unavailable:
      prevalidated + 2 * steps.store + steps.arm + steps.disarm + steps.store + steps.push,
    // … the warning write failed: + re-read
    'unavailable, write failed':
      prevalidated + 2 * steps.store + steps.arm + steps.disarm + 2 * steps.store + steps.push,
    // read + cap read + arm + record write refused at the cap + disarm + warning write + re-read + push
    'store-side cap':
      prevalidated +
      2 * steps.store +
      steps.arm +
      steps.store +
      steps.disarm +
      2 * steps.store +
      steps.push,
    // read + cap read + arm throws + disarm + removal + re-read + push
    'arm-failed':
      prevalidated + 2 * steps.store + steps.arm + steps.disarm + 2 * steps.store + steps.push,
    // read + cap read (at the cap) + disarm + warning write + re-read + push
    'cap pre-check': prevalidated + 2 * steps.store + steps.disarm + 2 * steps.store + steps.push
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

describe('prevalidation CPU', () => {
  /**
   * A cap-sized adversarial set: distinct rows filling the whole char
   * budget, each `prefix` + as many units as fit + `suffix`.
   */
  function capSizedSet(
    unitFor: (row: number, index: number) => string,
    [prefix, suffix]: readonly [string, string]
  ): ExclusionSet {
    const rowChars = EXCLUSION_SET_LIMITS.rowChars - 4;
    const rowCount = Math.floor(EXCLUSION_SET_LIMITS.totalChars / EXCLUSION_SET_LIMITS.rowChars);
    const rows = Array.from({ length: rowCount }, (_, row) => {
      let body = '';
      for (let index = 0; ; index++) {
        const unit = unitFor(row, index);
        if (prefix.length + body.length + unit.length + suffix.length > rowChars) break;
        body += unit;
      }
      return `${prefix}${body}${suffix}`;
    });
    return {
      rows: {
        ...EMPTY_EXCLUSION_SET.rows,
        delayJs: rows.slice(0, rowCount / 2),
        deferJs: rows.slice(rowCount / 2)
      },
      disable: EMPTY_EXCLUSION_SET.disable
    };
  }

  /** A `\uXXXX` escape for a code unit. */
  const escape = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;

  const CASE_SCOPE = ['(?i:', ')'] as const;
  it.each([
    [
      'distinct negated classes',
      (row: number, index: number) => `[^${escape(((row * 400 + index) % 0xfffe) + 1)}]`,
      CASE_SCOPE,
      null
    ],
    [
      'distinct mid-size ranges',
      (row: number, index: number) => `[A-${escape(0x2000 + row * 400 + index)}]`,
      CASE_SCOPE,
      'too-complex'
    ],
    [
      'distinct half-range classes',
      (row: number, index: number) => `[\\u0000-${escape(0x7000 + row * 400 + index)}]`,
      CASE_SCOPE,
      'too-complex'
    ],
    [
      'looped nullable sequences of scattered units',
      (row: number, index: number) => `${escape(0x3000 + 2 * (row * 400 + index))}?`,
      ['(?i:(?:\\u00ff', ')*)'],
      null
    ],
    [
      'looped alternations of huge zero-width repeats',
      (row: number, index: number) => `(?:\\b){2000000000}${escape(0x100 + row * 400 + index)}|`,
      ['(?:', 'q)+'],
      null
    ],
    [
      'looped alternations of huge empty repeats',
      (row: number, index: number) => `(?:){100000000}${escape(0x100 + row * 400 + index)}|`,
      ['(?:', 'q)+'],
      null
    ],
    [
      'looped alternations sharing a prefix',
      (row: number, index: number) => `p${escape(0x100 + row * 400 + index)}|`,
      ['(?:', 'q)+'],
      'too-complex'
    ],
    [
      'looped single-unit alternations',
      (row: number, index: number) => `${escape(0x100 + row * 400 + index)}|`,
      ['(?:', 'q)+'],
      null
    ],
    ['case-folded `\\W` runs', () => '\\W', CASE_SCOPE, null]
  ] as const)(
    'answers %s per row, within the work bound (deterministic)',
    (_case, unitFor, wrap, verdict) => {
      const set = capSizedSet(unitFor, wrap);
      const rows = [...set.rows.delayJs, ...set.rows.deferJs];
      const chars = rows.join('').length;
      expect(chars).toBeLessThanOrEqual(EXCLUSION_SET_LIMITS.totalChars);
      expect(chars).toBeGreaterThan(EXCLUSION_SET_LIMITS.totalChars * 0.95);
      let work = 0;
      for (const row of rows) {
        const analysis = analyzeRegexRisk(row);
        expect(analysis.work).toBeLessThanOrEqual(analysisWorkBudget(row));
        // The shape's own verdict: accepted, or honestly too complex for its budget.
        expect(analysis.risk).toBe(verdict);
        work += analysis.work;
      }
      expect(work).toBeLessThanOrEqual(PREVALIDATION_WORK_BOUND);
    }
  );

  it('bounds the most rows a set can hold by the same work bound', () => {
    const rows = Array.from(
      { length: EXCLUSION_SET_LIMITS.rowsPerFeature },
      (_, i) => `(?i:\\W${String(i)})`
    );
    const work = [...rows, ...rows].reduce((total, row) => total + analyzeRegexRisk(row).work, 0);
    expect(work).toBeLessThanOrEqual(PREVALIDATION_WORK_BOUND);
  });

  it('derives the CPU bound from the work bound with ≥ 10× machine headroom', () => {
    const measuredWorstMs =
      (PREVALIDATION_WORK_BOUND * PREVALIDATION_NS_PER_WORK_UNIT) / 1e6 + PREVALIDATION_FIXED_MS;
    expect(PREVALIDATION_CPU_BOUND_MS).toBeGreaterThanOrEqual(10 * measuredWorstMs);
  });

  it('links work to time: the heaviest shape costs a bounded number of ns per unit', () => {
    // Work is the gate; this pins its exchange rate. 15× the declared rate
    // absorbs v8 coverage on a shared CI runner (~8–11× slower than the
    // development machine) — a step left uncharged would blow through it.
    const set = capSizedSet(
      (row, index) => `${escape(0x3000 + 2 * (row * 400 + index))}?`,
      ['(?i:(?:\\u00ff', ')*)']
    );
    const rows = [...set.rows.delayJs, ...set.rows.deferJs];
    analyzeRegexRisk('(?i:a)'); // build the one-time case index outside the timing
    const started = performance.now();
    const work = rows.reduce((total, row) => total + analyzeRegexRisk(row).work, 0);
    const nsPerUnit = ((performance.now() - started) * 1e6) / work;
    expect(work).toBeGreaterThan(PREVALIDATION_WORK_BOUND / 3);
    expect(nsPerUnit).toBeLessThan(15 * PREVALIDATION_NS_PER_WORK_UNIT);
  });

  it('smoke: a cap-sized adversarial set prevalidates far inside a generous ceiling', () => {
    // Wall clock is not the gate (the work bound above is): this only catches
    // a gross regression. 5× the declared bound absorbs v8 coverage plus a
    // shared CI runner (measured ~11× slower than the development machine).
    const set = capSizedSet(
      (row, index) => `[^${escape(((row * 400 + index + 7) % 0xfffe) + 1)}]`,
      CASE_SCOPE
    );
    const started = performance.now();
    prevalidateExclusionSet(set);
    expect(performance.now() - started).toBeLessThan(5 * PREVALIDATION_CPU_BOUND_MS);
  });
});
