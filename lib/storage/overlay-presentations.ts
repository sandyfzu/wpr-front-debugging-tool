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
import { isRecord } from '../../utils/is-record';
import { createWriteQueue } from './write-queue';
import { tabKey } from './tab-key';

/** The store key, single-sourced. */
export const OVERLAY_PRESENTATIONS_KEY = 'session:exclusion-overlay-presentations';

/** Tabs remembered at most (the oldest written go first). */
export const OVERLAY_PRESENTATION_LIMIT = 64;

/** The stored map: decimal tab id → presentation, in write order. */
export type OverlayPresentations = Record<string, OverlayPresentation>;

/** The raw storage item. */
const presentationsStore = storage.defineItem<OverlayPresentations>(OVERLAY_PRESENTATIONS_KEY, {
  fallback: {}
});

/** The item's write queue (read-modify-write never interleaves). */
const enqueueWrite = createWriteQueue();

/**
 * Validate a stored map: canonical tab keys with a known presentation;
 * everything else dropped.
 *
 * @param input Any storage-delivered value.
 */
export function parseOverlayPresentations(input: unknown): OverlayPresentations {
  const valid: OverlayPresentations = {};
  if (!isRecord(input)) return valid;
  for (const [key, value] of Object.entries(input)) {
    const canonical = tabKey(key);
    if (canonical !== null && (value === 'open' || value === 'folded')) valid[canonical] = value;
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
  return parseOverlayPresentations(await presentationsStore.getValue())[key] ?? null;
}

/**
 * Remember a tab's presentation (the most recent {@link OVERLAY_PRESENTATION_LIMIT} kept).
 *
 * @param tabId The tab.
 * @param presentation How the user left the overlay.
 * @throws {@link RangeError} for a junk tab id (a broken caller).
 */
export function setOverlayPresentation(
  tabId: number,
  presentation: OverlayPresentation
): Promise<void> {
  const key = tabKey(tabId);
  if (key === null) return Promise.reject(new RangeError(`Not a tab id: ${String(tabId)}`));
  return enqueueWrite(async () => {
    const current = parseOverlayPresentations(await presentationsStore.getValue());
    Reflect.deleteProperty(current, key);
    const entries = [...Object.entries(current), [key, presentation] as const];
    await presentationsStore.setValue(
      Object.fromEntries(entries.slice(-OVERLAY_PRESENTATION_LIMIT))
    );
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
