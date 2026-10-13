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
 * The origin cap. Unbounded maps grow with every site a user right-clicks;
 * entries beyond the cap evict oldest-inserted (Map/object iteration order),
 * so the map stays bounded and the most recently configured origins survive.
 */
export const INSPECTOR_ORIGINS_CAP = 200;

/** The raw storage item (reads/writes go through the helpers below). */
export const inspectorOriginsStore = storage.defineItem<InspectorOrigins>(INSPECTOR_ORIGINS_KEY, {
  fallback: {}
});

/**
 * Apply the origin cap: entries beyond it evicted oldest-inserted first.
 * The one cap rule, shared by the validator and the toggle's write; the
 * result is a fresh object whose insertion order keeps the survivors.
 *
 * @param origins A validated own-copy map.
 */
function withCap(origins: InspectorOrigins): InspectorOrigins {
  const oldestFirst = Object.keys(origins);
  const excess = Math.max(0, oldestFirst.length - INSPECTOR_ORIGINS_CAP);
  const kept: InspectorOrigins = {};
  for (const origin of oldestFirst.slice(excess)) {
    // The key came from this map's own key list — narrow the indexed read.
    const entry = origins[origin];
    if (entry !== undefined) kept[origin] = entry;
  }
  return kept;
}

/**
 * Validate a raw (possibly corrupt, partial, or foreign) stored map.
 *
 * - the value must be a non-null, non-array object, else null (the caller's
 *   documented degradation);
 * - an origin key must be a non-empty string; its entry must be an object
 *   carrying a boolean `enabled` — anything else is dropped, not trusted;
 * - rows beyond {@link INSPECTOR_ORIGINS_CAP} are dropped oldest-inserted
 *   first.
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
  return withCap(parsed);
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
  const next: InspectorOrigins = withCap({
    ...current,
    [origin]: { enabled: !originEnabled(current, origin) }
  });
  await inspectorOriginsStore.setValue(next);
  return next[origin]?.enabled ?? false;
}
