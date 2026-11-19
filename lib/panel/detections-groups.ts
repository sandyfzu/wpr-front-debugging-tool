/**
 * The Detections page's Grouped layout model: every row the view model
 * builds lands in exactly one place — an overview tile (the facts the tiles
 * already state) or one group. Feature rows take their HUD group (WP Rocket's
 * own settings sections, the order the on-page strip and the report use);
 * the other rows are placed by {@link PLACEMENTS}; a row no table knows (a
 * future detection row) lands in "Other detections", never dropped.
 *
 * Pure: the page renders the groups; this module owns placement, order, the
 * per-group "N of M optimizations active" (the summary's counting rule) and
 * the evidence norm that lets a row hide a source chip its group header
 * already states.
 */
import { HUD_GROUPS, hudFeatureOf, type HudGroupId } from '../detection/hud';
import type { FeatureEvidenceSource } from '../wp-rocket/types';
import { isActiveInTab, isOptimizationCard } from './detections-summary';
import type { StatusItem, StatusItemId } from './detections-view-model';

/** A group id: a HUD group, the fallback for unplaced rows, or the page context. */
export type DetectionGroupId = HudGroupId | 'other' | 'page';

/** Where a row renders in the Grouped layout: a tile, or a group. */
export type DetectionPlacement = DetectionGroupId | 'tile';

/**
 * The groups in render order — the one declaring site. The HUD groups keep
 * their headings; "Other detections" holds rows no table places yet, "Page"
 * the page-context rows no tile states.
 */
export const DETECTION_GROUPS: readonly {
  readonly id: DetectionGroupId;
  readonly heading: string;
}[] = [
  ...HUD_GROUPS,
  { id: 'other', heading: 'Other detections' },
  { id: 'page', heading: 'Page' }
];

/**
 * The placement of every row that is no HUD feature. `tile`: the overview
 * states it — `wpr` (WP Rocket tile: version + evidence), `cached` (Page
 * cache tile: the stamp), `server` and `known-platform` (Stack tile). The
 * Priority Elements beacon joins the family it measures for (`features`);
 * host layers stay a page fact (the cache tile names one layer, not the
 * captured list).
 */
export const PLACEMENTS: ReadonlyMap<StatusItemId, DetectionPlacement> = new Map<
  StatusItemId,
  DetectionPlacement
>([
  ['wpr', 'tile'],
  ['cached', 'tile'],
  ['server', 'tile'],
  ['known-platform', 'tile'],
  ['priority_elements_beacon', 'features'],
  ['host-layers', 'page']
]);

/**
 * Where a row renders in the Grouped layout.
 *
 * @param id The row's id.
 * @returns Its HUD group for a feature, else its {@link PLACEMENTS} entry,
 *   else `other` (an unknown future row is shown, never dropped).
 */
export function placementOf(id: StatusItemId): DetectionPlacement {
  return hudFeatureOf(id)?.group ?? PLACEMENTS.get(id) ?? 'other';
}

/** One rendered group. */
export interface DetectionGroup {
  /** The group's id (its render key). */
  readonly id: DetectionGroupId;
  /** The group's heading. */
  readonly heading: string;
  /** The group's rows under the current filter, in render order (never empty). */
  readonly items: readonly StatusItem[];
  /** Optimization rows of the whole group active in this tab (filter-independent). */
  readonly active: number;
  /** Optimization rows of the whole group (filter-independent; 0: no summary). */
  readonly total: number;
  /**
   * The evidence source every row of the whole group carries, stated once in
   * the header; null when a row lacks a source or two rows differ.
   */
  readonly evidenceNorm: FeatureEvidenceSource | null;
}

/**
 * The source every row carries. All or nothing: a header chip over a row
 * with another source — or with none — would credit that row with evidence
 * it does not have, so any exception drops the norm and each row with a
 * source shows its own chip.
 *
 * @param items A group's full row list.
 * @returns That source, or null (no rows, a sourceless row, or two sources).
 */
export function evidenceNormOf(items: readonly StatusItem[]): FeatureEvidenceSource | null {
  const source = items[0]?.source;
  if (source === undefined) return null;
  return items.every((item) => item.source === source) ? source : null;
}

/**
 * Whether a row shows its own source chip under its group: only when the
 * header states no norm (a row with no source has none; a norm, by
 * {@link evidenceNormOf}, already is every row's own source).
 *
 * @param item The row.
 * @param norm Its group's {@link DetectionGroup.evidenceNorm}.
 * @returns True when the row's chip carries information the header does not.
 */
export function showsOwnSource(item: StatusItem, norm: FeatureEvidenceSource | null): boolean {
  return item.source !== undefined && item.source !== norm;
}

/**
 * Bucket rows by placement, keeping their order; tile rows are left out.
 *
 * @param items Rows in render order.
 * @returns Each group's rows (only groups that received one).
 */
function byGroup(items: readonly StatusItem[]): Map<DetectionGroupId, StatusItem[]> {
  const groups = new Map<DetectionGroupId, StatusItem[]>();
  for (const item of items) {
    const placement = placementOf(item.id);
    if (placement === 'tile') continue;
    const rows = groups.get(placement);
    if (rows === undefined) groups.set(placement, [item]);
    else rows.push(item);
  }
  return groups;
}

/**
 * Build the Grouped layout: the groups holding at least one shown row, in
 * {@link DETECTION_GROUPS} order. Summaries and the evidence norm read the
 * full list, so they hold still while a filter narrows the rows.
 *
 * @param all Every row of the page (the full view-model list).
 * @param shown The rows the filter keeps (a subset of `all`, same order).
 * @returns The groups to render.
 */
export function groupDetections(
  all: readonly StatusItem[],
  shown: readonly StatusItem[]
): DetectionGroup[] {
  const full = byGroup(all);
  const kept = byGroup(shown);
  const groups: DetectionGroup[] = [];
  for (const { id, heading } of DETECTION_GROUPS) {
    const items = kept.get(id);
    if (items === undefined) continue;
    const rows = full.get(id) ?? items;
    const optimizations = rows.filter((item) => isOptimizationCard(item.id));
    groups.push({
      id,
      heading,
      items,
      active: optimizations.filter(isActiveInTab).length,
      total: optimizations.length,
      evidenceNorm: evidenceNormOf(rows)
    });
  }
  return groups;
}

/**
 * A group header's count line. Names what it counts: a group can hold rows
 * that are no optimization (a beacon, a page fact) yet show an Active pill.
 *
 * @param group The group.
 * @returns "N of M optimizations active", or null for a group with no
 *   optimization row.
 */
export function groupSummaryText(group: Pick<DetectionGroup, 'active' | 'total'>): string | null {
  return group.total === 0
    ? null
    : `${group.active.toString()} of ${group.total.toString()} optimizations active`;
}
