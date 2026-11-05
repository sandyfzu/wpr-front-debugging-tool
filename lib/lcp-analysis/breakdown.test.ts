/**
 * LCP breakdown: the max chain's golden values, every boundary clamp
 * (hidden cross-origin request start, response before request, render before
 * response), one-decimal percentages computed before rounding, text and
 * missing resources, first matching resource, zero total, and candidate
 * deduplication by start time.
 */
import { describe, expect, it } from 'vitest';
import {
  computeLcpBreakdown,
  dedupeCandidates,
  findLcpResource,
  partPercent,
  type LcpBreakdown,
  type ResourceTiming
} from './breakdown';

const URL_A = 'https://e.test/hero.jpg';

/** A resource entry for a URL. */
function resource(overrides: Partial<ResourceTiming> = {}): ResourceTiming {
  return { name: URL_A, startTime: 300, requestStart: 350, responseEnd: 900, ...overrides };
}

/** The breakdown, asserting one was computed. */
function breakdown(...args: Parameters<typeof computeLcpBreakdown>): LcpBreakdown {
  const result = computeLcpBreakdown(...args);
  if (result.kind !== 'breakdown') throw new Error(`expected a breakdown, got ${result.kind}`);
  return result;
}

/** The part durations, in order. */
function durations(result: LcpBreakdown): number[] {
  return result.parts.map((part) => part.duration);
}

describe('computeLcpBreakdown', () => {
  it('computes the golden chain', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 1200, url: URL_A }, [resource()]);
    expect(result.total).toBe(1200);
    expect(result.resource).toBe('found');
    expect(result.parts).toEqual([
      { key: 'timeToFirstByte', duration: 200, percent: 16.7 },
      { key: 'resourceLoadDelay', duration: 150, percent: 12.5 },
      { key: 'resourceLoadDuration', duration: 550, percent: 45.8 },
      { key: 'elementRenderDelay', duration: 300, percent: 25 }
    ]);
    expect(durations(result).reduce((sum, value) => sum + value, 0)).toBe(result.total);
  });

  it('falls back to startTime when requestStart is hidden (cross-origin, no TAO)', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 1200, url: URL_A }, [
      resource({ requestStart: 0, startTime: 260 })
    ]);
    expect(durations(result)).toEqual([200, 60, 640, 300]);
  });

  it('clamps a request that started before the first byte to the first byte', () => {
    const result = breakdown({ responseStart: 400 }, { startTime: 1200, url: URL_A }, [
      resource({ requestStart: 100 })
    ]);
    expect(durations(result)).toEqual([400, 0, 500, 300]);
  });

  it('clamps a missing response end and a render before the response', () => {
    expect(
      durations(
        breakdown({ responseStart: 200 }, { startTime: 1200, url: URL_A }, [
          resource({ responseEnd: 0 })
        ])
      )
    ).toEqual([200, 150, 0, 850]);
    const late = breakdown({ responseStart: 200 }, { startTime: 700, url: URL_A }, [resource()]);
    expect(durations(late)).toEqual([200, 150, 550, 0]);
    // The total is the render boundary: a video still downloading past the
    // LCP time stretches it beyond the entry's startTime.
    expect(late.total).toBe(900);
  });

  it('treats a text LCP as nothing to load', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 800, url: '' }, [
      resource({ name: '' })
    ]);
    expect(result.resource).toBe('text');
    expect(durations(result)).toEqual([200, 0, 0, 600]);
  });

  it('names a missing resource entry and attributes the rest to render delay', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 800, url: URL_A }, []);
    expect(result.resource).toBe('missing');
    expect(durations(result)).toEqual([200, 0, 0, 600]);
  });

  it('uses the first entry of a duplicated URL', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 2000, url: URL_A }, [
      resource({ name: 'https://e.test/other.jpg', requestStart: 210 }),
      resource({ requestStart: 300, responseEnd: 600 }),
      resource({ requestStart: 1000, responseEnd: 1500 })
    ]);
    expect(durations(result)).toEqual([200, 100, 300, 1400]);
  });

  it('gives null percentages for a zero total', () => {
    const result = breakdown({ responseStart: 0 }, { startTime: 0, url: '' }, []);
    expect(result.total).toBe(0);
    expect(result.parts.every((part) => part.percent === null && part.duration === 0)).toBe(true);
  });

  it('reads non-finite or negative timings as 0', () => {
    const result = breakdown({ responseStart: Number.NaN }, { startTime: -5, url: URL_A }, [
      resource({ requestStart: Number.NaN, startTime: Infinity, responseEnd: -1 })
    ]);
    expect(durations(result)).toEqual([0, 0, 0, 0]);
  });

  it('names what is missing', () => {
    expect(computeLcpBreakdown(null, { startTime: 1, url: '' }, [])).toEqual({
      kind: 'no-navigation'
    });
    expect(computeLcpBreakdown({ responseStart: 1 }, null, [])).toEqual({ kind: 'no-lcp' });
  });
});

describe('partPercent', () => {
  it('scales before rounding to one decimal', () => {
    expect(partPercent(1, 3)).toBe(33.3);
    expect(partPercent(2, 3)).toBe(66.7);
    expect(partPercent(1, 8)).toBe(12.5);
    expect(partPercent(5, 5)).toBe(100);
    expect(partPercent(0, 5)).toBe(0);
    // A pre-rounded ratio would read 0 here.
    expect(partPercent(1, 400)).toBe(0.3);
  });

  it('is null for a zero, negative or non-finite total', () => {
    expect(partPercent(0, 0)).toBeNull();
    expect(partPercent(1, -1)).toBeNull();
    expect(partPercent(1, Number.NaN)).toBeNull();
    expect(partPercent(1, Infinity)).toBeNull();
  });
});

describe('findLcpResource', () => {
  it('matches nothing for a text LCP even when an entry has an empty name', () => {
    expect(findLcpResource('', [resource({ name: '' })])).toBeNull();
  });
});

describe('dedupeCandidates', () => {
  it('keeps one candidate per start time, the last reported, in first position', () => {
    const entries = [
      { startTime: 100, id: 'a' },
      { startTime: 300, id: 'b' },
      { startTime: 100, id: 'c' },
      { startTime: 500, id: 'd' }
    ];
    expect(dedupeCandidates(entries).map((entry) => entry.id)).toEqual(['c', 'b', 'd']);
    expect(dedupeCandidates([])).toEqual([]);
  });
});
