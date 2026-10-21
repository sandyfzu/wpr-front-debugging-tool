/**
 * The `runtime.lastError` reading rule: unset is `undefined` on Chromium and
 * `null` on Firefox — both mean "no error"; a set error yields its message.
 */
import { describe, expect, it } from 'vitest';
import { lastErrorMessage } from './last-error';

describe('lastErrorMessage', () => {
  it('reads unset as no error, whichever way the platform spells it', () => {
    expect(lastErrorMessage(undefined)).toBeNull();
    expect(lastErrorMessage(null)).toBeNull();
  });

  it('returns a set error’s message, or a stable fallback when it has none', () => {
    expect(lastErrorMessage({ message: 'Receiving end does not exist' })).toBe(
      'Receiving end does not exist'
    );
    expect(lastErrorMessage({})).toBe('Unknown error');
  });
});
