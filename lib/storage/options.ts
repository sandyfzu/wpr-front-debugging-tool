/**
 * The options surface's registered storage shape.
 *
 * All option keys this tool stores live here as one shape so a surface (the
 * options page, the popup, injected UI) only ever reads keys defined here;
 * phases may extend additively with a documented default.
 *
 * Read options through {@link getOptions} (validated, corrupt-tolerant);
 * `optionsStore` is the raw storage item, kept for `watch`/writes.
 */

import { storage } from 'wxt/utils/storage';
import { APPEARANCES, type Appearance } from '../../utils/theme';

/** Canonical storage keys, declared once and reused by every slot below. */
const WP_DASHBOARD_DBUGGER_ENTRY = 'wp-dashboard-dbugger-entry';
const TOOLBAR_BADGE = 'toolbarBadge';
const SBS_SCROLL_SYNC = 'sbsScrollSync';
const SBS_MOBILE_SIM = 'sbsMobileSim';
const SBS_DESKTOP_WIDTH = 'sbsDesktopWidth';

/**
 * Registered option storage.
 *
 * - `improvements.wp-dashboard-dbugger-entry` — whether the admin-bar entry
 *   is injected into `wp-admin`; id kept verbatim as the canonical key.
 * - `appearance` — one of exactly `system` (follows the OS palette),
 *   `dark`, `light`; rendered UI sets `data-theme` from it before paint.
 * - `features.toolbarBadge` — the per-tab toolbar action badge.
 * - `features.sbsScrollSync` — the compare overlay's scroll sync (default
 *   on since the owner's 2026-10-11 decision — off at plan time; the
 *   overlay's own header switch writes it).
 * - `features.sbsMobileSim` — the compare overlay's mobile-comparison
 *   switch (default off; the overlay's own header switch writes it).
 * - `features.sbsDesktopWidth` — the compare overlay's desktop-width dress
 *   (default on — the owner's 2026-10-12 directive; the overlay's own header
 *   switch writes it).
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
    [SBS_DESKTOP_WIDTH]: true
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
  const appearanceOk =
    typeof appearance === 'string' && (APPEARANCES as readonly string[]).includes(appearance);

  // Same tolerant treatment as `improvements` above, seed-first: known flags
  // start from their documented defaults and every own boolean-valued key is
  // carried (a later read-modify-write writer must not erase a future id).
  const featuresRows: StoredOptions['features'] = {
    [TOOLBAR_BADGE]: FALLBACK.features[TOOLBAR_BADGE],
    [SBS_SCROLL_SYNC]: FALLBACK.features[SBS_SCROLL_SYNC],
    [SBS_MOBILE_SIM]: FALLBACK.features[SBS_MOBILE_SIM],
    [SBS_DESKTOP_WIDTH]: FALLBACK.features[SBS_DESKTOP_WIDTH]
  };
  const features = value['features'];
  if (typeof features === 'object' && features !== null && !Array.isArray(features)) {
    for (const [key, entry] of Object.entries(features)) {
      if (typeof entry === 'boolean') featuresRows[key] = entry;
    }
  }

  return {
    improvements: improvementsRows,
    appearance: appearanceOk ? (appearance as StoredOptions['appearance']) : FALLBACK.appearance,
    features: featuresRows
  };
}

/**
 * Read options through the validator: corrupt storage never reaches surfaces;
 * missing optional slots resolve to defaults.
 */
export async function getOptions(): Promise<StoredOptions> {
  const raw = await optionsStore.getValue();
  return (
    parseStoredOptions(raw) ?? {
      ...FALLBACK,
      improvements: { ...FALLBACK.improvements },
      features: { ...FALLBACK.features }
    }
  );
}
