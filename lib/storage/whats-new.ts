/**
 * The What's new page's two stored values:
 *
 * - `local:whats-new-seen-through` — the marker: the newest extension
 *   version whose notes were already considered (opened, opted out, or
 *   nothing to announce). Per device on purpose: each browser install
 *   announces its own update once. Raw reads only — the decision
 *   (`lib/release-notes/decision`) validates the value.
 * - `sync:whats-new-on-update` — "Show what's new after updates", one
 *   synced boolean (default on) written by the page's footer switch and the
 *   options row alike. Corrupt or foreign values read as on.
 */
import { storage } from 'wxt/utils/storage';

/** The marker's store key, single-sourced. */
export const WHATS_NEW_MARKER_KEY = 'local:whats-new-seen-through';

/** The setting's store key, single-sourced. */
export const WHATS_NEW_ON_UPDATE_KEY = 'sync:whats-new-on-update';

/** The setting's value whenever storage holds nothing usable: the page opens after updates. */
export const WHATS_NEW_ON_UPDATE_DEFAULT = true;

/** The raw marker item (no fallback: absence is meaningful). */
const markerStore = storage.defineItem<unknown>(WHATS_NEW_MARKER_KEY);

/** The raw setting item. */
const onUpdateStore = storage.defineItem<boolean>(WHATS_NEW_ON_UPDATE_KEY, {
  fallback: WHATS_NEW_ON_UPDATE_DEFAULT
});

/**
 * Read the stored marker as is (null when nothing is stored).
 *
 * @throws The storage read rejects as the platform does — callers branch.
 */
export async function readWhatsNewMarker(): Promise<unknown> {
  return await markerStore.getValue();
}

/**
 * Store the marker.
 *
 * @param version The extension version now considered seen.
 * @throws The storage write rejects as the platform does — callers branch.
 */
export async function writeWhatsNewMarker(version: string): Promise<void> {
  await markerStore.setValue(version);
}

/**
 * Validate a raw stored setting: only a real boolean is trusted.
 *
 * @param input Any storage-delivered value.
 * @returns Whether the page opens after updates.
 */
export function parseWhatsNewOnUpdate(input: unknown): boolean {
  return typeof input === 'boolean' ? input : WHATS_NEW_ON_UPDATE_DEFAULT;
}

/**
 * Read the setting through the validator.
 *
 * @throws The storage read rejects as the platform does — callers branch.
 */
export async function readWhatsNewOnUpdate(): Promise<boolean> {
  return parseWhatsNewOnUpdate(await onUpdateStore.getValue());
}

/**
 * Persist the setting (the page's footer switch and the options row).
 *
 * @param enabled Whether the page opens after updates.
 * @throws The storage write rejects as the platform does — callers branch.
 */
export async function setWhatsNewOnUpdate(enabled: boolean): Promise<void> {
  await onUpdateStore.setValue(enabled);
}

/**
 * Follow the setting: every write is validated before it reaches the callback.
 *
 * @param onChange Receives the validated setting after each write.
 * @returns The unsubscribe handle.
 */
export function watchWhatsNewOnUpdate(onChange: (enabled: boolean) => void): () => void {
  return onUpdateStore.watch((raw: unknown) => {
    onChange(parseWhatsNewOnUpdate(raw));
  });
}
