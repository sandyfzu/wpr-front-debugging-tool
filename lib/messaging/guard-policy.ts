/**
 * Primitives shared by the session-contract guards (`./exclusion-session`,
 * `./exclusion-simulation`): the unknown-key policy and the count check —
 * declared once so both contract modules read keys and counts alike.
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
