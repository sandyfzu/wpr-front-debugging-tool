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

/**
 * Registered option storage.
 *
 * - `improvements.wp-dashboard-dbugger-entry` — whether the admin-bar entry
 *   is injected into `wp-admin`; id kept verbatim as the canonical key.
 * - `appearance` — one of exactly `system` (follows the OS palette),
 *   `dark`, `light`; rendered UI sets `data-theme` from it before paint.
 * - `features.toolbarBadge` — the per-tab toolbar action badge.
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
  };
}

const FALLBACK: Readonly<StoredOptions> = Object.freeze({
  improvements: Object.freeze({
    [WP_DASHBOARD_DBUGGER_ENTRY]: true
  }),
  appearance: 'system',
  features: Object.freeze({
    [TOOLBAR_BADGE]: true
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

  const features = value['features'];
  const badge =
    typeof features === 'object' && features !== null && !Array.isArray(features)
      ? (features as Record<string, unknown>)['toolbarBadge']
      : undefined;

  return {
    improvements: improvementsRows,
    appearance: appearanceOk ? (appearance as StoredOptions['appearance']) : FALLBACK.appearance,
    features: {
      [TOOLBAR_BADGE]: typeof badge === 'boolean' ? badge : FALLBACK.features[TOOLBAR_BADGE]
    }
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
