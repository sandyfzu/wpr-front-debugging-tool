/**
 * One reader for the extension runtime's `lastError` slot, read inside an API
 * callback. Reading the getter is what acknowledges the error (Chromium logs
 * an unread one as "Unchecked runtime.lastError"), so the read happens exactly
 * once, here. "No error" has two platform spellings: Chromium leaves the slot
 * `undefined`, Firefox sets it to `null` on every successful call — so a
 * `!== undefined` check alone dereferences `null` and throws inside the
 * callback, before it can deliver its result.
 */

/** The platform's error value as either browser reports it. */
export type LastErrorValue = { readonly message?: string } | null | undefined;

/** A `runtime`-shaped holder of the `lastError` slot (the real one, or a test stub). */
export interface LastErrorSlot {
  readonly lastError?: LastErrorValue;
}

/** The message reported for an error that carries none. */
export const UNKNOWN_LAST_ERROR = 'Unknown error';

/**
 * Read (and so acknowledge) `runtime.lastError` once.
 *
 * @param runtime The runtime whose slot is read — pass the object, not the
 *   value, so the getter read happens here.
 * @returns The error's message ({@link UNKNOWN_LAST_ERROR} when it has none),
 *   or `null` when the call succeeded (`undefined` or `null` slot).
 */
export function readLastError(runtime: LastErrorSlot): string | null {
  const value = runtime.lastError;
  if (value === undefined || value === null) return null;
  return typeof value.message === 'string' ? value.message : UNKNOWN_LAST_ERROR;
}
