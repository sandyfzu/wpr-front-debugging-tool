/**
 * The on-page detection widget's per-origin override store: one bounded
 * origin → `{ enabled, used }` map sync'd across a user's browsers (the drag
 * position lives in its sibling item, `./inspector-positions`).
 *
 * Precedence: an explicit per-origin entry wins over the global default (the
 * `features.onPageInspector` option, `./options` — on by default), and
 * origins without an entry follow it. Every writer (the context-menu row,
 * the command palette; the popup's row later) toggles through the one
 * helper here, so the toggling semantics live exactly once: a toggle flips
 * the site's current effective state and persists it as an explicit entry —
 * read-modify-write over the validated shape, bounded, and coercing corrupt
 * storage into the fresh valid map (a broken value never blocks the user's
 * toggle). Reads validate; corrupt or foreign values degrade to
 * no-explicit-entries (every origin follows the default), never to
 * fabricated overrides.
 */

import { storage } from 'wxt/utils/storage';
import { getOptions, ON_PAGE_INSPECTOR, type StoredOptions } from './options';
import { nextRecency, parseRecency, trimToByteBudget, type RecencyRanked } from './recency-map';

/** The `sync:inspector-origins` store key, single-sourced. */
export const INSPECTOR_ORIGINS_KEY = 'sync:inspector-origins';

/**
 * What one origin stores: its explicit override, plus the write-recency rank
 * the eviction reads (absent on entries written before ranks existed — they
 * parse unchanged and rank least recent).
 */
export interface InspectorOriginEntry extends RecencyRanked {
  enabled: boolean;
}

/** The stored map: origin → entry. */
export type InspectorOrigins = Record<string, InspectorOriginEntry>;

/**
 * The byte budget the stored item (bare key + JSON, the area's own measure)
 * is trimmed to: the sync area rejects any item over 8,192 bytes, so the
 * write evicts least-recently-written entries until the item fits 7 KiB —
 * 1 KiB headroom under the platform ceiling for any measuring difference
 * between engines. A typical entry (a ~26-character origin, an override and
 * a three-digit rank) costs ~60 bytes, so the map holds ~120 overrides;
 * 253-character hosts (the longest a URL can carry) still keep ~24.
 */
export const INSPECTOR_ORIGINS_BYTE_BUDGET = 7168;

/** The sync area's per-item quota (`QUOTA_BYTES_PER_ITEM`, Chrome and Firefox alike). */
export const INSPECTOR_ORIGINS_QUOTA_LIMIT = 8192;

/** The item's key as the storage area counts it (no area prefix). */
const BARE_KEY = INSPECTOR_ORIGINS_KEY.slice('sync:'.length);

/** The raw storage item (reads/writes go through the helpers below). */
export const inspectorOriginsStore = storage.defineItem<InspectorOrigins>(INSPECTOR_ORIGINS_KEY, {
  fallback: {}
});

/**
 * Validate a raw (possibly corrupt, partial, older, or newer) stored map.
 *
 * - the value must be a non-null, non-array object, else null (the caller's
 *   documented degradation);
 * - an origin key must be a non-empty string; its entry must be an object
 *   carrying a boolean `enabled` — anything else is dropped, not trusted;
 * - `used` is kept only as a non-negative safe integer (a broken rank only
 *   demotes the entry); unknown fields are tolerated and not carried;
 * - the map keeps its serialized bytes inside the byte budget — least
 *   recently written entries evicted first.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseInspectorOrigins(input: unknown): InspectorOrigins | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const parsed: InspectorOrigins = {};
  for (const [origin, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    if (origin === '') continue;
    if (typeof rawEntry !== 'object' || rawEntry === null) continue;
    const { enabled, used } = rawEntry as { enabled?: unknown; used?: unknown };
    if (typeof enabled !== 'boolean') continue;
    const rank = parseRecency(used);
    parsed[origin] = rank === undefined ? { enabled } : { enabled, used: rank };
  }
  return trimToByteBudget(BARE_KEY, parsed, INSPECTOR_ORIGINS_BYTE_BUDGET);
}

/**
 * Read the map through the validator: corrupt storage degrades to empty
 * (every origin resolves to the global default), never to fabricated
 * entries.
 */
export async function getInspectorOrigins(): Promise<InspectorOrigins> {
  return parseInspectorOrigins(await inspectorOriginsStore.getValue()) ?? {};
}

/**
 * The global default for origins without an entry, read from validated
 * options (a corrupt options item already degrades to the documented
 * default there).
 *
 * @param options Validated options.
 */
export function inspectorDefaultEnabled(options: StoredOptions): boolean {
  return options.features[ON_PAGE_INSPECTOR];
}

/**
 * One origin's effective widget state: an explicit per-origin entry wins;
 * origins without one follow the global default. An empty map (a fresh
 * install) or a degraded corrupt read therefore reports the default
 * everywhere — no overrides are ever invented from thin air.
 *
 * @param origins A validated own-copy map.
 * @param origin The page origin to resolve.
 * @param defaultEnabled The global default (see {@link inspectorDefaultEnabled}).
 */
export function effectiveInspectorEnabled(
  origins: InspectorOrigins,
  origin: string,
  defaultEnabled: boolean
): boolean {
  return origins[origin]?.enabled ?? defaultEnabled;
}

/**
 * Whether one origin is enabled now: the stored map over the stored default.
 *
 * @param origin The page origin to look up.
 */
export async function isInspectorOriginEnabled(origin: string): Promise<boolean> {
  const [origins, options] = await Promise.all([getInspectorOrigins(), getOptions()]);
  return effectiveInspectorEnabled(origins, origin, inspectorDefaultEnabled(options));
}

/**
 * Flip one origin's visible state and persist it as an explicit entry. A
 * toggle always changes the site's behavior whatever the default reads: at
 * the default-on state an unconfigured origin is showing, so the flip
 * writes `false` — whose entry then keeps the site closed even if the
 * global default changes later — and the next toggle reads that entry back.
 * The whole map persists read-modify-write over the validated shape, the
 * toggled entry ranked most recent and the map trimmed to its byte budget,
 * so every other origin survives unless the budget evicts the least
 * recently written. A corrupt stored value degrades to the fresh valid map
 * (the only truth a toggle can write).
 *
 * @param origin The origin to toggle.
 * @returns The entry state after the write (the persisted truth).
 * @throws The storage read/write rejects as the platform does (e.g. an
 *   invalidated extension context, or a single oversized entry over the
 *   quota) — callers branch (validate-and-log).
 */
export async function toggleInspectorOrigin(origin: string): Promise<boolean> {
  const [raw, options] = await Promise.all([inspectorOriginsStore.getValue(), getOptions()]);
  const current: InspectorOrigins = parseInspectorOrigins(raw) ?? {};
  const enabled = !effectiveInspectorEnabled(current, origin, inspectorDefaultEnabled(options));
  const next = trimToByteBudget(
    BARE_KEY,
    { ...current, [origin]: { enabled, used: nextRecency(current) } },
    INSPECTOR_ORIGINS_BYTE_BUDGET
  );
  await inspectorOriginsStore.setValue(next);
  return enabled;
}
