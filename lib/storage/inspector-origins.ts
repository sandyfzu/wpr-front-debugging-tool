/**
 * The on-page detection widget's per-origin opt-in store (the early slice of
 * the phase-12 per-origin store, which later grows the drag-position field):
 * one bounded origin → `{ enabled }` map sync'd across a user's browsers.
 *
 * Every writer (the context-menu row today, the popup/Detections/options
 * rows later) toggles through the one helper here, so the toggling semantics
 * live exactly once: read-modify-write over the validated shape, capped, and
 * coercing corrupt storage into the fresh valid map (the options store's
 * self-healing degradation — a broken value never blocks the user's toggle).
 * Reads validate; corrupt or foreign values degrade to no-origins-enabled
 * (the widget stays hidden — a safe default), never to fabricated opt-ins.
 */

import { storage } from 'wxt/utils/storage';

/** The `sync:inspector-origins` store key, single-sourced. */
export const INSPECTOR_ORIGINS_KEY = 'sync:inspector-origins';

/** What one origin stores (the slice that later grows the position field). */
export interface InspectorOriginEntry {
  enabled: boolean;
}

/** The stored map: origin → entry. */
export type InspectorOrigins = Record<string, InspectorOriginEntry>;

/**
 * The origin map's honest bound: the serialized byte budget the stored JSON
 * must keep. The sync area rejects any single item over 8,192 bytes
 * (including the `inspector-origins` key and JSON quoting — the proved
 * failure of a per-entry-count cap: even the shortest realistic origins
 * exceed it at 200 rows), so the write trims by those bytes, evicting
 * insertion-order-oldest entries until the map fits well under the platform
 * ceiling; a count cap cannot see the quota, and the platform's rejection
 * surfaced only as a logged, dead right-click.
 */
export const INSPECTOR_ORIGINS_BYTE_BUDGET = 7168;

/**
 * The per-item storage quota of the sync area the map lives in (Chrome's
 * `QUOTA_BYTES_PER_ITEM`), headroom included: keys are origins — ASCII by
 * construction (an http(s) host is IDNA-encoded), so JSON length equals the
 * platform's UTF-8 byte count. The budget pin asserts the whole item stays
 * inside this ceiling.
 */
export const INSPECTOR_ORIGINS_QUOTA_LIMIT = 8192;

/** The raw storage item (reads/writes go through the helpers below). */
export const inspectorOriginsStore = storage.defineItem<InspectorOrigins>(INSPECTOR_ORIGINS_KEY, {
  fallback: {}
});

/**
 * Apply the byte budget: entries beyond it evicted insertion-order oldest
 * first, until the serialized item (the key + the JSON — what the sync area
 * counts) fits inside the platform quota with headroom. The one bound rule,
 * shared by the validator and the toggle's write; the result is a fresh
 * object whose insertion order keeps the survivors.
 *
 * A single entry that alone exceeds the budget (not a real origin — real
 * origins stay short, see the quota note) is kept as-is: silently dropping
 * the user's own entry would lie, and the platform's rejection propagates
 * through the write's promise, which callers report.
 *
 * @param origins A validated own-copy map.
 */
function withinByteBudget(origins: InspectorOrigins): InspectorOrigins {
  // `<"inspector-origins":` + `>` — the item's key overhead is +3 over the
  // bare JSON (2 quotes + the colon).
  const serializedLength = (): number =>
    INSPECTOR_ORIGINS_KEY.length + 2 + 1 + JSON.stringify(origins).length;
  if (serializedLength() <= INSPECTOR_ORIGINS_QUOTA_LIMIT) return origins;
  let survivors = Object.keys(origins);
  while (serializedLength() > INSPECTOR_ORIGINS_QUOTA_LIMIT && survivors.length > 0) {
    survivors = survivors.slice(1);
    const kept: InspectorOrigins = {};
    for (const origin of survivors) {
      // The key came from the map's own key list — narrow the indexed read.
      const entry = origins[origin];
      if (entry !== undefined) kept[origin] = entry;
    }
    origins = kept;
  }
  return origins;
}

/**
 * Validate a raw (possibly corrupt, partial, or foreign) stored map.
 *
 * - the value must be a non-null, non-array object, else null (the caller's
 *   documented degradation);
 * - an origin key must be a non-empty string; its entry must be an object
 *   carrying a boolean `enabled` — anything else is dropped, not trusted;
 * - the map keeps its serialized bytes inside the platform quota
 *   (see {@link withinByteBudget}) — oldest-inserted rows evicted first.
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
    const { enabled } = rawEntry as { enabled?: unknown };
    if (typeof enabled !== 'boolean') continue;
    parsed[origin] = { enabled };
  }
  return withinByteBudget(parsed);
}

/**
 * Read the map through the validator: corrupt storage degrades to empty
 * (every origin reads disabled), not to fabricated entries.
 */
export async function getInspectorOrigins(): Promise<InspectorOrigins> {
  return parseInspectorOrigins(await inspectorOriginsStore.getValue()) ?? {};
}

/** Whether one origin is enabled on a validated map. */
export function originEnabled(origins: InspectorOrigins, origin: string): boolean {
  return origins[origin]?.enabled === true;
}

/**
 * Whether one origin is enabled on the stored map (the mount gate's ask).
 * A corrupt map reads disabled.
 *
 * @param origin The page origin to look up.
 */
export async function isInspectorOriginEnabled(origin: string): Promise<boolean> {
  return originEnabled(await getInspectorOrigins(), origin);
}

/**
 * Flip one origin's entry and persist the whole map (read-modify-write over
 * the validated shape, capped, so every other origin — and any field a
 * future slice adds — survives the write). A corrupt stored value degrades
 * to the fresh valid map (the only truth a toggle can write).
 *
 * @param origin The origin to toggle.
 * @returns The entry state after the write (the persisted truth).
 * @throws The storage read/write rejects as the platform does (e.g. an
 *   invalidated extension context) — callers branch (validate-and-log).
 */
export async function toggleInspectorOrigin(origin: string): Promise<boolean> {
  const stored = parseInspectorOrigins(await inspectorOriginsStore.getValue());
  const current: InspectorOrigins = stored ?? {};
  const next: InspectorOrigins = withinByteBudget({
    ...current,
    [origin]: { enabled: !originEnabled(current, origin) }
  });
  await inspectorOriginsStore.setValue(next);
  return next[origin]?.enabled ?? false;
}
