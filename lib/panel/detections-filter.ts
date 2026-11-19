/**
 * The Detections status filter: narrows the optimization rows to one bucket —
 * active in this tab, collecting, or off. Page-context rows (plugin identity,
 * beacon, mobile cache, Server, Known Platform, host layers, Cached) are never
 * narrowed — they describe the page, not an optimization.
 *
 * Pure: the page owns the selection signal; this module owns the vocabulary
 * and the counts. The buckets themselves are the summary's
 * ({@link optimizationBucket}), so the filter's counts equal the overview's.
 */
import type { StatusItem } from './detections-view-model';
import {
  isOptimizationCard,
  optimizationBucket,
  type OptimizationBucket
} from './detections-summary';

/** One status filter id: every optimization, or one bucket. */
export type DetectionFilterId = 'all' | OptimizationBucket;

/**
 * The filter segments in render order — the one declaring site. `all` comes
 * first: it is the identity segment (default, reset target, always
 * reachable). "Off" covers every optimization that is neither active here
 * nor collecting — not enabled, not applied, unknown, or turned off in this
 * tab by the Exclusion Builder; each row keeps its own state and why.
 */
export const DETECTION_FILTERS: readonly {
  readonly id: DetectionFilterId;
  readonly label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'collecting', label: 'Collecting' },
  { id: 'off', label: 'Off' }
];

/** The filter group's name — what the segments narrow. */
export const DETECTION_FILTER_LABEL = 'Optimization status';

/**
 * Which bucket an optimization row falls in — the summary's rule, never
 * re-coded here: active = {@link isActiveInTab}, collecting, off = the rest.
 *
 * @param item An optimization row.
 * @returns Its bucket.
 */
export function statusBucket(item: StatusItem): OptimizationBucket {
  return optimizationBucket(item);
}

/**
 * Whether a row stays visible under a filter.
 *
 * @param item Any row.
 * @param filter The selected filter.
 * @returns True for page-context rows always, else when the row's bucket matches.
 */
export function matchesDetectionFilter(item: StatusItem, filter: DetectionFilterId): boolean {
  if (filter === 'all' || !isOptimizationCard(item.id)) return true;
  return statusBucket(item) === filter;
}

/**
 * Narrow the rows to one filter, keeping render order and page-context rows.
 *
 * @param items The rows, in render order.
 * @param filter The selected filter.
 * @returns `items` itself for `all` (no new array, so memos downstream stay
 *   quiet), else the kept rows.
 */
export function filterStatusItems(
  items: readonly StatusItem[],
  filter: DetectionFilterId
): readonly StatusItem[] {
  if (filter === 'all') return items;
  return items.filter((item) => matchesDetectionFilter(item, filter));
}

/**
 * Count the optimization rows per filter (page-context rows excluded: the
 * segments count what they narrow).
 *
 * @param items The rows (the full page list, never a filtered one).
 * @returns One count per filter id; the buckets sum to `all`.
 */
export function optimizationCounts(
  items: readonly StatusItem[]
): Readonly<Record<DetectionFilterId, number>> {
  const counts: Record<DetectionFilterId, number> = { all: 0, active: 0, collecting: 0, off: 0 };
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
 * @returns Its segment label.
 * @throws {@link Error} When the id is not declared (a call-site bug).
 */
export function detectionFilterLabel(filter: DetectionFilterId): string {
  const found = DETECTION_FILTERS.find((entry) => entry.id === filter);
  if (found === undefined) throw new Error(`Unknown detection filter "${filter}".`);
  return found.label;
}
