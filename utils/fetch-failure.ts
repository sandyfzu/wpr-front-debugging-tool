/**
 * What a rejected `fetch` (or a body read under the same signal) means for
 * its caller: the timeout signal fired, or the transport failed.
 */

/** Why a fetch produced no answer. */
export type FetchFailureKind = 'timeout' | 'network-error';

/**
 * Classify a fetch rejection: an abort (`AbortSignal.timeout` rejects with
 * `TimeoutError`; a manual or older abort with `AbortError`) reads as
 * `timeout`, anything else as `network-error`.
 *
 * @param cause The rejection.
 */
export function fetchFailureKind(cause: unknown): FetchFailureKind {
  return cause instanceof DOMException &&
    (cause.name === 'TimeoutError' || cause.name === 'AbortError')
    ? 'timeout'
    : 'network-error';
}
