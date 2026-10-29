/** The shared guard primitives: the unknown-key policy and the count check. */
import { describe, expect, it } from 'vitest';
import { isCount, keysAllowed } from './guard-policy';

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
