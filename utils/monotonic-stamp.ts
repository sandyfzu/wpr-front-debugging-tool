/**
 * Epoch-millisecond stamps that never go backward within a context: the
 * high-resolution time origin plus the monotonic clock (immune to wall-clock
 * steps), floored to whole ms and kept strictly increasing — two stamps are
 * never equal, so they order events exactly.
 */

/** A monotonic clock reading as epoch ms (fractional allowed). */
export type EpochClock = () => number;

/** The platform's: the context's time origin plus `performance.now()`. */
const PLATFORM_CLOCK: EpochClock = () => performance.timeOrigin + performance.now();

/**
 * Create a stamp source.
 *
 * @param clock The monotonic epoch clock; defaults to the platform's.
 * @returns A function answering a strictly increasing whole-ms epoch stamp.
 */
export function createMonotonicStamp(clock: EpochClock = PLATFORM_CLOCK): () => number {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    last = Math.max(Math.floor(clock()), last + 1);
    return last;
  };
}
