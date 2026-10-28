/**
 * The options surface's registered storage shape.
 *
 * All option keys this tool stores live here as one shape so a surface (the
 * options page, the popup, injected UI) only ever reads keys defined here;
 * phases may extend additively with a documented default.
 *
 * Read options through {@link getOptions} (validated, corrupt-tolerant);
 * whole-shape read-modify-writes go through {@link mutateOptions} (serialized,
 * so concurrent writers cannot revert each other); `optionsStore` is the raw
 * storage item, kept for `watch`/writes.
 */

import { storage } from 'wxt/utils/storage';
import { isAppearance, nextAppearance, type Appearance } from '../../utils/theme';
import { createWriteQueue } from './write-queue';

/**
 * Canonical storage keys, declared once and reused by every slot below —
 * and exported for the option registry, which projects rows over them
 * (never a second spelling of a key).
 */
export const WP_DASHBOARD_DBUGGER_ENTRY = 'wp-dashboard-dbugger-entry';
export const TOOLBAR_BADGE = 'toolbarBadge';
const SBS_SCROLL_SYNC = 'sbsScrollSync';
const SBS_MOBILE_SIM = 'sbsMobileSim';
const SBS_DESKTOP_WIDTH = 'sbsDesktopWidth';
export const DETECTION_WIDGET = 'detectionWidget';

/**
 * Registered option storage.
 *
 * - `improvements.wp-dashboard-dbugger-entry` — whether the admin-bar entry
 *   is injected into `wp-admin`; id kept verbatim as the canonical key.
 * - `appearance` — one of exactly `system` (follows the OS palette),
 *   `dark`, `light`; rendered UI sets `data-theme` from it before paint and
 *   follows it live while mounted (the injected UIs' live-theme leg).
 * - `features.toolbarBadge` — the per-tab toolbar action badge.
 * - `features.sbsScrollSync` — the compare overlay's scroll sync (default
 *   on since the owner's 2026-10-11 decision — off at plan time; the
 *   overlay's own header switch writes it).
 * - `features.sbsMobileSim` — the compare overlay's mobile-comparison
 *   switch (default off; the overlay's own header switch writes it).
 * - `features.sbsDesktopWidth` — the compare overlay's desktop-width dress
 *   (default on — the owner's 2026-10-12 directive; the overlay's own header
 *   switch writes it).
 * - `features.detectionWidget` — the on-page detection widget's global
 *   default for origins without a per-origin entry (default on — the owner's
 *   2026-10-17 turn-on); a per-origin entry
 *   (`./detection-widget-sites`) wins over it in both directions.
 */
export interface StoredOptions {
  improvements: {
    [WP_DASHBOARD_DBUGGER_ENTRY]?: boolean;
    /** Future improvement ids land here as additive boolean keys. */
    [key: string]: boolean | undefined;
  };
  appearance: Appearance;
  features: {
    [TOOLBAR_BADGE]: boolean;
    [SBS_SCROLL_SYNC]: boolean;
    [SBS_MOBILE_SIM]: boolean;
    [SBS_DESKTOP_WIDTH]: boolean;
    [DETECTION_WIDGET]: boolean;
    /** Future feature ids land here as additive boolean keys. */
    [key: string]: boolean | undefined;
  };
}

/**
 * The module's documented defaults, declared once here. Storage reads that
 * come back missing or corrupt reset to them; surfaces that degrade on a
 * failed storage read import this instead of re-typing the literals.
 */
export const FALLBACK: Readonly<StoredOptions> = Object.freeze({
  improvements: Object.freeze({
    [WP_DASHBOARD_DBUGGER_ENTRY]: true
  }),
  appearance: 'system',
  features: Object.freeze({
    [TOOLBAR_BADGE]: true,
    [SBS_SCROLL_SYNC]: true,
    [SBS_MOBILE_SIM]: false,
    [SBS_DESKTOP_WIDTH]: true,
    [DETECTION_WIDGET]: true
  })
});

/** The `sync:options` store (roams across a user's browsers). */
export const optionsStore = storage.defineItem<StoredOptions>('sync:options', {
  fallback: FALLBACK
});

/**
 * Validate a raw (possibly corrupt or foreign) stored options value.
 *
 * Per-slot behavior:
 * - `improvements` keeps every own boolean-valued key — known ids and future
 *   ones alike (tolerant read) — and self-heals the dbugger entry to its
 *   documented default (`true`) when it is absent or wrong-typed.
 * - `appearance` must be one of the three documented values, else default.
 * - `features.toolbarBadge` must be boolean, else default.
 * - `features.sbsScrollSync` must be boolean, else default (on).
 * - `features.sbsMobileSim` must be boolean, else default (off).
 * - `features.sbsDesktopWidth` must be boolean, else default (on).
 * - `features.detectionWidget` must be boolean, else default (on).
 * - `features` keeps every own boolean-valued key — known ids and future
 *   ones alike (tolerant read, like `improvements`): shapes are written
 *   read-modify-write, so a later writer reading through this validator
 *   must not erase a key it does not know yet.
 *
 * @returns Options, or null when the storage value is not an object at all.
 */
export function parseStoredOptions(input: unknown): StoredOptions | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;

  const improvementsRows: StoredOptions['improvements'] = {};
  const improvements = value['improvements'];
  if (typeof improvements === 'object' && improvements !== null && !Array.isArray(improvements)) {
    for (const [key, entry] of Object.entries(improvements)) {
      if (typeof entry === 'boolean') improvementsRows[key] = entry;
    }
  }
  if (typeof improvementsRows[WP_DASHBOARD_DBUGGER_ENTRY] !== 'boolean') {
    improvementsRows[WP_DASHBOARD_DBUGGER_ENTRY] =
      FALLBACK.improvements[WP_DASHBOARD_DBUGGER_ENTRY];
  }

  const appearance = value['appearance'];
  const appearanceOk = isAppearance(appearance);

  // Same tolerant treatment as `improvements` above, seed-first: known flags
  // start from their documented defaults and every own boolean-valued key is
  // carried (a later read-modify-write writer must not erase a future id).
  const featuresRows: StoredOptions['features'] = {
    [TOOLBAR_BADGE]: FALLBACK.features[TOOLBAR_BADGE],
    [SBS_SCROLL_SYNC]: FALLBACK.features[SBS_SCROLL_SYNC],
    [SBS_MOBILE_SIM]: FALLBACK.features[SBS_MOBILE_SIM],
    [SBS_DESKTOP_WIDTH]: FALLBACK.features[SBS_DESKTOP_WIDTH],
    [DETECTION_WIDGET]: FALLBACK.features[DETECTION_WIDGET]
  };
  const features = value['features'];
  if (typeof features === 'object' && features !== null && !Array.isArray(features)) {
    for (const [key, entry] of Object.entries(features)) {
      if (typeof entry === 'boolean') featuresRows[key] = entry;
    }
  }

  return {
    improvements: improvementsRows,
    appearance: appearanceOk ? appearance : FALLBACK.appearance,
    features: featuresRows
  };
}

/**
 * Validate a raw value through the options contract, degrading to the
 * documented defaults when the validator rejects it — the exact guarantee
 * `getOptions` hands to surfaces, applied to pushed values too (a storage
 * watch delivers writes unchecked; the validation happens here, once).
 *
 * @param input Any storage-delivered value (may be corrupt, foreign, a
 *   partial write, or the item's own fallback for a removed key).
 * @returns The validated options, or the defaults when nothing usable is there.
 */
export function storedOptionsOrFallback(input: unknown): StoredOptions {
  return (
    parseStoredOptions(input) ?? {
      ...FALLBACK,
      improvements: { ...FALLBACK.improvements },
      features: { ...FALLBACK.features }
    }
  );
}

/**
 * Read options through the validator: corrupt storage never reaches surfaces;
 * missing optional slots resolve to defaults.
 */
export async function getOptions(): Promise<StoredOptions> {
  return storedOptionsOrFallback(await optionsStore.getValue());
}

/** The options item's write queue (see `./write-queue`). */
const enqueueOptionsWrite = createWriteQueue();

/**
 * Whole-shape read-modify-write over the validated options, serialized by
 * the item's write queue — a later writer always reads what an earlier one
 * wrote, so concurrent writers cannot revert each other's fields.
 *
 * @param apply The whole-shape transformation (pure; called once, with the
 *   validated stored options — a sync closure, or a thenable-returning one
 *   when the write must wait, as the deferred tests need).
 * @returns The shape that was written.
 * @throws Whatever the read or the write rejects with — this mutation's
 *   caller branches on it; the queue itself keeps flowing, so a rejecting
 *   mutation never stalls the next one.
 */
export function mutateOptions(
  apply: (options: StoredOptions) => StoredOptions | Promise<StoredOptions>
): Promise<StoredOptions> {
  return enqueueOptionsWrite(async () => {
    const current = storedOptionsOrFallback(await optionsStore.getValue());
    // `await` covers both closure kinds; a sync return passes through — and
    // an unawaited async closure would otherwise hand setValue a Promise,
    // serializing to a useless `{}`.
    const written = await apply(current);
    await optionsStore.setValue(written);
    return written;
  });
}

/**
 * Advance the stored appearance one step in its registry order and persist
 * the whole options item (a queued read-modify-write over the validated
 * shape, so every other option slot — and future unknown flags — survive the
 * write; see {@link mutateOptions} for the serialization).
 *
 * The write rides the same storage item every surface reads, so appearance
 * followers (the panel's live watcher, injected UIs) pick the change up with
 * no extra signaling. An unchanged current/next pair (an empty registry
 * order) would be a no-op write; the cycle has three fixed choices, so the
 * outcome is always a change.
 *
 * @throws Nothing deliberately: the storage item's write failure (e.g. an
 *   invalidated extension context after a reload) rejects as the platform
 *   does — callers branch on the rejection (validate-and-log, degrade).
 */
export async function cycleAppearanceOption(): Promise<void> {
  await mutateOptions((options) => ({
    ...options,
    appearance: nextAppearance(options.appearance)
  }));
}

/**
 * Persist one explicit appearance choice and serve it through every surface's
 * existing watch: a queued read-modify-write over the validated whole shape,
 * exactly like {@link cycleAppearanceOption}, so every other option slot —
 * and future unknown flags — survive the write (see {@link mutateOptions} for
 * the serialization). This is the options page's choice seam (the selection
 * applies as soon as it is stored); the cycle remains the keyboard surfaces'
 * step-through.
 *
 * @param next The choice to persist (one of the three documented values).
 * @throws Nothing deliberately: the storage item's write failure (e.g. an
 *   invalidated extension context after a reload) rejects as the platform
 *   does — callers branch on the rejection (validate-and-log, degrade).
 */
export async function setAppearanceOption(next: Appearance): Promise<void> {
  await mutateOptions((options) => ({ ...options, appearance: next }));
}
