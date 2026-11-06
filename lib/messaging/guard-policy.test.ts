/** The shared guard primitives: the unknown-key policy, the count, timing and bounded-string checks. */
import { describe, expect, it } from 'vitest';
import { boundedString, isCount, isTiming, keysAllowed } from './guard-policy';

describe('keysAllowed', () => {
  it('refuses unknown keys under reject only', () => {
    expect(keysAllowed({ a: 1 }, ['a', 'b'], 'reject')).toBe(true);
    expect(keysAllowed({ a: 1, c: 2 }, ['a'], 'reject')).toBe(false);
    expect(keysAllowed({ a: 1, c: 2 }, ['a'], 'ignore')).toBe(true);
  });
});

describe('isCount', () => {
  it('accepts non-negative safe integers only', () => {
    for (const ok of [0, 1, Number.MAX_SAFE_INTEGER]) expect(isCount(ok)).toBe(true);
    for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
      expect(isCount(bad)).toBe(false);
    }
  });
});

describe('isTiming', () => {
  it('accepts finite, non-negative numbers only', () => {
    for (const ok of [0, 0.5, 1234.25, Number.MAX_VALUE]) expect(isTiming(ok)).toBe(true);
    for (const bad of [-0.1, -1, NaN, Infinity, -Infinity, '1', null, undefined]) {
      expect(isTiming(bad)).toBe(false);
    }
  });
});

describe('boundedString', () => {
  it('accepts strings up to the cap (inclusive), nothing else', () => {
    expect(boundedString('', 0)).toBe(true);
    expect(boundedString('abc', 3)).toBe(true);
    expect(boundedString('abcd', 3)).toBe(false);
    for (const bad of [1, null, undefined, ['a']]) expect(boundedString(bad, 10)).toBe(false);
  });
});
