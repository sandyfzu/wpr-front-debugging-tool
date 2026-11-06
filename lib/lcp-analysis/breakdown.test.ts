/**
 * LCP breakdown: the max chain's golden values, every boundary clamp
 * (hidden cross-origin request start, response before request, a download
 * end past the LCP capped at it), one-decimal percentages computed before
 * rounding, text and missing resources, the last resource requested by the
 * LCP time, zero total, and candidate deduplication by start time;
 * boundaries measured from a prerender activation, agreeing with the
 * current-visit LCP. The total is always the LCP time — the numbers web-vitals
 * 6.2.3's attribution build reports for the same entries.
 */
import { describe, expect, it } from 'vitest';
import { reduceLcp } from '../web-vitals/current-visit';
import {
  computeLcpBreakdown,
  dedupeCandidates,
  findLcpResource,
  partPercent,
  sinceActivation,
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
    // A download that ends after the paint is capped at the LCP time.
    const late = breakdown({ responseStart: 200 }, { startTime: 700, url: URL_A }, [resource()]);
    expect(durations(late)).toEqual([200, 150, 350, 0]);
    expect(late.total).toBe(700);
  });

  it('keeps the total at the LCP time for media still downloading after its first frame (web-vitals numbers)', () => {
    // A video or animated image: painted at 1,500 ms, downloading until 4,200 ms.
    const result = breakdown(
      { responseStart: 200, activationStart: 0 },
      { startTime: 1500, url: URL_A },
      [resource({ startTime: 400, requestStart: 450, responseEnd: 4200 })]
    );
    // web-vitals 6.2.3 attribution: 200 / 250 / 1,050 / 0, LCP 1,500.
    expect(durations(result)).toEqual([200, 250, 1050, 0]);
    expect(result.total).toBe(1500);
    expect(result.total).toBe(reduceLcp([{ startTime: 1500 }], 0, null));
  });

  it('caps a first byte after the paint (broken timings) so every part stays non-negative', () => {
    const result = breakdown({ responseStart: 900 }, { startTime: 600, url: '' }, []);
    expect(durations(result)).toEqual([600, 0, 0, 0]);
    expect(result.total).toBe(600);
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

  it('uses the last entry of a duplicated URL requested by the LCP time', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 2000, url: URL_A }, [
      resource({ name: 'https://e.test/other.jpg', requestStart: 210 }),
      resource({ requestStart: 300, responseEnd: 600 }),
      resource({ requestStart: 1000, responseEnd: 1500 }),
      // Requested after the paint: cannot be what painted it.
      resource({ startTime: 2100, requestStart: 2100, responseEnd: 2400 })
    ]);
    expect(durations(result)).toEqual([200, 800, 500, 500]);
  });

  it('attributes a refetched URL to the fetch before the paint (web-vitals numbers)', () => {
    const result = breakdown({ responseStart: 200 }, { startTime: 1500, url: URL_A }, [
      resource({ startTime: 100, requestStart: 0, responseEnd: 300 }),
      resource({ startTime: 900, requestStart: 950, responseEnd: 1300 })
    ]);
    // web-vitals 6.2.3 attribution: 200 / 750 / 350 / 200.
    expect(durations(result)).toEqual([200, 750, 350, 200]);
    expect(result.total).toBe(1500);
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

  it('measures every boundary from a prerender activation, as the visit LCP does', () => {
    const navigation = { responseStart: 200, activationStart: 500 };
    const result = breakdown(navigation, { startTime: 1700, url: URL_A }, [resource()]);
    // First byte and request before activation floor at 0; the rest shifts by 500.
    expect(durations(result)).toEqual([0, 0, 400, 800]);
    expect(result.total).toBe(1200);
    expect(result.total).toBe(reduceLcp([{ startTime: 1700 }], 500, null));
    expect(result.parts.map((part) => part.percent)).toEqual([0, 0, 33.3, 66.7]);
  });

  it('aligns a withheld request start through the entry start, then the activation', () => {
    const navigation = { responseStart: 100, activationStart: 50 };
    const result = breakdown(navigation, { startTime: 1000, url: URL_A }, [
      resource({ requestStart: 0, startTime: 250, responseEnd: 650 })
    ]);
    expect(durations(result)).toEqual([50, 150, 400, 350]);
    expect(result.total).toBe(950);
  });

  it('reads an absent, zero or invalid activation as not prerendered', () => {
    const plain = breakdown({ responseStart: 200 }, { startTime: 1200, url: URL_A }, [resource()]);
    for (const activationStart of [0, Number.NaN, -10]) {
      expect(
        breakdown({ responseStart: 200, activationStart }, { startTime: 1200, url: URL_A }, [
          resource()
        ])
      ).toEqual(plain);
    }
  });

  it('floors a whole page painted before activation at 0', () => {
    const result = breakdown(
      { responseStart: 100, activationStart: 5000 },
      { startTime: 900, url: '' },
      []
    );
    expect(result.total).toBe(0);
    expect(result.parts.every((part) => part.duration === 0 && part.percent === null)).toBe(true);
  });

  it('names what is missing', () => {
    expect(computeLcpBreakdown(null, { startTime: 1, url: '' }, [])).toEqual({
      kind: 'no-navigation'
    });
    expect(computeLcpBreakdown({ responseStart: 1 }, null, [])).toEqual({ kind: 'no-lcp' });
  });
});

describe('sinceActivation', () => {
  it('subtracts the activation, floors at 0 and reads invalid values as 0', () => {
    expect(sinceActivation(1200, 500)).toBe(700);
    expect(sinceActivation(300, 500)).toBe(0);
    expect(sinceActivation(1200, undefined)).toBe(1200);
    expect(sinceActivation(Number.NaN, 0)).toBe(0);
    expect(sinceActivation(1200, Infinity)).toBe(1200);
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
    expect(findLcpResource({ url: '', startTime: 1000 }, [resource({ name: '' })])).toBeNull();
  });

  it('skips entries requested after the LCP, comparing the request start (else the entry start)', () => {
    const early = resource({ startTime: 100, requestStart: 0 });
    const late = resource({ startTime: 1200, requestStart: 1250 });
    expect(findLcpResource({ url: URL_A, startTime: 1000 }, [early, late])).toBe(early);
    expect(findLcpResource({ url: URL_A, startTime: 1250 }, [early, late])).toBe(late);
    expect(findLcpResource({ url: URL_A, startTime: 50 }, [early, late])).toBeNull();
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
