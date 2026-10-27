/**
 * Tests for the tab-send transport guard: the claim under audit is that the
 * completion callback reads `runtime.lastError` (the Chromium binding counts
 * the send as acknowledged then — no "Unchecked" console error) while the
 * response and both call arities stay untouched.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preventUncheckedLastError } from './tab-send';

/** How many times the test's `lastError` stub was read. */
let lastErrorReads: number;

/** Install a `chrome.runtime.lastError` getter stub over the real global. */
function stubLastError(value: { message: string } | null | undefined): void {
  Object.defineProperty(chrome.runtime, 'lastError', {
    configurable: true,
    get: () => {
      lastErrorReads += 1;
      return value;
    }
  });
}

afterEach(() => {
  // Drop the stub of the global property the tests touched.
  Reflect.deleteProperty(chrome.runtime, 'lastError');
});

describe('preventUncheckedLastError', () => {
  it('reads lastError inside the callback when the send failed (4-arity)', () => {
    lastErrorReads = 0;
    stubLastError({ message: 'Receiving end does not exist' });
    const send = preventUncheckedLastError(((
      _tabId: number,
      _message: unknown,
      _options: unknown,
      callback: (r: unknown) => void
    ) => {
      callback(undefined);
    }) as unknown as typeof chrome.tabs.sendMessage);
    const originalCallback = vi.fn();
    send(7, { type: 'x' }, undefined, originalCallback);
    // The guard read the error (the mechanism) and forwarded the response
    // unchanged (the semantics).
    expect(lastErrorReads).toBe(1);
    expect(originalCallback).toHaveBeenCalledWith(undefined);
  });

  it('forwards a real response on success without touching lastError', () => {
    lastErrorReads = 0;
    stubLastError(undefined);
    const response = { res: 'ok' };
    const send = preventUncheckedLastError(((
      _tabId: number,
      _message: unknown,
      _options: unknown,
      callback: (r: unknown) => void
    ) => {
      callback(response);
    }) as unknown as typeof chrome.tabs.sendMessage);
    const originalCallback = vi.fn();
    send(1, { type: 'x' }, undefined, originalCallback);
    expect(lastErrorReads).toBe(1);
    expect(originalCallback).toHaveBeenCalledWith(response);
  });

  it('handles the 3-arity call (callback in the options slot)', () => {
    lastErrorReads = 0;
    stubLastError(undefined);
    const send = preventUncheckedLastError(((
      _tabId: number,
      _message: unknown,
      callback: (r: unknown) => void
    ) => {
      callback('ack');
    }) as unknown as typeof chrome.tabs.sendMessage);
    const originalCallback = vi.fn();
    send(2, { type: 'x' }, originalCallback);
    expect(originalCallback).toHaveBeenCalledWith('ack');
  });

  it('forwards a callback-less call untouched rather than guessing', () => {
    lastErrorReads = 0;
    stubLastError({ message: 'whatever' });
    const passthrough = vi.fn();
    const send = preventUncheckedLastError(passthrough);
    // Callback-less 4-arity forwarded exactly as given (the transport
    // defines callback-style here; the guard never guesses a contract).
    void send(3, { type: 'x' }, { frameId: 2 });
    expect(passthrough).toHaveBeenCalledWith(3, { type: 'x' }, { frameId: 2 }, undefined);
  });

  it('still forwards the empty response after acknowledging the error', () => {
    // The transport contract under this file: a failed tab send resolves
    // empty and the library folds that into its own no-response rejection —
    // the guard may read the error but must not alter that resolution.
    lastErrorReads = 0;
    stubLastError({ message: 'No response' });
    const send = preventUncheckedLastError(((
      _tabId: number,
      _message: unknown,
      _options: unknown,
      callback: (r: unknown) => void
    ) => {
      callback(undefined);
    }) as unknown as typeof chrome.tabs.sendMessage);
    const originalCallback = vi.fn();
    send(9, { type: 'x' }, undefined, originalCallback);
    expect(originalCallback).toHaveBeenCalledWith(undefined);
  });

  it('forwards a successful send when the platform sets lastError to null (Firefox)', () => {
    // Firefox leaves `runtime.lastError` null (not undefined) after a
    // successful send; the guard must neither throw nor swallow the response.
    lastErrorReads = 0;
    stubLastError(null);
    const response = { res: 'ok' };
    const send = preventUncheckedLastError(((
      _tabId: number,
      _message: unknown,
      _options: unknown,
      callback: (r: unknown) => void
    ) => {
      callback(response);
    }) as unknown as typeof chrome.tabs.sendMessage);
    const originalCallback = vi.fn();
    // A throwing read would surface here and leave the callback uncalled.
    send(4, { type: 'x' }, undefined, originalCallback);
    expect(lastErrorReads).toBe(1);
    expect(originalCallback).toHaveBeenCalledWith(response);
  });
});
