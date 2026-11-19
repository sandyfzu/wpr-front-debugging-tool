import { describe, expect, it } from 'vitest';
import {
  countLabel,
  countNoun,
  formatCount,
  formatCountFloor,
  type CountNoun
} from './format-count';

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1000, '1,000'],
    [5000, '5,000'],
    [1234567, '1,234,567']
  ])('formats %i as %s without adding a noun or floor marker', (count, expected) => {
    expect(formatCount(count)).toBe(expected);
  });
});

describe('formatCountFloor', () => {
  it('adds the floor marker only to a partial count', () => {
    expect(formatCountFloor(0, false)).toBe('0');
    expect(formatCountFloor(1, true)).toBe('1+');
    expect(formatCountFloor(5000, false)).toBe('5,000');
    expect(formatCountFloor(5000, true)).toBe('5,000+');
  });
});

describe('countNoun', () => {
  const SCRIPTS: CountNoun = { one: 'script', other: 'scripts' };

  it('is singular for exactly one, plural for zero and many', () => {
    expect(countNoun(1, SCRIPTS)).toBe('script');
    expect(countNoun(0, SCRIPTS)).toBe('scripts');
    expect(countNoun(2, SCRIPTS)).toBe('scripts');
    expect(countNoun(10_001, SCRIPTS)).toBe('scripts');
  });

  it('is the rule countLabel phrases with (plural kept for a capture floor)', () => {
    expect(countLabel(1, SCRIPTS)).toBe(`1 ${countNoun(1, SCRIPTS)}`);
    expect(countLabel(1, SCRIPTS, true)).toBe('1+ scripts');
  });
});
