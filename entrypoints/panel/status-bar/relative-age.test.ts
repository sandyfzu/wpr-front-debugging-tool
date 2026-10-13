/**
 * The relative-age buckets and their exact edges: the "just now" clamp
 * (including future stamps — clock skew reads as current), every
 * bucket boundary, and the loud failure on a non-finite duration.
 */
import { describe, expect, it } from 'vitest';
import { JUST_NOW_MAX_MS, relativeAge } from './relative-age';

describe('relativeAge', () => {
  it('reads elapsed time under a minute in seconds', () => {
    expect(relativeAge(0)).toBe('just now');
    expect(relativeAge(JUST_NOW_MAX_MS + 1)).toBe('5 s ago');
    expect(relativeAge(59_999)).toBe('59 s ago');
  });

  it('clamps future stamps to "just now" (clock skew is not a countdown)', () => {
    expect(relativeAge(-1)).toBe('just now');
    expect(relativeAge(-3_600_000)).toBe('just now');
  });

  it('takes the "just now" bucket below its boundary', () => {
    expect(relativeAge(JUST_NOW_MAX_MS - 1)).toBe('just now');
    expect(relativeAge(JUST_NOW_MAX_MS)).toBe('5 s ago');
  });

  it('reads minutes at the minute boundary and inside the hour', () => {
    expect(relativeAge(60_000)).toBe('1 min ago');
    expect(relativeAge(3 * 60_000)).toBe('3 min ago');
    expect(relativeAge(3_599_999)).toBe('59 min ago');
  });

  it('reads hours at the hour boundary and inside the day', () => {
    expect(relativeAge(3_600_000)).toBe('1 h ago');
    expect(relativeAge(2 * 3_600_000)).toBe('2 h ago');
    expect(relativeAge(86_399_999)).toBe('23 h ago');
  });

  it('reads days from the day boundary on', () => {
    expect(relativeAge(86_400_000)).toBe('1 d ago');
    expect(relativeAge(3 * 86_400_000)).toBe('3 d ago');
    expect(relativeAge(30 * 86_400_000)).toBe('30 d ago');
  });

  it('throws on a non-finite duration instead of rendering a fabricated age', () => {
    expect(() => relativeAge(Number.NaN)).toThrow(RangeError);
    expect(() => relativeAge(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
