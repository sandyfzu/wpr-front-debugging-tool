/**
 * Current-visit vitals: LCP (last candidate before the page was first
 * hidden, activation offset, floor), CLS (gated on a first paint seen while
 * visible) session windows (1 s gap, 5 s span, recent input excluded, largest
 * window; folding shift by shift and continuing from a carry equals one
 * pass), INP (longest entry per interaction, one skipped per 50, top-10
 * cap, browser count, dropped interactions counted), a restored visit
 * (entries since the restore, CLS ungated, INP 8 ms floor, flagged), rating
 * bands at their exact thresholds, and the unsupported / no-data outcomes
 * per metric.
 */
import { describe, expect, it } from 'vitest';
import {
  CLS_START,
  INP_RESTORED_FLOOR_MS,
  VITAL_THRESHOLDS,
  beforeHidden,
  foldClsShift,
  rate,
  reduceCls,
  reduceCurrentVisit,
  reduceInp,
  reduceLcp,
  resolveFirstHiddenTime,
  type VitalsInput
} from './current-visit';

/** A layout shift. */
function shift(startTime: number, value: number, hadRecentInput = false) {
  return { startTime, value, hadRecentInput };
}

/** Event entries: one interaction per latency, ids 1… */
function interactions(latencies: readonly number[]) {
  return latencies.map((duration, index) => ({ interactionId: index + 1, duration }));
}

/** A supported, empty input of a visible page painted at 50 ms, with overrides. */
function input(overrides: Partial<VitalsInput> = {}): VitalsInput {
  return {
    supported: { lcp: true, cls: true, inp: true },
    activationStart: 0,
    firstHiddenTime: null,
    fcpTime: 50,
    lcpEntries: [],
    layoutShifts: [],
    events: [],
    interactionCount: null,
    ...overrides
  };
}

describe('reduceLcp', () => {
  it('takes the last candidate, minus the activation start, floored at 0', () => {
    expect(reduceLcp([{ startTime: 900 }, { startTime: 1800 }], 0, null)).toBe(1800);
    expect(reduceLcp([{ startTime: 1800 }], 300, null)).toBe(1500);
    expect(reduceLcp([{ startTime: 100 }], 300, null)).toBe(0);
    expect(reduceLcp([], 0, null)).toBeNull();
  });

  it('ignores candidates painted once the page was hidden (strictly before counts)', () => {
    const entries = [{ startTime: 900 }, { startTime: 1800 }];
    expect(reduceLcp(entries, 0, 1000)).toBe(900);
    expect(reduceLcp(entries, 0, 1800)).toBe(900);
    expect(reduceLcp(entries, 0, 1801)).toBe(1800);
  });

  it('has no LCP for a page loaded in the background (hidden from the start)', () => {
    expect(reduceLcp([{ startTime: 900 }], 0, 0)).toBeNull();
  });
});

describe('resolveFirstHiddenTime', () => {
  it('takes the earlier of the entry and the tracker', () => {
    expect(resolveFirstHiddenTime(900, 400, false)).toBe(400);
    expect(resolveFirstHiddenTime(300, 400, true)).toBe(300);
  });

  it('takes whichever source has a time', () => {
    expect(resolveFirstHiddenTime(900, null, true)).toBe(900);
    expect(resolveFirstHiddenTime(null, 400, true)).toBe(400);
    expect(resolveFirstHiddenTime(null, 0, false)).toBe(0);
  });

  it('counts a page hidden right now as hidden from the start, else never hidden', () => {
    expect(resolveFirstHiddenTime(null, null, true)).toBe(0);
    expect(resolveFirstHiddenTime(null, null, false)).toBeNull();
  });
});

describe('beforeHidden', () => {
  it('is true for a never-hidden page and for times strictly before the first hide', () => {
    expect(beforeHidden(5000, null)).toBe(true);
    expect(beforeHidden(999, 1000)).toBe(true);
    expect(beforeHidden(1000, 1000)).toBe(false);
    expect(beforeHidden(0, 0)).toBe(false);
  });
});

describe('reduceCls', () => {
  it('sums shifts less than 1 s apart within 5 s into one window', () => {
    expect(reduceCls([shift(0, 0.05), shift(900, 0.05), shift(1800, 0.05)])).toBeCloseTo(0.15);
  });

  it('opens a new window after a 1 s gap and keeps the largest', () => {
    expect(reduceCls([shift(0, 0.05), shift(1000, 0.2), shift(1500, 0.01)])).toBeCloseTo(0.21);
    expect(reduceCls([shift(0, 0.3), shift(1000, 0.1)])).toBeCloseTo(0.3);
  });

  it('closes a window at 5 s even with shifts every 900 ms', () => {
    const steady = Array.from({ length: 8 }, (_, i) => shift(i * 900, 0.1));
    // Window 1: 0…4500 ms (6 shifts); 5400 starts window 2 (2 shifts).
    expect(reduceCls(steady)).toBeCloseTo(0.6);
  });

  it('ignores shifts right after input, without breaking the window', () => {
    expect(reduceCls([shift(0, 0.1), shift(200, 5, true), shift(800, 0.1)])).toBeCloseTo(0.2);
  });

  it('is 0 without unexpected shifts', () => {
    expect(reduceCls([])).toBe(0);
    expect(reduceCls([shift(0, 1, true)])).toBe(0);
  });
});

describe('foldClsShift', () => {
  it('opens, joins and closes windows like one pass, ignoring input shifts', () => {
    let state = foldClsShift(CLS_START, shift(0, 0.1));
    expect(state).toEqual({ largest: 0.1, windowSum: 0.1, windowFirst: 0, previous: 0 });
    expect(foldClsShift(state, shift(100, 9, true))).toBe(state);
    state = foldClsShift(state, shift(900, 0.2));
    expect(state).toMatchObject({ windowFirst: 0, previous: 900 });
    expect(state.largest).toBeCloseTo(0.3);
    state = foldClsShift(state, shift(1900, 0.05));
    expect(state).toMatchObject({ windowSum: 0.05, windowFirst: 1900, previous: 1900 });
    expect(state.largest).toBeCloseTo(0.3);
  });

  it('continues from a carry exactly as one pass over every shift', () => {
    const shifts = Array.from({ length: 40 }, (_, i) =>
      shift(i * 450 + (i % 7) * 300, (i % 5) * 0.03, i % 6 === 0)
    );
    for (const split of [0, 1, 13, 39, 40]) {
      const carry = shifts.slice(0, split).reduce(foldClsShift, CLS_START);
      expect(reduceCls(shifts.slice(split), carry)).toBeCloseTo(reduceCls(shifts), 12);
    }
  });
});

describe('reduceInp', () => {
  it('takes each interaction’s longest entry and the worst interaction', () => {
    const events = [
      { interactionId: 7, duration: 40 },
      { interactionId: 7, duration: 120 },
      { interactionId: 9, duration: 80 },
      { interactionId: 0, duration: 900 }
    ];
    expect(reduceInp(events, null)).toEqual({ value: 120, interactions: 2 });
  });

  it('skips one worst interaction per 50', () => {
    const latencies = Array.from({ length: 49 }, () => 50);
    latencies.push(800);
    expect(reduceInp(interactions(latencies), null)?.value).toBe(50);
    expect(reduceInp(interactions(latencies.slice(1)), null)?.value).toBe(800);
  });

  it('counts the browser’s interactions beyond the reported entries', () => {
    expect(reduceInp(interactions([800, 300]), 50)).toEqual({ value: 300, interactions: 50 });
    expect(reduceInp(interactions([800, 300]), 1)).toEqual({ value: 800, interactions: 2 });
  });

  it('counts interactions the page dropped (never the slowest)', () => {
    const slow = interactions([300, 200, 100]);
    expect(reduceInp(slow, null, 47)).toEqual({ value: 200, interactions: 50 });
    expect(reduceInp(slow, 60, 47)).toEqual({ value: 200, interactions: 60 });
    expect(reduceInp(slow, null)).toEqual({ value: 300, interactions: 3 });
  });

  it('never skips past the 10th longest interaction', () => {
    const latencies = Array.from({ length: 12 }, (_, i) => 1000 - i * 10);
    expect(reduceInp(interactions(latencies), 1000)?.value).toBe(910);
  });

  it('is null without interactions', () => {
    expect(reduceInp([], 5)).toBeNull();
    expect(reduceInp([{ interactionId: 0, duration: 300 }], null)).toBeNull();
  });
});

describe('rate', () => {
  it('bands values at the published thresholds (upper bounds inclusive)', () => {
    expect(rate(2500, VITAL_THRESHOLDS.lcp)).toBe('good');
    expect(rate(2501, VITAL_THRESHOLDS.lcp)).toBe('needs-improvement');
    expect(rate(4000, VITAL_THRESHOLDS.lcp)).toBe('needs-improvement');
    expect(rate(4001, VITAL_THRESHOLDS.lcp)).toBe('poor');
    expect(rate(0.1, VITAL_THRESHOLDS.cls)).toBe('good');
    expect(rate(0.25, VITAL_THRESHOLDS.cls)).toBe('needs-improvement');
    expect(rate(0.26, VITAL_THRESHOLDS.cls)).toBe('poor');
    expect(rate(200, VITAL_THRESHOLDS.inp)).toBe('good');
    expect(rate(501, VITAL_THRESHOLDS.inp)).toBe('poor');
  });
});

describe('reduceCurrentVisit', () => {
  it('reduces a golden visit', () => {
    expect(
      reduceCurrentVisit(
        input({
          lcpEntries: [{ startTime: 1200 }, { startTime: 2600 }],
          layoutShifts: [shift(100, 0.02), shift(500, 0.03)],
          events: interactions([90, 260])
        })
      )
    ).toEqual({
      lcp: { state: 'measured', value: 2600, rating: 'needs-improvement' },
      cls: { state: 'measured', value: 0.05, rating: 'good' },
      inp: { state: 'measured', value: 260, rating: 'needs-improvement', interactions: 2 }
    });
  });

  it('reports no data for LCP and INP, and a measured 0 for CLS, on a quiet visit', () => {
    expect(reduceCurrentVisit(input())).toEqual({
      lcp: { state: 'no-data' },
      cls: { state: 'measured', value: 0, rating: 'good' },
      inp: { state: 'no-data' }
    });
  });

  it('reports no LCP or CLS for a background-loaded page, but still its INP', () => {
    expect(
      reduceCurrentVisit(
        input({
          firstHiddenTime: 0,
          lcpEntries: [{ startTime: 1200 }],
          layoutShifts: [shift(100, 0.3)],
          events: interactions([120])
        })
      )
    ).toEqual({
      lcp: { state: 'no-data' },
      cls: { state: 'no-data' },
      inp: { state: 'measured', value: 120, rating: 'good', interactions: 1 }
    });
  });

  it('keeps CLS (shifts after hiding included) once the first paint was seen', () => {
    const visit = reduceCurrentVisit(
      input({
        firstHiddenTime: 1000,
        fcpTime: 400,
        lcpEntries: [{ startTime: 600 }, { startTime: 2000 }],
        layoutShifts: [shift(500, 0.05), shift(1200, 0.1)]
      })
    );
    expect(visit.lcp).toEqual({ state: 'measured', value: 600, rating: 'good' });
    expect(visit.cls).toMatchObject({ state: 'measured', rating: 'needs-improvement' });
    expect(visit.cls.state === 'measured' ? visit.cls.value : null).toBeCloseTo(0.15);
  });

  it('has no CLS before a first contentful paint, or when it came after hiding', () => {
    expect(reduceCurrentVisit(input({ fcpTime: null })).cls).toEqual({ state: 'no-data' });
    expect(reduceCurrentVisit(input({ fcpTime: 1500, firstHiddenTime: 1000 })).cls).toEqual({
      state: 'no-data'
    });
  });

  it('continues CLS from the page’s carry', () => {
    const visit = reduceCurrentVisit(
      input({
        clsCarry: { largest: 0.4, windowSum: 0.05, windowFirst: 1000, previous: 1500 },
        layoutShifts: [shift(1800, 0.1)]
      })
    );
    expect(visit.cls).toMatchObject({ state: 'measured', value: 0.4 });
  });

  it('reduces a restored visit: entries since the restore, CLS ungated, flagged', () => {
    const visit = reduceCurrentVisit(
      input({
        restoredAt: 5000,
        fcpTime: null,
        lcpEntries: [{ startTime: 4000 }],
        layoutShifts: [shift(4500, 0.9), shift(5200, 0.05)],
        events: interactions([80]),
        interactionCount: 1
      })
    );
    expect(visit).toEqual({
      lcp: { state: 'no-data' },
      cls: { state: 'measured', value: 0.05, rating: 'good' },
      inp: { state: 'measured', value: 80, rating: 'good', interactions: 1 },
      restored: true
    });
  });

  it('gives a restored visit with only unreported interactions the 8 ms INP floor', () => {
    expect(reduceCurrentVisit(input({ restoredAt: 10, interactionCount: 3 })).inp).toEqual({
      state: 'measured',
      value: INP_RESTORED_FLOOR_MS,
      rating: 'good',
      interactions: 3
    });
    expect(reduceCurrentVisit(input({ restoredAt: 10, interactionCount: 0 })).inp).toEqual({
      state: 'no-data'
    });
    expect(reduceCurrentVisit(input({ restoredAt: 10 })).inp).toEqual({ state: 'no-data' });
    // Without a restore, unreported interactions give no INP (first input reports one).
    expect(reduceCurrentVisit(input({ interactionCount: 3 })).inp).toEqual({ state: 'no-data' });
    expect(INP_RESTORED_FLOOR_MS).toBe(8);
  });

  it('reports each unsupported entry type on its own', () => {
    const visit = reduceCurrentVisit(
      input({
        supported: { lcp: false, cls: false, inp: true },
        lcpEntries: [{ startTime: 1 }],
        layoutShifts: [shift(0, 1)],
        events: interactions([100])
      })
    );
    expect(visit.lcp).toEqual({ state: 'unsupported' });
    expect(visit.cls).toEqual({ state: 'unsupported' });
    expect(visit.inp).toMatchObject({ state: 'measured', value: 100 });
    expect(
      reduceCurrentVisit(input({ supported: { lcp: true, cls: true, inp: false } })).inp
    ).toEqual({ state: 'unsupported' });
  });
});
