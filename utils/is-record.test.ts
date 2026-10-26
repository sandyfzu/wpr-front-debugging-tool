import { describe, expect, it } from 'vitest';
import { hasOnlyKeys, isRecord, ownValue } from './is-record';

describe('isRecord', () => {
  it('accepts plain objects and class instances, rejects null and arrays', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(new Date())).toBe(true); // structural only — caller's field checks decide
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(7)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

describe('ownValue', () => {
  it('reads own properties only (an inherited key reads as absent)', () => {
    expect(ownValue({ a: 1 }, 'a')).toBe(1);
    expect(ownValue({ a: undefined }, 'a')).toBeUndefined();
    expect(ownValue(Object.create({ a: 1 }) as Record<string, unknown>, 'a')).toBeUndefined();
    expect(ownValue({}, 'toString')).toBeUndefined();
  });
});

describe('hasOnlyKeys', () => {
  it('accepts a subset of the allowed keys (missing keys are the field checks’ job)', () => {
    expect(hasOnlyKeys({ a: 1, b: 2 }, ['a', 'b', 'c'])).toBe(true);
    expect(hasOnlyKeys({}, ['a'])).toBe(true);
  });

  it('refuses any extra own key, even an undefined-valued one', () => {
    expect(hasOnlyKeys({ a: 1, x: 2 }, ['a'])).toBe(false);
    expect(hasOnlyKeys({ x: undefined }, ['a'])).toBe(false);
    expect(hasOnlyKeys({ a: 1 }, [])).toBe(false);
  });

  it('ignores inherited keys', () => {
    expect(hasOnlyKeys(Object.create({ x: 1 }) as Record<string, unknown>, [])).toBe(true);
  });
});
