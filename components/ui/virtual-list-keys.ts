/**
 * The virtual list's key snapshot: the caller's `getItemKey` re-issued as a
 * function whose identity changes exactly when the keys it yields change.
 *
 * Why: the virtualizer core caches its measurements (and so every row's key)
 * until `count` or the `getItemKey` function itself changes identity. A
 * caller's key function is one closure over its live rows, so a filter or
 * search that swaps the rows but keeps their number (one match replaced by
 * another) would leave the core serving the old keys — the list would keep
 * rendering the rows that are no longer listed.
 */

/** A key function. */
export type ItemKeyOf = (index: number) => string | number;

/** One snapshot of the keys a key function yields over a count. */
export interface KeySnapshot {
  /** The caller's function the snapshot was taken from. */
  readonly keyOf: ItemKeyOf;
  /** Its keys for indexes `0…count-1`. */
  readonly keys: readonly (string | number)[];
  /** The key function handed to the core: the snapshot's keys, the caller's past its end. */
  readonly at: ItemKeyOf;
}

/**
 * Take the keys of `keyOf` over `count` indexes, keeping `previous` (same
 * object, so the core keeps its measurements) when the caller and every key
 * are unchanged.
 *
 * @param previous The last snapshot, if any.
 * @param keyOf The caller's key function.
 * @param count The row count.
 * @returns `previous` when nothing changed, else a new snapshot.
 */
export function snapshotKeys(
  previous: KeySnapshot | undefined,
  keyOf: ItemKeyOf,
  count: number
): KeySnapshot {
  const keys = Array.from({ length: Math.max(0, count) }, (_, index) => keyOf(index));
  if (previous?.keyOf === keyOf && sameKeys(previous.keys, keys)) return previous;
  return { keyOf, keys, at: (index) => keys[index] ?? keyOf(index) };
}

/**
 * Whether two key lists are equal, in order.
 *
 * @param a One list.
 * @param b The other.
 * @returns True for the same keys at the same indexes.
 */
function sameKeys(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}
