/**
 * How the user last left the builder overlay in each tab (open panel or
 * folded pill), so a session tab's next pages bring it back the same way —
 * also after the background restarts. `session:` area: in memory, never
 * synced, cleared with the browser session (Chrome 102+, Firefox 115+ —
 * both under this extension's floors); only the background reads or
 * writes it. Tolerant read: junk entries are dropped, never trusted.
 */
import { storage } from 'wxt/utils/storage';
import type { OverlayPresentation } from '../exclusion-session/overlay-reopen';
import { isRecord, ownValue } from '../../utils/is-record';
import { createWriteQueue } from './write-queue';
import { tabKey } from './tab-key';

/** The store key, single-sourced. */
export const OVERLAY_PRESENTATIONS_KEY = 'session:exclusion-overlay-presentations';

/** Tabs remembered at most (the least recently written go first). */
export const OVERLAY_PRESENTATION_LIMIT = 64;

/** One tab's entry: the presentation and its write order. */
export interface OverlayPresentationEntry {
  readonly presentation: OverlayPresentation;
  /** Write order (strictly increasing per write; ms-based). */
  readonly at: number;
}

/** The stored map: decimal tab id → entry. */
export type OverlayPresentations = Record<string, OverlayPresentationEntry>;

/** The raw storage item. */
const presentationsStore = storage.defineItem<OverlayPresentations>(OVERLAY_PRESENTATIONS_KEY, {
  fallback: {}
});

/** The item's write queue (read-modify-write never interleaves). */
const enqueueWrite = createWriteQueue();

/** Whether a value is a presentation. */
function isPresentation(value: unknown): value is OverlayPresentation {
  return value === 'open' || value === 'folded';
}

/** One stored value as an entry (`{presentation, at}`); anything else null. */
function parseEntry(value: unknown): OverlayPresentationEntry | null {
  if (!isRecord(value)) return null;
  const presentation = ownValue(value, 'presentation');
  const at = ownValue(value, 'at');
  return isPresentation(presentation) && typeof at === 'number' && Number.isFinite(at) && at >= 0
    ? { presentation, at }
    : null;
}

/**
 * Validate a stored map: canonical tab keys with a valid entry; everything
 * else dropped.
 *
 * @param input Any storage-delivered value.
 */
export function parseOverlayPresentations(input: unknown): OverlayPresentations {
  const valid: OverlayPresentations = {};
  if (!isRecord(input)) return valid;
  for (const [key, value] of Object.entries(input)) {
    const canonical = tabKey(key);
    const entry = parseEntry(value);
    if (canonical !== null && entry !== null) valid[canonical] = entry;
  }
  return valid;
}

/**
 * A tab's remembered presentation.
 *
 * @param tabId The tab.
 * @returns It, or null when none (or the id is junk).
 */
export async function getOverlayPresentation(tabId: number): Promise<OverlayPresentation | null> {
  const key = tabKey(tabId);
  if (key === null) return null;
  return parseOverlayPresentations(await presentationsStore.getValue())[key]?.presentation ?? null;
}

/**
 * Remember a tab's presentation, keeping the {@link OVERLAY_PRESENTATION_LIMIT}
 * most recently written tabs (by write order — integer-like keys enumerate
 * in numeric order, so key order is no write order).
 *
 * @param tabId The tab.
 * @param presentation How the user left the overlay.
 * @param now Epoch ms now (the write order's clock; injectable for tests).
 * @throws {@link RangeError} for a junk tab id (a broken caller).
 */
export function setOverlayPresentation(
  tabId: number,
  presentation: OverlayPresentation,
  now: number = Date.now()
): Promise<void> {
  const key = tabKey(tabId);
  if (key === null) return Promise.reject(new RangeError(`Not a tab id: ${String(tabId)}`));
  return enqueueWrite(async () => {
    const current = parseOverlayPresentations(await presentationsStore.getValue());
    // Strictly after every stored write, even with a clock that stalls.
    const latest = Math.max(0, ...Object.values(current).map((entry) => entry.at));
    current[key] = { presentation, at: Math.max(now, latest + 1) };
    const kept = Object.entries(current)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, OVERLAY_PRESENTATION_LIMIT);
    await presentationsStore.setValue(Object.fromEntries(kept));
  });
}

/**
 * Forget a tab (it closed).
 *
 * @param tabId The tab.
 */
export function removeOverlayPresentation(tabId: number): Promise<void> {
  const key = tabKey(tabId);
  if (key === null) return Promise.resolve();
  return enqueueWrite(async () => {
    const current = parseOverlayPresentations(await presentationsStore.getValue());
    if (!(key in current)) return;
    Reflect.deleteProperty(current, key);
    await presentationsStore.setValue(current);
  });
}
