/**
 * Primitives shared by the message and storage guards: the unknown-key
 * policy, the count, timing and bounded-string checks — declared once so
 * every contract module reads keys, counts, timings and strings alike.
 */
import { hasOnlyKeys } from '../../utils/is-record';

/**
 * How a guard treats keys it does not know: `'reject'` for messages (both
 * ends ship in one build, so an unknown key is drift or forgery),
 * `'ignore'` for storage reads (a value written by a newer build keeps
 * parsing — unknown keys are dropped, never carried).
 */
export type UnknownKeyPolicy = 'reject' | 'ignore';

/**
 * Whether a record's keys pass the policy: under `'reject'` every own key
 * must be one of `allowed`; `'ignore'` lets unknown keys through (the
 * rebuild copies only known ones).
 *
 * @param record The record (already past `isRecord`).
 * @param allowed The known keys.
 * @param policy The unknown-key policy.
 */
export function keysAllowed(
  record: Record<string, unknown>,
  allowed: readonly string[],
  policy: UnknownKeyPolicy
): boolean {
  return policy === 'ignore' || hasOnlyKeys(record, allowed);
}

/** A non-negative safe integer (counts, indices, epoch ms, run ids). */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A finite, non-negative number (DOM timings, sizes, shift scores).
 *
 * @param value The boundary value.
 */
export function isTiming(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * A string of at most `max` UTF-16 units.
 *
 * @param value The boundary value.
 * @param max The unit cap.
 */
export function boundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}
