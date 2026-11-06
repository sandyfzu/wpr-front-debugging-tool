/** `domTiming`: positive finite numbers pass, everything else is 0. */
import { describe, expect, it } from 'vitest';
import { domTiming } from './dom-timing';

describe('domTiming', () => {
  it('keeps finite, positive numbers', () => {
    expect(domTiming(0.25)).toBe(0.25);
    expect(domTiming(1234)).toBe(1234);
  });

  it('reads zero, negative, non-finite and non-number values as 0', () => {
    for (const raw of [0, -0, -1, NaN, Infinity, -Infinity, '12', null, undefined, {}]) {
      expect(domTiming(raw)).toBe(0);
    }
  });
});
