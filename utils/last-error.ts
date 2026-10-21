/**
 * Reading `runtime.lastError` inside an extension API callback. Unset is
 * spelled differently per engine — `undefined` on Chromium, `null` on
 * Firefox (observed after every successful callback) — so a check against
 * one spelling breaks on the other; every reader goes through here.
 */

/** The shape of a set `runtime.lastError`. */
export interface LastErrorLike {
  readonly message?: string | undefined;
}

/**
 * The error message of a `runtime.lastError` value, or null when unset.
 *
 * @param error The value read (inside the callback) from `runtime.lastError`.
 * @returns The message (a stable fallback when the error carries none), or
 *   null when no error is set (`undefined` or `null`).
 */
export function lastErrorMessage(error: LastErrorLike | null | undefined): string | null {
  if (error === undefined || error === null) return null;
  return error.message ?? 'Unknown error';
}
