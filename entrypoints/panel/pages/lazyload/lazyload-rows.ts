/**
 * Pure presentation rules for the Lazyload page's rows: the state badge, the
 * exclusion-reason split (the tool's own exclusion marker shown apart from the
 * page's reasons) and the row's seed height.
 */
import type { StatusKind } from '../../../../components/ui/status-badge';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';

/** The state badge of one image row. */
export interface LazyloadStateBadge {
  /** Vocabulary kind: lazyloaded is information, not a verdict; the rest is neutral. */
  readonly kind: StatusKind;
  /** The visible state text. */
  readonly label: string;
}

/**
 * The state badge for a row: `Lazyloaded` → `info`, `Not lazyloaded` →
 * `neutral` (an image outside lazyload is often deliberate — never an error).
 *
 * @param row The image row.
 * @returns The badge's kind and text.
 */
export function lazyloadStateBadge(row: LazyloadImageResource): LazyloadStateBadge {
  return row.lazyloaded
    ? { kind: 'info', label: 'Lazyloaded' }
    : { kind: 'neutral', label: 'Not lazyloaded' };
}

/** A non-lazyloaded row's reasons, split for display. */
export interface ExclusionReasons {
  /** The image carries the tool's own exclusion marker. */
  readonly excludedByTool: boolean;
  /** The page's other reasons, in the exclusion list's order. */
  readonly reasons: readonly string[];
}

/**
 * Split a row's exclusion reasons: the tool's own marker is pulled out (it
 * renders as its own, distinct "Excluded by FDT" badge) and the rest keep
 * their order. Every reason stays visible — the marker never hides the
 * page's own reasons.
 *
 * @param row The image row.
 * @returns The marker flag and the remaining reasons.
 */
export function exclusionReasons(row: LazyloadImageResource): ExclusionReasons {
  return {
    excludedByTool: row.excludedReasons.includes(FDT_EXCLUDED_RESOURCE),
    reasons: row.excludedReasons.filter((reason) => reason !== FDT_EXCLUDED_RESOURCE)
  };
}

/** Seed height of a row without reasons (name line + URL line), in px. */
export const LAZYLOAD_ROW_ESTIMATE = 55;

/** Seed height of a row with its reasons line, in px (measurement refines wraps). */
export const LAZYLOAD_ROW_WITH_REASONS_ESTIMATE = 79;

/**
 * The row's seed height for the virtual list: lazyloaded rows are the identity
 * block only, the rest add their reasons line.
 *
 * @param row The image row.
 * @returns The estimate in px.
 */
export function lazyloadRowEstimate(row: LazyloadImageResource): number {
  return row.lazyloaded ? LAZYLOAD_ROW_ESTIMATE : LAZYLOAD_ROW_WITH_REASONS_ESTIMATE;
}
