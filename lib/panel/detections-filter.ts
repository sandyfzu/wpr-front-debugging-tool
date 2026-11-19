/**
 * The Detections status filter: narrows the optimization cards to the ones
 * running in this tab or the ones that are not. Page-context cards (plugin
 * identity, beacon, mobile cache, Server, Known Platform, host layers,
 * Cached) are never narrowed — they describe the page, not an optimization.
 *
 * Pure: the page owns the selection signal; this module owns the vocabulary,
 * the buckets and the counts.
 */
import type { StatusItem } from './detections-view-model';
import { isActiveInTab, isOptimizationCard } from './detections-summary';

/** One status filter id: every optimization, the running ones, or the rest. */
export type DetectionFilterId = 'all' | 'active' | 'inactive';

/**
 * The filter chips in render order — the one declaring site. `all` comes
 * first: it is the identity chip (default, reset target, always reachable).
 * "Inactive" means not running in this tab, never "disabled": a collecting or
 * unknown card is inactive yet keeps its own badge and why.
 */
export const DETECTION_FILTERS: readonly {
  readonly id: DetectionFilterId;
  readonly label: string;
}[] = [
  { id: 'all', label: 'All optimizations' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' }
];

/** The chip group's name — what the chips narrow. */
export const DETECTION_FILTER_LABEL = 'Optimization status';

/**
 * Which bucket an optimization card falls in. Uses the summary's counting
 * rule ({@link isActiveInTab}), so the Active chip's count always equals the
 * overview's "N of M active": a served card the Exclusion Builder turned off
 * here (feature-wide or page-off) is inactive; excluded rows leave it active.
 *
 * @param item An optimization card.
 * @returns `active` or `inactive`.
 */
export function statusBucket(item: StatusItem): Exclude<DetectionFilterId, 'all'> {
  return isActiveInTab(item) ? 'active' : 'inactive';
}

/**
 * Whether a card stays visible under a filter.
 *
 * @param item Any card.
 * @param filter The selected filter.
 * @returns True for page-context cards always, else when the card's bucket matches.
 */
export function matchesDetectionFilter(item: StatusItem, filter: DetectionFilterId): boolean {
  if (filter === 'all' || !isOptimizationCard(item.id)) return true;
  return statusBucket(item) === filter;
}

/**
 * Narrow the cards to one filter, keeping render order and page-context cards.
 *
 * @param items The cards, in render order.
 * @param filter The selected filter.
 * @returns `items` itself for `all` (no new array, so memos downstream stay
 *   quiet), else the kept cards.
 */
export function filterStatusItems(
  items: readonly StatusItem[],
  filter: DetectionFilterId
): readonly StatusItem[] {
  if (filter === 'all') return items;
  return items.filter((item) => matchesDetectionFilter(item, filter));
}

/**
 * Count the optimization cards per filter (page-context cards excluded:
 * the chips count what they narrow).
 *
 * @param items The cards (the full page list, never a filtered one).
 * @returns One count per filter id.
 */
export function optimizationCounts(
  items: readonly StatusItem[]
): Readonly<Record<DetectionFilterId, number>> {
  const counts = { all: 0, active: 0, inactive: 0 };
  for (const item of items) {
    if (!isOptimizationCard(item.id)) continue;
    counts.all += 1;
    counts[statusBucket(item)] += 1;
  }
  return counts;
}

/**
 * The label of a filter id (for the filtered-empty line).
 *
 * @param filter A filter id.
 * @returns Its chip label.
 * @throws {@link Error} When the id is not declared (a call-site bug).
 */
export function detectionFilterLabel(filter: DetectionFilterId): string {
  const found = DETECTION_FILTERS.find((entry) => entry.id === filter);
  if (found === undefined) throw new Error(`Unknown detection filter "${filter}".`);
  return found.label;
}
