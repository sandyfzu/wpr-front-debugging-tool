/**
 * Bounded key → entry maps for one storage item: the serialized byte count
 * the storage area measures, a write-recency rank per entry, and the
 * least-recent-first trim that keeps the item inside a byte budget.
 *
 * Recency is an explicit per-entry rank, never the map's key order: Chromium
 * hands stored objects back with their keys sorted (its storage values are
 * sorted dictionaries), so "insertion order" would evict alphabetically after
 * the first round trip. The rank is a counter (the map's highest + 1 on each
 * write — a few digits, unlike a 13-digit timestamp), bumped on writes only:
 * reads never write, which keeps the sync area's write-rate quotas out of
 * page loads.
 */

/** An entry that may carry a write-recency rank (absent on older entries = least recent). */
export interface RecencyRanked {
  /** The write-recency rank: higher = written more recently. */
  used?: number;
}

/**
 * Validate a stored recency rank: a non-negative safe integer, else absent
 * (the entry itself stays — a broken rank only demotes it to least recent).
 *
 * @param value Any storage-delivered value.
 */
export function parseRecency(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Whether a key may be stored in a bounded map: non-empty, and never
 * `__proto__` — that key would set the prototype of the plain objects the
 * maps are rebuilt into instead of adding an entry (no real origin is either).
 *
 * @param key A caller- or storage-delivered key.
 */
export function isStorableKey(key: string): boolean {
  return key !== '' && key !== '__proto__';
}

/**
 * The rank a new write stamps: one above the map's highest (1 on an
 * unranked map).
 *
 * @param map A validated map.
 */
export function nextRecency(map: Readonly<Record<string, RecencyRanked>>): number {
  let highest = 0;
  for (const entry of Object.values(map)) highest = Math.max(highest, entry.used ?? 0);
  return highest + 1;
}

/**
 * The map with one entry written as the most recent. When the highest rank
 * has reached the safe-integer ceiling (corrupt storage only — a real
 * counter never gets there), the ranks are first renumbered 1…n in their
 * current order, so the stamp stays above every other rank instead of
 * landing on an unsafe value the next read would drop (which would make the
 * newest entry the first evicted).
 *
 * @param map A validated map.
 * @param key The entry's key (see {@link isStorableKey}).
 * @param entry The entry to store; its own `used` is replaced.
 * @returns A fresh map (the input is not mutated).
 */
export function withMostRecent<E extends RecencyRanked>(
  map: Readonly<Record<string, E>>,
  key: string,
  entry: E
): Record<string, E> {
  let base: Readonly<Record<string, E>> = map;
  let next = nextRecency(map);
  if (!Number.isSafeInteger(next)) {
    const renumbered: Record<string, E> = {};
    // `sort` is stable: equal ranks keep their map order.
    Object.entries(map)
      .sort(([, a], [, b]) => (a.used ?? 0) - (b.used ?? 0))
      .forEach(([k, ranked], order) => {
        renumbered[k] = { ...ranked, used: order + 1 };
      });
    base = renumbered;
    next = Object.keys(map).length + 1;
  }
  return { ...base, [key]: { ...entry, used: next } };
}

/**
 * The bytes a storage area counts for one item: the bare key's length plus
 * the value's JSON (Chrome's and Firefox's documented per-item measure).
 * Keys and values here are ASCII by construction (origins are IDNA-encoded),
 * so JSON length equals the UTF-8 byte count.
 *
 * @param bareKey The item key without its `sync:`/`local:` area prefix.
 * @param value The value as it will be stored.
 */
export function itemBytes(bareKey: string, value: unknown): number {
  return bareKey.length + JSON.stringify(value).length;
}

/**
 * Trim a map to a byte budget, evicting least-recent entries first (ties in
 * map order). Byte accounting is incremental (each entry's `"key":value`
 * text plus its comma), so the trim is one sort, never a re-serialization
 * per eviction. Survivors keep their map order.
 *
 * The last surviving entry is never evicted: a single entry that alone
 * exceeds the budget is kept, so the caller's write reaches the platform and
 * its quota rejection propagates instead of a silently dropped user write.
 *
 * @param bareKey The item key without its area prefix (counted by the area).
 * @param map A validated own-copy map.
 * @param budget The byte ceiling for {@link itemBytes} of the result.
 * @returns The map itself when it fits, else a fresh trimmed map.
 */
export function trimToByteBudget<E extends RecencyRanked>(
  bareKey: string,
  map: Readonly<Record<string, E>>,
  budget: number
): Record<string, E> {
  const keys = Object.keys(map);
  // `{` + `}` + the entries + (n − 1) commas; an empty map is `{}`.
  const entryBytes = keys.map(
    (key) => JSON.stringify(key).length + 1 + JSON.stringify(map[key]).length
  );
  let total = bareKey.length + 2 + entryBytes.reduce((sum, bytes) => sum + bytes + 1, 0) - 1;
  if (keys.length === 0 || total <= budget) return map;
  const evictionOrder = keys
    .map((key, index) => ({ index, rank: map[key]?.used ?? 0 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  const evicted = new Set<number>();
  for (const { index } of evictionOrder) {
    if (total <= budget || evicted.size === keys.length - 1) break;
    evicted.add(index);
    total -= (entryBytes[index] ?? 0) + 1;
  }
  const kept: Record<string, E> = {};
  keys.forEach((key, index) => {
    const entry = map[key];
    if (!evicted.has(index) && entry !== undefined) kept[key] = entry;
  });
  return kept;
}
