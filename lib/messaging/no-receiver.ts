/**
 * Classification of the "nothing listening on the far side" send failures —
 * the branch point between an *expected* send miss and a real one (AGENTS.md's
 * expected ≠ unexpected rule).
 *
 * The failure surfaces, verified against the installed transport:
 * - Chromium's runtime bridge rejects extension sends with *"Could not
 *   establish connection. Receiving end does not exist."* (no listener).
 * - Tab-targeted sends resolve empty when the tab never answered, and the
 *   transport folds that into its own *"No response"* error.
 * - The unit-test double's tab API rejects with *"No listeners available"* —
 *   a test-world string, kept matched so behavior and tests agree.
 *
 * Anything else reaching a catch is a real failure on the way or on the
 * receiving side, and must be logged loudly, never dropped with the misses.
 */

/** Substrings that identify the no-receiver failures above. */
const NO_RECEIVER_PATTERNS = [
  'No listeners',
  'Could not establish connection',
  'No response'
] as const;

/**
 * Whether a caught send failure is the expected "nothing listening there
 * yet" case rather than a real fault.
 *
 * Junk-shaped failures (a non-Error with no readable message, an Error whose
 * `message` was replaced by junk) classify as *not* a miss — treating
 * unrecognizable shapes as real failures keeps the loud branch, never the
 * silent one.
 *
 * @param cause The caught send failure (any thrown/rejected value).
 * @returns True when the failure says no receiver existed.
 */
export function isNoReceiverError(cause: unknown): boolean {
  const message =
    cause instanceof Error && typeof cause.message === 'string' ? cause.message : String(cause);
  if (typeof message !== 'string') return false;
  return NO_RECEIVER_PATTERNS.some((pattern) => message.includes(pattern));
}
