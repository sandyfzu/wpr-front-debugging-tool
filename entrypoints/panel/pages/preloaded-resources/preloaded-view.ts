/**
 * Pure presentation rules for the Preloaded Resources page: which of its
 * three honest states a report is in, the `as` type chip text, row identity
 * across refreshes, the summary notes and the row's seed height.
 */
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import type { PreloadedResource } from '../../../../lib/panel/resources-view-model';
import type { PreloadedResources } from '../../../../lib/wp-rocket/types';
import { formatCount, listCapped } from '../resource-list/resource-list-view';

/**
 * What the page can say about the report:
 * - `none` — no link carries WP Rocket's preload marker (the engine reports
 *   the feature absent, with no list), or the collected list is empty;
 * - `not-collected` — the feature reads present but the payload carries no
 *   list (the contract's optional field; nothing can be said about rows);
 * - `rows` — at least one preloaded resource.
 */
export type PreloadedInventory = 'none' | 'not-collected' | 'rows';

/**
 * Classify a preloaded-resources report.
 *
 * Absence of the list alone does not mean "not collected": the engine
 * reports `{ present: false }` with no list whenever nothing is preloaded,
 * which is the page's common empty case and must read as such.
 *
 * @param report The payload's preloaded-resources report.
 * @returns The page state.
 */
export function preloadedInventory(report: PreloadedResources): PreloadedInventory {
  if (!report.present) return 'none';
  if (report.resources === undefined) return 'not-collected';
  return report.resources.length > 0 ? 'rows' : 'none';
}

/**
 * The `as` chip text: the hint's value lower-cased (attribute casing is page
 * noise), or `null` when the hint carries none (the chip then shows `—`).
 *
 * @param type The captured `as` value.
 * @returns The chip text, or `null` for no type.
 */
export function asTypeLabel(type: string): string | null {
  const value = type.trim().toLowerCase();
  return value === '' ? null : value;
}

/** Seed height of a preloaded row (name line + URL line), in px. */
export const PRELOADED_ROW_ESTIMATE = 55;

/**
 * The feature badge's label. `data-rocket-preload` is written by several
 * WP Rocket features (critical images, fonts, preloaded links), not only the
 * cache Preload option, so the badge names what was found: the hints.
 */
export const PRELOAD_HINTS_LABEL = 'Preload hints';

/** What a row without an `href` says: such hints carry only `imagesrcset`. */
export const SRCSET_ONLY_LABEL = 'No URL (srcset only)';

/**
 * Whether two resource rows with the same id show the same thing (the
 * refresh reuse test).
 *
 * @param a The previous row.
 * @param b The fresh row.
 * @returns `true` when URL and type match.
 */
export function samePreloadedRow(a: PreloadedResource, b: PreloadedResource): boolean {
  return a.href === b.href && a.type === b.type;
}

/**
 * The summary strip's caveats: the capture capped the resource list (counts
 * then cover the kept rows only).
 *
 * @param report The payload's preloaded-resources report.
 * @returns The notes (often none).
 */
export function preloadedNotes(report: PreloadedResources): string[] {
  const cap = PAYLOAD_LIMITS.preloaded.count;
  return listCapped(report.truncated, report.resources?.length ?? 0, cap)
    ? [`The list was capped at the first ${formatCount(cap)} resources; counts cover these rows.`]
    : [];
}
