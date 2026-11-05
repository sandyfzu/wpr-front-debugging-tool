/**
 * Current-visit vitals: LCP (last candidate before the page was first
 * hidden, activation offset, floor), CLS (gated on a first paint seen while
 * visible) session windows (1 s gap, 5 s span, recent input excluded, largest
 * window), INP (longest entry per interaction, one skipped per 50, top-10
 * cap, browser count), rating bands at their exact thresholds, and the
 * unsupported / no-data outcomes per metric.
 */
import { describe, expect, it } from 'vitest';
import {
  VITAL_THRESHOLDS,
  beforeHidden,
  rate,
  reduceCls,
  reduceCurrentVisit,
  reduceInp,
  reduceLcp,
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
