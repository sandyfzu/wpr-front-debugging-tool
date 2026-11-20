/**
 * Pins the score ring's arc layout: slot sizes, the zero/empty states, the
 * over-full scale-down, negative clamping, the gap on every boundary (the
 * wrap-around included), round caps kept inside their slots, and the fail-fast
 * guards for non-finite or out-of-range inputs.
 */
import { describe, expect, it } from 'vitest';
import { type RingArc, ringArcs, roundCapExtent } from './score-ring-geometry';

/** A round 100-unit circle keeps the expected numbers readable. */
const C = 100;

/**
 * The painted range of an arc along the centerline, round caps included.
 *
 * @param arc The arc to measure.
 * @param capExtent The round cap's extent the arcs were laid out with.
 * @returns Start and end positions on the circle.
 */
function paintedRange(arc: RingArc<string>, capExtent: number): { from: number; to: number } {
  const cap = arc.cap === 'round' ? capExtent : 0;
  const start = -arc.offset;
  return { from: start - cap, to: start + arc.dash + cap };
}

/**
 * The list's entry at `index`, failing the test when it is missing.
 *
 * @param list The list to read.
 * @param index The wanted position.
 * @returns The entry.
 */
function nth<T>(list: readonly T[], index: number): T {
  const entry = list[index];
  if (entry === undefined)
    throw new Error(`no entry at ${String(index)} of ${String(list.length)}`);
  return entry;
}

describe('ringArcs', () => {
  it('gives each non-zero segment a slot proportional to its value', () => {
    const arcs = ringArcs(
      [
        { value: 4, kind: 'ok' },
        { value: 3, kind: 'warn' }
      ],
      20,
      C
    );
    expect(arcs).toEqual([
      { dash: 20, offset: 0, kind: 'ok', cap: 'butt' },
      { dash: 15, offset: -20, kind: 'warn', cap: 'butt' }
    ]);
  });

  it('draws one arc per non-zero segment and skips zero ones without moving the rest', () => {
    const arcs = ringArcs(
      [
        { value: 0, kind: 'ok' },
        { value: 5, kind: 'warn' },
        { value: 0, kind: 'error' },
        { value: 5, kind: 'info' }
      ],
      20,
      C
    );
    expect(arcs.map((arc) => arc.kind)).toEqual(['warn', 'info']);
    expect(arcs.map((arc) => arc.offset)).toEqual([0, -25]);
  });

  it('returns no arcs for an empty list, all-zero values, or a total of zero or below', () => {
    expect(ringArcs([], 10, C)).toEqual([]);
    expect(ringArcs([{ value: 0, kind: 'ok' }], 10, C)).toEqual([]);
    expect(ringArcs([{ value: 5, kind: 'ok' }], 0, C)).toEqual([]);
    expect(ringArcs([{ value: 5, kind: 'ok' }], -3, C)).toEqual([]);
  });

  it('clamps negative values to zero', () => {
    const arcs = ringArcs(
      [
        { value: -4, kind: 'ok' },
        { value: 5, kind: 'warn' }
      ],
      10,
      C
    );
    expect(arcs).toEqual([{ dash: 50, offset: 0, kind: 'warn', cap: 'butt' }]);
  });

  it('scales an over-full sum down so the arcs fill the circle exactly', () => {
    const arcs = ringArcs(
      [
        { value: 30, kind: 'ok' },
        { value: 10, kind: 'warn' }
      ],
      20,
      C
    );
    expect(arcs.map((arc) => arc.dash)).toEqual([75, 25]);
    const last = arcs.at(-1);
    expect(last && -last.offset + last.dash).toBe(C);
  });

  it('draws a lone segment reaching the total as one full ring, even over-full', () => {
    const full = { dash: C, offset: 0, kind: 'ok', cap: 'butt' };
    const spacing = { gap: 2, capExtent: 3 };
    expect(ringArcs([{ value: 3, kind: 'ok' }], 3, C, spacing)).toEqual([full]);
    expect(ringArcs([{ value: 9, kind: 'ok' }], 3, C, spacing)).toEqual([full]);
    // Zero neighbours don't stop it being alone.
    expect(
      ringArcs(
        [
          { value: 0, kind: 'warn' },
          { value: 7, kind: 'ok' }
        ],
        7,
        C,
        spacing
      )
    ).toEqual([full]);
  });

  it('keeps a lone partial segment gapped and capped like any other', () => {
    expect(ringArcs([{ value: 1, kind: 'ok' }], 2, C, { gap: 2, capExtent: 3 })).toEqual([
      { dash: 42, offset: -4, kind: 'ok', cap: 'round' }
    ]);
  });

  it('separates every pair of neighbours by exactly the gap, wrap-around included', () => {
    const gap = 2;
    const arcs = ringArcs(
      [
        { value: 1, kind: 'ok' },
        { value: 2, kind: 'warn' },
        { value: 1, kind: 'error' }
      ],
      4,
      C,
      { gap, capExtent: 0 }
    );
    const ranges = arcs.map((arc) => paintedRange(arc, 0));
    expect(nth(ranges, 1).from - nth(ranges, 0).to).toBeCloseTo(gap);
    expect(nth(ranges, 2).from - nth(ranges, 1).to).toBeCloseTo(gap);
    // Full slots: the last arc's end and the first arc's start are a gap apart across 0.
    expect(C - nth(ranges, 2).to + nth(ranges, 0).from).toBeCloseTo(gap);
  });

  it('shortens round arcs by the cap extent so caps stay inside their slots', () => {
    const capExtent = 3;
    const gap = 1;
    const arcs = ringArcs(
      [
        { value: 25, kind: 'ok' },
        { value: 25, kind: 'warn' }
      ],
      100,
      C,
      { gap, capExtent }
    );
    expect(arcs).toEqual([
      { dash: 18, offset: -3.5, kind: 'ok', cap: 'round' },
      { dash: 18, offset: -28.5, kind: 'warn', cap: 'round' }
    ]);
    const ranges = arcs.map((arc) => paintedRange(arc, capExtent));
    expect(nth(ranges, 0)).toEqual({ from: 0.5, to: 24.5 });
    expect(nth(ranges, 1).from - nth(ranges, 0).to).toBe(gap);
  });

  it('never overlaps neighbours with a zero gap: round arcs touch at the slot edge', () => {
    const capExtent = 2;
    const arcs = ringArcs(
      [
        { value: 1, kind: 'ok' },
        { value: 1, kind: 'warn' }
      ],
      2,
      C,
      { gap: 0, capExtent }
    );
    const ranges = arcs.map((arc) => paintedRange(arc, capExtent));
    expect(nth(ranges, 0).from).toBe(0);
    expect(nth(ranges, 1).from).toBe(nth(ranges, 0).to);
    expect(nth(ranges, 1).to).toBe(C);
  });

  it('draws a slot too short for both round caps with square ends', () => {
    // Slot 4, gap 1 → 3 painted, less than the 2 × 2 caps.
    const arcs = ringArcs([{ value: 4, kind: 'ok' }], 100, C, { gap: 1, capExtent: 2 });
    expect(arcs).toEqual([{ dash: 3, offset: -0.5, kind: 'ok', cap: 'butt' }]);
  });

  it('uses square ends at exactly twice the cap extent (a round dash would be zero long)', () => {
    const arcs = ringArcs([{ value: 5, kind: 'ok' }], 100, C, { gap: 1, capExtent: 2 });
    expect(arcs[0]?.cap).toBe('butt');
    expect(arcs[0]?.dash).toBe(4);
  });

  it('drops a slot no longer than the gap', () => {
    expect(ringArcs([{ value: 1, kind: 'ok' }], 100, C, { gap: 1, capExtent: 0 })).toEqual([]);
    expect(
      ringArcs(
        [
          { value: 1, kind: 'ok' },
          { value: 50, kind: 'warn' }
        ],
        100,
        C,
        { gap: 1.5, capExtent: 0 }
      ).map((arc) => arc.kind)
    ).toEqual(['warn']);
  });

  it('keeps non-integer counts and circumferences proportional', () => {
    const circumference = 2 * Math.PI * 20;
    const arcs = ringArcs(
      [
        { value: 4, kind: 'ok' },
        { value: 3, kind: 'warn' }
      ],
      18,
      circumference
    );
    expect(arcs[0]?.dash).toBeCloseTo((4 / 18) * circumference);
    expect(arcs[1]?.offset).toBeCloseTo(-(4 / 18) * circumference);
  });

  it.each([
    ['NaN value', [{ value: Number.NaN, kind: 'ok' }], 10, C, undefined, 'segments[0].value'],
    ['Infinity value', [{ value: Infinity, kind: 'ok' }], 10, C, undefined, 'segments[0].value'],
    ['NaN total', [], Number.NaN, C, undefined, 'total'],
    ['Infinity total', [], Infinity, C, undefined, 'total'],
    ['zero circumference', [], 10, 0, undefined, 'circumference'],
    ['negative circumference', [], 10, -1, undefined, 'circumference'],
    ['NaN circumference', [], 10, Number.NaN, undefined, 'circumference'],
    ['negative gap', [], 10, C, { gap: -1, capExtent: 0 }, 'gap'],
    ['NaN cap extent', [], 10, C, { gap: 0, capExtent: Number.NaN }, 'capExtent']
  ] as const)(
    'throws a RangeError naming the input on a %s',
    (_case, segments, total, circ, spacing, name) => {
      expect(() => ringArcs(segments, total, circ, spacing)).toThrow(RangeError);
      expect(() => ringArcs(segments, total, circ, spacing)).toThrow(name);
    }
  );

  it('validates every value, even when the total makes the ring empty', () => {
    expect(() => ringArcs([{ value: Number.NaN, kind: 'ok' }], 0, C)).toThrow('segments[0].value');
  });
});

describe('roundCapExtent', () => {
  it('is the cap disc’s angular half-span on the centerline, a little more than half the width', () => {
    const extent = roundCapExtent(20, 5);
    expect(extent).toBeCloseTo(20 * Math.asin(2.5 / 20), 12);
    expect(extent).toBeGreaterThan(2.5);
  });

  it('is zero for a zero-width stroke', () => {
    expect(roundCapExtent(20, 0)).toBe(0);
  });

  it('accepts a stroke as wide as the diameter', () => {
    expect(roundCapExtent(1, 2)).toBeCloseTo(Math.PI / 2);
  });

  it.each([
    ['zero radius', 0, 1, 'radius'],
    ['NaN radius', Number.NaN, 1, 'radius'],
    ['negative width', 20, -1, 'strokeWidth'],
    ['Infinity width', 20, Infinity, 'strokeWidth'],
    ['width over the diameter', 2, 5, 'exceeds the diameter']
  ] as const)('throws a RangeError on a %s', (_case, radius, width, message) => {
    expect(() => roundCapExtent(radius, width)).toThrow(RangeError);
    expect(() => roundCapExtent(radius, width)).toThrow(message);
  });
});
