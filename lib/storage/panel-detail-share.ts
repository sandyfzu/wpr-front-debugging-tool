/**
 * The detail pane's width, as the share of a list's content width the user
 * dragged it to (a share, not pixels: the pane keeps growing with the panel
 * after a drag). Per device (`local:`): a layout choice belongs to the screen
 * it was made on. One value for every list page.
 *
 * Read once at panel boot and written by the pane's splitter. A fresh
 * install, a reset (the key removed) and any corrupt or foreign value read
 * as `null` = the default share.
 */
import { storage } from 'wxt/utils/storage';
import { isPaneShare } from '../panel/detail-layout';

/** The `local:panel-detail-share` store key, single-sourced. */
export const PANEL_DETAIL_SHARE_KEY = 'local:panel-detail-share';

/** The raw storage item (reads and writes go through the helpers below). */
export const panelDetailShareStore = storage.defineItem<number | null>(PANEL_DETAIL_SHARE_KEY, {
  fallback: null
});

/**
 * Validate a raw stored value: only a share in (0, 1) is trusted.
 *
 * @param input Any storage-delivered value.
 * @returns The share, or `null` (the default) for anything else.
 */
export function parseDetailShare(input: unknown): number | null {
  return isPaneShare(input) ? input : null;
}

/**
 * Read the stored share through the validator.
 *
 * @returns The share, or `null` when nothing usable is stored.
 * @throws The storage read rejects as the platform does — callers branch.
 */
export async function readDetailShare(): Promise<number | null> {
  return parseDetailShare(await panelDetailShareStore.getValue());
}

/**
 * Persist the share, or remove it (`null`: back to the default).
 *
 * @param share The share to store, or `null`.
 * @throws {@link RangeError} For a number outside (0, 1) (a caller bug).
 * @throws The storage write rejects as the platform does — callers branch.
 */
export async function writeDetailShare(share: number | null): Promise<void> {
  if (share === null) {
    await panelDetailShareStore.removeValue();
    return;
  }
  if (!isPaneShare(share)) {
    throw new RangeError(`writeDetailShare: share must be in (0, 1), got ${String(share)}`);
  }
  await panelDetailShareStore.setValue(share);
}
