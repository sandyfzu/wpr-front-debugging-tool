/**
 * The exclusion builder's per-origin sets: origin → the set last saved for
 * that site (and when), so reopening the builder on a site restores its
 * rows. Lives in the `local:` area — support-site data stays on this
 * machine, never synced.
 *
 * Writers serialize through one write queue (read-modify-write over the
 * validated map); the background is the only reader and writer — the
 * overlay reads and saves its own origin's set through it
 * (`getSavedExclusionSet` / `saveExclusionSet` messages, origin resolved
 * from the sender; an apply saves only when it answers `applying`), never
 * this whole map — so the queue's one-context scope covers every writer. Reads
 * validate: corrupt entries are dropped, unknown entry fields ignored (a
 * newer build's value keeps parsing), and the map is held to an honest byte
 * budget by evicting the least recently updated origins.
 */

import { storage } from 'wxt/utils/storage';
import type { ExclusionSet } from '../exclusion-builder/set';
import { parseExclusionSet } from '../messaging/exclusion-session';
import { isRecord } from '../../utils/is-record';
import { isHttpOrigin } from '../../utils/urls';
import { createWriteQueue } from './write-queue';

/** The `local:exclusion-sets` store key, single-sourced. */
export const EXCLUSION_SETS_KEY = 'local:exclusion-sets';

/** One origin's saved set. */
export interface SavedExclusionSet {
  readonly set: ExclusionSet;
  /** Epoch ms of the save — the eviction order (oldest first). */
  readonly updatedAt: number;
}

/** The stored map: canonical http(s) origin → saved set. */
export type SavedExclusionSets = Record<string, SavedExclusionSet>;

/**
 * The map's byte budget: the UTF-8 size of the stored JSON (key included).
 * The `local:` area caps everything at 10,485,760 bytes of JSON across all
 * items (shared with the Known Conflicts cache); 4 MiB leaves the rest of
 * the area free while holding ≥ 20 worst-case sets (a set is bounded to
 * ~200 KiB) — and thousands of realistic ones.
 */
export const EXCLUSION_SETS_BYTE_BUDGET = 4 * 1024 * 1024;

/** The raw storage item (reads/writes go through the helpers below). */
export const exclusionSetsStore = storage.defineItem<SavedExclusionSets>(EXCLUSION_SETS_KEY, {
  fallback: {}
});

/** The item's write queue. */
const enqueueWrite = createWriteQueue();

/** UTF-8 encoder for the byte measure (stateless, reused). */
const encoder = new TextEncoder();

/** UTF-8 byte length of a value's JSON. */
function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/**
 * Hold the map to {@link EXCLUSION_SETS_BYTE_BUDGET}, evicting the least
 * recently updated origins first. Sizes are summed per entry (JSON object
 * serialization is braces + `"key":value` entries + commas), so the check
 * is exact without re-serializing the map per eviction.
 *
 * @param saved A validated map.
 * @param keep An origin never evicted (the one just written) — a bounded set
 *   alone always fits the budget.
 * @returns The map itself when within budget, else a fresh trimmed map.
 */
function withinByteBudget(saved: SavedExclusionSets, keep?: string): SavedExclusionSets {
  const entries = Object.entries(saved).map(([origin, entry]) => ({
    origin,
    // `"origin":` + the entry's JSON.
    bytes: jsonBytes(origin) + 1 + jsonBytes(entry),
    updatedAt: entry.updatedAt
  }));
  // `"exclusion-sets":` key overhead + braces + one comma between entries.
  const keyBytes = jsonBytes(EXCLUSION_SETS_KEY.slice('local:'.length)) + 1;
  let total = keyBytes + 2 + Math.max(0, entries.length - 1);
  for (const entry of entries) total += entry.bytes;
  if (total <= EXCLUSION_SETS_BYTE_BUDGET) return saved;
  const evictionOrder = entries
    .filter((entry) => entry.origin !== keep)
    .sort((a, b) => a.updatedAt - b.updatedAt);
  const evicted = new Set<string>();
  for (const entry of evictionOrder) {
    if (total <= EXCLUSION_SETS_BYTE_BUDGET) break;
    evicted.add(entry.origin);
    total -= entry.bytes + 1;
  }
  const kept: SavedExclusionSets = {};
  for (const [origin, entry] of Object.entries(saved)) {
    if (!evicted.has(origin)) kept[origin] = entry;
  }
  return kept;
}

/**
 * Validate a raw (possibly corrupt, partial, or foreign) stored map.
 *
 * - the value must be a non-null, non-array object, else null;
 * - a key must be a canonical http(s) origin; its entry an object with a
 *   valid set and a non-negative integer `updatedAt` — anything else is
 *   dropped, not trusted; unknown entry fields are ignored;
 * - the map is held to the byte budget (least recently updated evicted).
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseSavedExclusionSets(input: unknown): SavedExclusionSets | null {
  if (!isRecord(input)) return null;
  const parsed: SavedExclusionSets = {};
  for (const [origin, raw] of Object.entries(input)) {
    if (!isHttpOrigin(origin) || !isRecord(raw)) continue;
    const updatedAt = raw['updatedAt'];
    if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
      continue;
    }
    const set = parseExclusionSet(raw['set'], 'ignore');
    if (set !== null) parsed[origin] = { set, updatedAt };
  }
  return withinByteBudget(parsed);
}

/**
 * Read the map through the validator: corrupt storage degrades to empty
 * (no site has a saved set), never to fabricated entries.
 */
export async function getSavedExclusionSets(): Promise<SavedExclusionSets> {
  return parseSavedExclusionSets(await exclusionSetsStore.getValue()) ?? {};
}

/**
 * One origin's saved set.
 *
 * @param origin The page origin to look up.
 * @returns The set, or null when the origin has none (or it was corrupt).
 */
export async function getSavedExclusionSet(origin: string): Promise<ExclusionSet | null> {
  const saved = await getSavedExclusionSets();
  return Object.hasOwn(saved, origin) ? (saved[origin]?.set ?? null) : null;
}

/**
 * Save one origin's set (queued read-modify-write over the validated map;
 * other origins survive, the budget evicts the oldest others if needed).
 *
 * @param origin A canonical http(s) origin.
 * @param set The set to save (re-validated: callers pass parsed sets).
 * @param now The save time (epoch ms); injectable for tests.
 * @returns The map that was written. Rejects with an {@link Error} when
 *   `origin` is not a canonical http(s) origin or `set` fails the set guard
 *   (a broken caller — nothing touched), and with whatever the storage
 *   read/write rejects with (callers branch on it).
 */
export function saveExclusionSet(
  origin: string,
  set: ExclusionSet,
  now: number = Date.now()
): Promise<SavedExclusionSets> {
  if (!isHttpOrigin(origin)) {
    return Promise.reject(
      new Error(`saveExclusionSet: not a canonical http(s) origin: ${JSON.stringify(origin)}`)
    );
  }
  const checked = parseExclusionSet(set, 'reject');
  if (checked === null) {
    return Promise.reject(
      new Error(`saveExclusionSet: the set for ${origin} fails the exclusion-set guard`)
    );
  }
  return enqueueWrite(async () => {
    const current = parseSavedExclusionSets(await exclusionSetsStore.getValue()) ?? {};
    const next = withinByteBudget(
      { ...current, [origin]: { set: checked, updatedAt: now } },
      origin
    );
    await exclusionSetsStore.setValue(next);
    return next;
  });
}

/**
 * Forget one origin's set (queued read-modify-write; absent is a no-op write).
 *
 * @param origin The origin to forget.
 * @returns The map that was written.
 * @throws Whatever the storage read/write rejects with.
 */
export function removeSavedExclusionSet(origin: string): Promise<SavedExclusionSets> {
  return enqueueWrite(async () => {
    const next = { ...(parseSavedExclusionSets(await exclusionSetsStore.getValue()) ?? {}) };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the map is keyed by origin; removing one key is the operation
    delete next[origin];
    await exclusionSetsStore.setValue(next);
    return next;
  });
}
