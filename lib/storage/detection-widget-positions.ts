/**
 * The on-page detection widget's per-origin drag position: one bounded
 * origin → `{ x, y, used }` map in this device's local area, the sibling of
 * the synced override store (`./detection-widget-sites`).
 *
 * A separate item in a separate area, not a field on the override entry:
 * a position fits one device's screen, so it must not roam to others; drops
 * are frequent, so in the sync area they would spend its shared write-rate
 * quota (120 writes/min, 1800/h) that the options page and the toggles need;
 * and sharing the override item's 8 KiB would let dragging the widget around
 * many sites evict the user's explicit per-site choices.
 *
 * Saves are serialized per JS context (a write queue); drops in two tabs
 * (two content-script contexts) can still interleave, and the loser is one
 * position, never a corrupt map. Unknown per-entry fields survive the round
 * trip (a newer version's additions are not stripped by an older one).
 *
 * The position is the chip's offset (CSS px) from its stylesheet anchor —
 * the drag's translate. It is a hint, not a promise: whoever restores it
 * re-clamps it against the current viewport and shape. Reads validate;
 * corrupt values or entries degrade to "no stored position" (the anchor),
 * never to a fabricated one.
 */

import { storage } from 'wxt/utils/storage';
import {
  isStorableKey,
  parseRecency,
  trimToByteBudget,
  withMostRecent,
  type RecencyRanked
} from './recency-map';
import { createWriteQueue } from './write-queue';

/** The `local:detection-widget-positions` store key (per device), single-sourced. */
export const DETECTION_WIDGET_POSITIONS_KEY = 'local:detection-widget-positions';

/** A stored offset from the chip's anchor, integer CSS px. */
export interface DetectionWidgetPosition {
  x: number;
  y: number;
}

/** What one origin stores: its offset plus the eviction's write-recency rank. */
export interface DetectionWidgetPositionEntry extends DetectionWidgetPosition, RecencyRanked {}

/** The stored map: origin → entry. */
export type DetectionWidgetPositions = Record<string, DetectionWidgetPositionEntry>;

/**
 * The largest offset magnitude accepted (CSS px): beyond any real layout
 * viewport (an 8K display at 25 % zoom is ~30,720 px wide), so only corrupt
 * values are refused — the restore's clamp handles every real one.
 */
export const DETECTION_WIDGET_POSITION_LIMIT = 32768;

/**
 * The item's byte budget (bare key + JSON, the area's measure). The local
 * area has no per-item quota, only 10 MiB in all (Chrome `QUOTA_BYTES`;
 * Firefox applies its IndexedDB limits), shared with the Known Conflicts
 * cache and the saved exclusion sets — so the map is still bounded, or
 * origins visited once would grow it forever. A typical entry (a
 * ~26-character origin, two 4-digit offsets, a three-digit rank) costs ~60
 * bytes: 32 KiB keeps ~500 positions (far more sites than one person
 * re-parks the widget on) at 0.3 % of the area, and every drop's
 * read-modify-write parses and serializes at most that much. Least recently
 * dropped evicted first.
 */
export const DETECTION_WIDGET_POSITIONS_BYTE_BUDGET = 32 * 1024;

/** The item's key as the storage area counts it (no area prefix). */
const BARE_KEY = DETECTION_WIDGET_POSITIONS_KEY.slice('local:'.length);

/** The raw storage item (reads/writes go through the helpers below). */
export const detectionWidgetPositionsStore = storage.defineItem<DetectionWidgetPositions>(
  DETECTION_WIDGET_POSITIONS_KEY,
  { fallback: {} }
);

/** The item's write queue (this context's saves never revert each other). */
const enqueueWrite = createWriteQueue();

/**
 * Validate one coordinate: a finite number within the sane bound, rounded to
 * an integer CSS px (sub-pixel precision buys nothing a re-clamp keeps and
 * costs bytes); `-0` normalizes to `0`.
 *
 * @param value Any storage- or caller-delivered value.
 * @returns The integer coordinate, or null when it is not sane.
 */
function parseCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value) + 0; // `+ 0` turns -0 into 0.
  return Math.abs(rounded) <= DETECTION_WIDGET_POSITION_LIMIT ? rounded : null;
}

/**
 * Validate one position: a non-array object with both coordinates sane (see
 * {@link parseCoordinate}).
 *
 * @param input Any value.
 * @returns The normalized position, or null when it is not one.
 */
export function parseDetectionWidgetPosition(input: unknown): DetectionWidgetPosition | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { x, y } = input as { x?: unknown; y?: unknown };
  const px = parseCoordinate(x);
  const py = parseCoordinate(y);
  return px === null || py === null ? null : { x: px, y: py };
}

/**
 * Validate a raw stored map: non-map values → null; entries without a sane
 * position or with an unstorable origin key (empty, `__proto__`) are
 * dropped; `used` kept only as a valid rank; unknown fields carried; the
 * result trimmed to the byte budget, least recent first.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseDetectionWidgetPositions(input: unknown): DetectionWidgetPositions | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const parsed: DetectionWidgetPositions = {};
  for (const [origin, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    if (!isStorableKey(origin)) continue;
    const position = parseDetectionWidgetPosition(rawEntry);
    if (position === null) continue;
    // A parsed position proves `rawEntry` is a plain object.
    const { used, ...unknownFields } = rawEntry as Record<string, unknown>;
    const rank = parseRecency(used);
    parsed[origin] =
      rank === undefined
        ? { ...unknownFields, ...position }
        : { ...unknownFields, ...position, used: rank };
  }
  return trimToByteBudget(BARE_KEY, parsed, DETECTION_WIDGET_POSITIONS_BYTE_BUDGET);
}

/**
 * One origin's stored position, or null (none stored, or a corrupt item —
 * the chip then rests at its anchor).
 *
 * @param origin The page origin.
 */
export async function getDetectionWidgetPosition(
  origin: string
): Promise<DetectionWidgetPosition | null> {
  const entry = parseDetectionWidgetPositions(await detectionWidgetPositionsStore.getValue())?.[
    origin
  ];
  return entry === undefined ? null : { x: entry.x, y: entry.y };
}

/**
 * Persist one origin's position, ranked most recent (its unknown fields
 * kept), read-modify-write over the validated map — queued behind this
 * context's earlier saves; a corrupt item is replaced by the fresh valid map
 * — and trimmed to the byte budget.
 *
 * @param origin The page origin (storable: non-empty, not `__proto__`).
 * @param position The offset to store (finite, within the sane bound).
 * @returns The stored (integer-normalized) position.
 * @throws {@link RangeError} when the origin is not storable or the position is not
 *   sane (a caller bug — the drag clamps every real offset); otherwise the
 *   storage read/write rejects as the platform does.
 */
export async function saveDetectionWidgetPosition(
  origin: string,
  position: DetectionWidgetPosition
): Promise<DetectionWidgetPosition> {
  const normalized = parseDetectionWidgetPosition(position);
  if (!isStorableKey(origin) || normalized === null) {
    throw new RangeError(
      `Refusing to store the widget position ${JSON.stringify(position)} for origin "${origin}"`
    );
  }
  await enqueueWrite(async () => {
    const raw = await detectionWidgetPositionsStore.getValue();
    const current = parseDetectionWidgetPositions(raw) ?? {};
    await detectionWidgetPositionsStore.setValue(
      trimToByteBudget(
        BARE_KEY,
        withMostRecent(current, origin, { ...current[origin], ...normalized }),
        DETECTION_WIDGET_POSITIONS_BYTE_BUDGET
      )
    );
  });
  return normalized;
}
