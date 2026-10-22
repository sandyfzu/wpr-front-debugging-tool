/**
 * A bounded memo: a string-keyed cache that keeps at most `maxEntries`
 * values and at most `maxWeight` total weight (each entry weighs what
 * `weigh` says — e.g. the characters it retains), evicting the oldest
 * inserted first. A value heavier than the whole bound is returned but
 * never kept, so one huge input cannot flush the cache for nothing.
 */

/** A bounded memo's limits. */
export interface BoundedMemoLimits<V> {
  /** Most entries kept (≥ 1). */
  readonly maxEntries: number;
  /** Most total weight kept (≥ 0); unbounded when omitted. */
  readonly maxWeight?: number;
  /** An entry's weight (key and value); `0` when omitted. */
  readonly weigh?: (key: string, value: V) => number;
}

/** A bounded memo: read a key, building and maybe keeping the value on a miss. */
export interface BoundedMemo<V> {
  /**
   * The value for `key`, built with `build` on a miss.
   *
   * @param key The entry's key.
   * @param build Makes the value on a miss (must be pure for the key).
   */
  get(key: string, build: () => V): V;
  /** Entries kept now. */
  readonly size: number;
  /** Total weight kept now. */
  readonly weight: number;
}

/**
 * Create a bounded memo.
 *
 * @param limits The entry bound, and optionally the weight bound and weigher.
 * @returns An empty memo.
 * @throws {@link RangeError} when `maxEntries` < 1 or `maxWeight` < 0.
 */
export function createBoundedMemo<V>(limits: BoundedMemoLimits<V>): BoundedMemo<V> {
  const { maxEntries, maxWeight = Infinity, weigh = () => 0 } = limits;
  if (!(maxEntries >= 1)) throw new RangeError(`maxEntries must be ≥ 1, got ${String(maxEntries)}`);
  if (!(maxWeight >= 0)) throw new RangeError(`maxWeight must be ≥ 0, got ${String(maxWeight)}`);
  const entries = new Map<string, { readonly value: V; readonly weight: number }>();
  let total = 0;
  /** Evict the oldest entry. */
  const evictOldest = (): void => {
    const oldest = entries.entries().next();
    if (oldest.done === true) return;
    entries.delete(oldest.value[0]);
    total -= oldest.value[1].weight;
  };
  return {
    get(key, build) {
      const cached = entries.get(key);
      if (cached !== undefined) return cached.value;
      const value = build();
      const weight = weigh(key, value);
      if (weight > maxWeight) return value;
      while (entries.size >= maxEntries || total + weight > maxWeight) evictOldest();
      entries.set(key, { value, weight });
      total += weight;
      return value;
    },
    get size() {
      return entries.size;
    },
    get weight() {
      return total;
    }
  };
}
