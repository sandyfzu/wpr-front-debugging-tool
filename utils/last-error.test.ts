import { describe, expect, it } from 'vitest';
import {
  readLastError,
  UNKNOWN_LAST_ERROR,
  type LastErrorSlot,
  type LastErrorValue
} from './last-error';

/**
 * A runtime stub whose `lastError` getter counts its reads.
 *
 * @param value What the getter answers.
 */
function countingSlot(value: LastErrorValue): { slot: LastErrorSlot; reads: () => number } {
  let reads = 0;
  const slot = {
    get lastError(): LastErrorValue {
      reads += 1;
      return value;
    }
  };
  return { slot, reads: () => reads };
}

describe('readLastError', () => {
  it('answers null for both success spellings (Chromium undefined, Firefox null)', () => {
    for (const value of [undefined, null]) {
      const { slot, reads } = countingSlot(value);
      expect(readLastError(slot)).toBeNull();
      expect(reads()).toBe(1);
    }
    expect(readLastError({})).toBeNull();
  });

  it("answers the error's message, reading the getter exactly once", () => {
    const { slot, reads } = countingSlot({ message: 'Receiving end does not exist' });
    expect(readLastError(slot)).toBe('Receiving end does not exist');
    expect(reads()).toBe(1);
  });

  it('answers a placeholder for an error without a string message', () => {
    expect(readLastError({ lastError: {} })).toBe(UNKNOWN_LAST_ERROR);
    expect(readLastError({ lastError: { message: 42 } as unknown as LastErrorValue })).toBe(
      UNKNOWN_LAST_ERROR
    );
    // An empty message is still a reported error, not success.
    expect(readLastError({ lastError: { message: '' } })).toBe('');
  });
});
