import { describe, expect, it } from 'vitest';
import { formatCount } from './format-count';

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
