import { describe, expect, it } from 'vitest';
import { isRecord, ownValue } from './is-record';

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
