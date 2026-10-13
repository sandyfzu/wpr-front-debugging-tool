/** Tests for the no-receiver failure classification (the miss/real branch point). */
import { describe, expect, it } from 'vitest';
import { isNoReceiverError } from './no-receiver';

describe('isNoReceiverError', () => {
  it('matches the Chromium runtime bridge rejection, wherever it appears', () => {
    expect(
      isNoReceiverError(new Error('Could not establish connection. Receiving end does not exist.'))
    ).toBe(true);
    expect(isNoReceiverError(new Error('send: Could not establish connection after 0 ms'))).toBe(
      true
    );
  });

  it("matches the transport's own tab-send no-response error", () => {
    expect(isNoReceiverError(new Error('No response'))).toBe(true);
  });

  it("matches the test double's tab rejection", () => {
    expect(isNoReceiverError(new Error('No listeners available'))).toBe(true);
  });

  it('accepts non-Error rejections by their string form', () => {
    expect(isNoReceiverError('Could not establish connection')).toBe(true);
  });

  it('rejects real failures — wrong targets, crashes, unknown strings', () => {
    expect(isNoReceiverError(new Error('No listener for this channel'))).toBe(false);
    expect(isNoReceiverError(new Error('Handler threw: boom'))).toBe(false);
    expect(isNoReceiverError(new Error('Extension context invalidated'))).toBe(false);
    expect(isNoReceiverError({ message: 'No response' })).toBe(false); // plain objects: not an Error
    expect(isNoReceiverError(undefined)).toBe(false);
  });

  it('survives an Error whose message property is not a string', () => {
    const junk = new Error('has message');
    Object.defineProperty(junk, 'message', { value: undefined });
    expect(isNoReceiverError(junk)).toBe(false);
  });
});
