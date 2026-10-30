import { describe, expect, it } from 'vitest';
import { capitalize, countOccurrences } from './text';

describe('capitalize', () => {
  it('uppercases the first character, preserving the rest', () => {
    expect(capitalize('wpr')).toBe('Wpr');
    expect(capitalize('delay js')).toBe('Delay js');
    expect(capitalize('ALREADY uppercase')).toBe('ALREADY uppercase');
  });

  it('leaves an empty string empty', () => {
    expect(capitalize('')).toBe('');
  });

  it('treats leading whitespace as the first character (parity with the ported algorithm)', () => {
    expect(capitalize(' value')).toBe(' value');
  });
});

describe('countOccurrences', () => {
  it('counts non-overlapping occurrences', () => {
    expect(countOccurrences('abcabcab', 'abc')).toBe(2);
    expect(countOccurrences('aaaa', 'aa')).toBe(2);
    expect(countOccurrences('xyz', 'a')).toBe(0);
    expect(countOccurrences('', 'a')).toBe(0);
  });

  it('refuses an empty needle', () => {
    expect(() => countOccurrences('abc', '')).toThrow('the needle is empty');
  });
});
