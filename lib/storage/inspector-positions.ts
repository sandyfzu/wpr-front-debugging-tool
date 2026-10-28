/**
 * The on-page detection widget's per-origin drag position: one bounded
 * origin → `{ x, y, used }` map sync'd across a user's browsers, the sibling
 * of the override store (`./inspector-origins`).
 *
 * A sibling item, not a field on the override entry: drops are frequent and
 * per-device, overrides rare and deliberate — sharing one 8 KiB item would
 * let dragging the chip around many sites evict the user's explicit per-site
 * choices, and the content script's drop write would race the background's
 * toggle over one read-modify-write. Two items give each concern its own
 * budget and writer.
 *
 * The position is the chip's offset (CSS px) from its stylesheet anchor —
 * the drag's translate. It is a hint, not a promise: whoever restores it
 * re-clamps it against the current viewport and shape. Reads validate;
 * corrupt values or entries degrade to "no stored position" (the anchor),
 * never to a fabricated one.
 */

import { storage } from 'wxt/utils/storage';
import { nextRecency, parseRecency, trimToByteBudget, type RecencyRanked } from './recency-map';

/** The `sync:inspector-positions` store key, single-sourced. */
export const INSPECTOR_POSITIONS_KEY = 'sync:inspector-positions';

/** A stored offset from the chip's anchor, integer CSS px. */
export interface InspectorPosition {
  x: number;
  y: number;
}

/** What one origin stores: its offset plus the eviction's write-recency rank. */
export interface InspectorPositionEntry extends InspectorPosition, RecencyRanked {}

/** The stored map: origin → entry. */
export type InspectorPositions = Record<string, InspectorPositionEntry>;

/**
 * The largest offset magnitude accepted (CSS px): beyond any real layout
 * viewport (an 8K display at 25 % zoom is ~30,720 px wide), so only corrupt
 * values are refused — the restore's clamp handles every real one.
 */
export const INSPECTOR_POSITION_LIMIT = 32768;

/**
 * The item's byte budget (bare key + JSON, the area's measure): 1 KiB
 * headroom under the sync area's 8,192-byte per-item quota. A typical entry
 * (a ~26-character origin, two 4-digit offsets, a three-digit rank) costs
 * ~60 bytes — ~115 positions; least recently dropped evicted first.
 */
export const INSPECTOR_POSITIONS_BYTE_BUDGET = 7168;

/** The item's key as the storage area counts it (no area prefix). */
const BARE_KEY = INSPECTOR_POSITIONS_KEY.slice('sync:'.length);

/** The raw storage item (reads/writes go through the helpers below). */
export const inspectorPositionsStore = storage.defineItem<InspectorPositions>(
  INSPECTOR_POSITIONS_KEY,
  { fallback: {} }
);

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
  return Math.abs(rounded) <= INSPECTOR_POSITION_LIMIT ? rounded : null;
}

/**
 * Validate one position: both coordinates sane (see {@link parseCoordinate}).
 *
 * @param input Any value.
 * @returns The normalized position, or null when either coordinate is not sane.
 */
export function parseInspectorPosition(input: unknown): InspectorPosition | null {
  if (typeof input !== 'object' || input === null) return null;
  const { x, y } = input as { x?: unknown; y?: unknown };
  const px = parseCoordinate(x);
  const py = parseCoordinate(y);
  return px === null || py === null ? null : { x: px, y: py };
}

/**
 * Validate a raw stored map: non-map values → null; entries without a sane
 * position or with an empty origin key are dropped; `used` kept only as a
 * valid rank; unknown fields tolerated, not carried; the result trimmed to
 * the byte budget, least recent first.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseInspectorPositions(input: unknown): InspectorPositions | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const parsed: InspectorPositions = {};
  for (const [origin, rawEntry] of Object.entries(input as Record<string, unknown>)) {
    if (origin === '') continue;
    const position = parseInspectorPosition(rawEntry);
    if (position === null) continue;
    const rank = parseRecency((rawEntry as { used?: unknown }).used);
    parsed[origin] = rank === undefined ? position : { ...position, used: rank };
  }
  return trimToByteBudget(BARE_KEY, parsed, INSPECTOR_POSITIONS_BYTE_BUDGET);
}

/**
 * One origin's stored position, or null (none stored, or a corrupt item —
 * the chip then rests at its anchor).
 *
 * @param origin The page origin.
 */
export async function getInspectorPosition(origin: string): Promise<InspectorPosition | null> {
  const entry = parseInspectorPositions(await inspectorPositionsStore.getValue())?.[origin];
  return entry === undefined ? null : { x: entry.x, y: entry.y };
}

/**
 * Persist one origin's position, ranked most recent, read-modify-write over
 * the validated map (a corrupt item is replaced by the fresh valid map) and
 * trimmed to the byte budget.
 *
 * @param origin The page origin (non-empty).
 * @param position The offset to store (finite, within the sane bound).
 * @returns The stored (integer-normalized) position.
 * @throws {@link RangeError} when the origin is empty or the position is not
 *   sane (a caller bug — the drag clamps every real offset); otherwise the
 *   storage read/write rejects as the platform does.
 */
export async function saveInspectorPosition(
  origin: string,
  position: InspectorPosition
): Promise<InspectorPosition> {
  const normalized = parseInspectorPosition(position);
  if (origin === '' || normalized === null) {
    throw new RangeError(
      `Refusing to store the widget position ${JSON.stringify(position)} for origin "${origin}"`
    );
  }
  const current = parseInspectorPositions(await inspectorPositionsStore.getValue()) ?? {};
  await inspectorPositionsStore.setValue(
    trimToByteBudget(
      BARE_KEY,
      { ...current, [origin]: { ...normalized, used: nextRecency(current) } },
      INSPECTOR_POSITIONS_BYTE_BUDGET
    )
  );
  return normalized;
}
