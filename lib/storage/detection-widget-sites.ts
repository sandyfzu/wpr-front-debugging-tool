/**
 * The on-page detection widget's per-origin override store: one bounded
 * origin → `{ enabled, used }` map sync'd across a user's browsers (the drag
 * position lives in its sibling item, `./detection-widget-positions`).
 *
 * Precedence: an explicit per-origin entry wins over the global default (the
 * `features.detectionWidget` option, `./options` — on by default), and
 * origins without an entry follow it. Every writer (the context-menu row,
 * the command palette; the popup's row later) toggles through the one
 * helper here, so the toggling semantics live exactly once: a toggle flips
 * the site's current effective state and persists it as an explicit entry —
 * read-modify-write over the validated shape, bounded, and coercing corrupt
 * storage into the fresh valid map (a broken value never blocks the user's
 * toggle). Reads validate; corrupt or foreign values degrade to
 * no-explicit-entries (every origin follows the default), never to
 * fabricated overrides. Unknown per-entry fields survive the round trip, so
 * an older install's toggle never strips what a newer synced one stored.
 *
 * Toggles are serialized per JS context (a write queue); writers in other
 * contexts (the background's menu vs a tab's palette) can still interleave —
 * a user cannot toggle from both within one storage round trip, and the
 * loser is one toggle, never a corrupt map.
 */

import { storage } from 'wxt/utils/storage';
import { getOptions, DETECTION_WIDGET, type StoredOptions } from './options';
import {
  isStorableKey,
  parseRecency,
  trimToByteBudget,
  withMostRecent,
  type RecencyRanked
} from './recency-map';
import { createWriteQueue } from './write-queue';

/** The `sync:detection-widget-sites` store key, single-sourced. */
export const DETECTION_WIDGET_SITES_KEY = 'sync:detection-widget-sites';

/**
 * What one origin stores: its explicit override, plus the write-recency rank
 * the eviction reads (absent on unranked entries — they rank least recent).
 * Fields a newer version adds ride along untyped.
 */
export interface DetectionWidgetSiteEntry extends RecencyRanked {
  enabled: boolean;
}

/** The stored map: origin → entry. */
export type DetectionWidgetSites = Record<string, DetectionWidgetSiteEntry>;

/**
 * The byte budget the stored item (bare key + JSON, the area's own measure)
 * is trimmed to: the sync area rejects any item over 8,192 bytes, so the
 * write evicts least-recently-written entries until the item fits 7 KiB —
 * 1 KiB headroom under the platform ceiling for any measuring difference
 * between engines. A typical entry (a ~26-character origin, an override and
 * a three-digit rank) costs ~60 bytes, so the map holds ~120 overrides;
 * 253-character hosts (the longest a URL can carry) still keep ~24.
 */
export const DETECTION_WIDGET_SITES_BYTE_BUDGET = 7168;

/** The sync area's per-item quota (`QUOTA_BYTES_PER_ITEM`, Chrome and Firefox alike). */
export const DETECTION_WIDGET_SITES_QUOTA_LIMIT = 8192;

/** The item's key as the storage area counts it (no area prefix). */
const BARE_KEY = DETECTION_WIDGET_SITES_KEY.slice('sync:'.length);

/** The raw storage item (reads/writes go through the helpers below). */
export const detectionWidgetSitesStore = storage.defineItem<DetectionWidgetSites>(
  DETECTION_WIDGET_SITES_KEY,
  { fallback: {} }
);

/** The item's write queue (this context's toggles never revert each other). */
const enqueueWrite = createWriteQueue();

/**
 * Validate a raw (possibly corrupt, partial, older, or newer) stored map.
 *
 * - the value must be a non-null, non-array object, else null (the caller's
 *   documented degradation);
 * - an origin key must be storable (non-empty, not `__proto__`); its entry
 *   must be a non-array object carrying a boolean `enabled` — anything else
 *   is dropped, not trusted;
 * - `used` is kept only as a non-negative safe integer (a broken rank is
 *   dropped, which only demotes the entry); unknown fields are carried;
 * - the map keeps its serialized bytes inside the byte budget — least
 *   recently written entries evicted first.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseDetectionWidgetSites(input: unknown): DetectionWidgetSites | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const parsed: DetectionWidgetSites = {};
  for (const [origin, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    if (!isStorableKey(origin)) continue;
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) continue;
    const { enabled, used, ...unknownFields } = rawEntry as Record<string, unknown>;
    if (typeof enabled !== 'boolean') continue;
    const rank = parseRecency(used);
    parsed[origin] =
      rank === undefined
        ? { ...unknownFields, enabled }
        : { ...unknownFields, enabled, used: rank };
  }
  return trimToByteBudget(BARE_KEY, parsed, DETECTION_WIDGET_SITES_BYTE_BUDGET);
}

/**
 * Read the map through the validator: corrupt storage degrades to empty
 * (every origin resolves to the global default), never to fabricated
 * entries.
 */
export async function getDetectionWidgetSites(): Promise<DetectionWidgetSites> {
  return parseDetectionWidgetSites(await detectionWidgetSitesStore.getValue()) ?? {};
}

/**
 * The global default for origins without an entry, read from validated
 * options (a corrupt options item already degrades to the documented
 * default there).
 *
 * @param options Validated options.
 */
export function detectionWidgetDefaultEnabled(options: StoredOptions): boolean {
  return options.features[DETECTION_WIDGET];
}

/**
 * One origin's effective widget state: an explicit per-origin entry wins;
 * origins without one follow the global default. An empty map (a fresh
 * install) or a degraded corrupt read therefore reports the default
 * everywhere — no overrides are ever invented from thin air.
 *
 * @param origins A validated own-copy map.
 * @param origin The page origin to resolve.
 * @param defaultEnabled The global default (see {@link detectionWidgetDefaultEnabled}).
 */
export function effectiveDetectionWidgetEnabled(
  origins: DetectionWidgetSites,
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
export async function isDetectionWidgetSiteEnabled(origin: string): Promise<boolean> {
  const [origins, options] = await Promise.all([getDetectionWidgetSites(), getOptions()]);
  return effectiveDetectionWidgetEnabled(origins, origin, detectionWidgetDefaultEnabled(options));
}

/**
 * Flip one origin's visible state and persist it as an explicit entry. A
 * toggle always changes the site's behavior whatever the default reads: at
 * the default-on state an unconfigured origin is showing, so the flip
 * writes `false` — whose entry then keeps the site closed even if the
 * global default changes later — and the next toggle reads that entry back.
 * The whole map persists read-modify-write over the validated shape —
 * queued behind this context's earlier toggles — the toggled entry ranked
 * most recent (its unknown fields kept) and the map trimmed to its byte
 * budget, so every other origin survives unless the budget evicts the least
 * recently written. A corrupt stored value degrades to the fresh valid map
 * (the only truth a toggle can write).
 *
 * @param origin The origin to toggle.
 * @returns The entry state after the write (the persisted truth).
 * @throws {@link RangeError} when the origin is not storable (empty or
 *   `__proto__` — a caller bug); otherwise the storage read/write rejects as
 *   the platform does (e.g. an invalidated extension context, or a single
 *   oversized entry over the quota) — callers branch (validate-and-log).
 */
export async function toggleDetectionWidgetSite(origin: string): Promise<boolean> {
  if (!isStorableKey(origin)) {
    throw new RangeError(`Refusing to toggle the detection widget for origin "${origin}"`);
  }
  return enqueueWrite(async () => {
    const [raw, options] = await Promise.all([detectionWidgetSitesStore.getValue(), getOptions()]);
    const current: DetectionWidgetSites = parseDetectionWidgetSites(raw) ?? {};
    const defaultEnabled = detectionWidgetDefaultEnabled(options);
    const enabled = !effectiveDetectionWidgetEnabled(current, origin, defaultEnabled);
    await detectionWidgetSitesStore.setValue(
      trimToByteBudget(
        BARE_KEY,
        withMostRecent(current, origin, { ...current[origin], enabled }),
        DETECTION_WIDGET_SITES_BYTE_BUDGET
      )
    );
    return enabled;
  });
}
