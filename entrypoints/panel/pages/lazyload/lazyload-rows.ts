/**
 * Pure presentation rules for the Lazyload page: the state badge, the
 * exclusion-reason split (the tool's own exclusion marker shown apart from the
 * page's reasons), row identity across refreshes, the summary notes and the
 * row's seed height.
 */
import type { StatusKind } from '../../../../components/ui/status-badge';
import type { LazyloadImageResource } from '../../../../lib/panel/resources-view-model';
import { PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import { FDT_EXCLUDED_RESOURCE } from '../../../../lib/wp-rocket/constants';
import type { WprDetections } from '../../../../lib/wp-rocket/types';
import { formatCount, listCapped } from '../resource-list/resource-list-view';

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

/**
 * Exclusion evidence is meaningful only while the page's lazyload feature is detected.
 *
 * @param row The image row.
 * @param featurePresent Whether image lazyload was detected on the page.
 * @returns Whether to render the row's exclusion details, including the empty fallback.
 */
export function showLazyloadReasons(row: LazyloadImageResource, featurePresent: boolean): boolean {
  return featurePresent && !row.lazyloaded;
}

/** Seed height of a row without reasons (name line + URL line), in px. */
export const LAZYLOAD_ROW_ESTIMATE = 55;

/** Seed height of a row with its reasons line, in px (measurement refines wraps). */
export const LAZYLOAD_ROW_WITH_REASONS_ESTIMATE = 79;

/**
 * Seed the virtual list with the same visibility rule as the reasons line.
 *
 * @param row The image row.
 * @param featurePresent Whether image lazyload was detected on the page.
 * @returns The estimate in px.
 */
export function lazyloadRowEstimate(row: LazyloadImageResource, featurePresent: boolean): number {
  return showLazyloadReasons(row, featurePresent)
    ? LAZYLOAD_ROW_WITH_REASONS_ESTIMATE
    : LAZYLOAD_ROW_ESTIMATE;
}

/**
 * Whether two image rows with the same id show the same thing (the refresh
 * reuse test): URL, state and reasons in order.
 *
 * @param a The previous row.
 * @param b The fresh row.
 * @returns `true` when nothing visible differs.
 */
export function sameImageRow(a: LazyloadImageResource, b: LazyloadImageResource): boolean {
  return (
    a.src === b.src &&
    a.lazyloaded === b.lazyloaded &&
    a.excludedReasons.length === b.excludedReasons.length &&
    a.excludedReasons.every((reason, index) => reason === b.excludedReasons[index])
  );
}

/**
 * The summary strip's caveats:
 * - the capture capped the image list (counts then cover the kept rows only);
 * - images carry the lazyload attribute while the feature's script was not
 *   found — the badge's "not detected" would otherwise read as a contradiction.
 *
 * @param lazyload The payload's lazyload detection.
 * @returns The notes, in display order (often none).
 */
export function lazyloadNotes(lazyload: WprDetections['lazyload']): string[] {
  const notes: string[] = [];
  const cap = PAYLOAD_LIMITS.images.count;
  if (listCapped(lazyload.truncated, lazyload.images.length, cap)) {
    notes.push(
      `The list was capped at the first ${formatCount(cap)} images; counts cover these rows.`
    );
  }
  if (!lazyload.present && lazyload.images.some((image) => image.lazyloadDetected)) {
    notes.push(
      "Some images carry WP Rocket's lazyload attribute, but its lazyload script was not found on this page."
    );
  }
  return notes;
}
