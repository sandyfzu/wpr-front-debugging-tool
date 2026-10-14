/**
 * Pure presentation rules for the Preloaded Resources page: which of its
 * three honest states a report is in, the `as` type chip text and the row's
 * seed height.
 */
import type { PreloadedResources } from '../../../../lib/wp-rocket/types';

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
