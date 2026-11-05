import { describe, expect, it } from 'vitest';
import { createRandomId, isRandomId } from './random-id';

describe('createRandomId', () => {
  it('creates distinct 32-hex identities', () => {
    const first = createRandomId();
    expect(first).toMatch(/^[\da-f]{32}$/);
    expect(createRandomId()).not.toBe(first);
  });
});

describe('isRandomId', () => {
  it('accepts only the fixed hex shape', () => {
    expect(isRandomId(createRandomId())).toBe(true);
    expect(isRandomId('A'.repeat(32))).toBe(true);
    for (const junk of ['', 'g'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 42, null, undefined]) {
      expect(isRandomId(junk)).toBe(false);
    }
  });
});
