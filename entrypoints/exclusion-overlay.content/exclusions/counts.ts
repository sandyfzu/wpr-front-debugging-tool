/**
 * The engine report read for the editor: per-lane counts and per-row match
 * counts of the page the session rewrote. A count is shown only where it is
 * true — for a row the applied set carried, on the page it was applied to.
 */
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { laneFeature, type LaneKey } from './draft';

/** One lane's counts on the rewritten page. */
export interface LaneCounts {
  /** Elements the feature had acted on (candidates for the exclusion). */
  readonly candidates: number;
  /** Elements the session restored. */
  readonly rewritten: number;
  /** The feature-wide disable, not rows, drove the run. */
  readonly featureWide: boolean;
}

/**
 * A lane's report among the page's reports.
 *
 * @param reports The rewritten page's reports.
 * @param lane The lane.
 */
export function laneReport(
  reports: readonly TransformReport[],
  lane: LaneKey
): TransformReport | undefined {
  const feature = laneFeature(lane).id;
  return reports.find((report) => report.feature === feature);
}

/**
 * A lane's counts, or null when the page has no report for it (the
 * feature was inactive in the applied set).
 *
 * @param report The lane's report.
 */
export function laneCounts(report: TransformReport | undefined): LaneCounts | null {
  if (report === undefined) return null;
  return {
    candidates: report.candidates,
    rewritten: report.rewritten,
    featureWide: report.featureWide
  };
}

/**
 * How many elements a row matched on the rewritten page: a count (0 = the
 * no-match warning), or null when unknown — the row was not in the applied
 * set (edited or added since), or the feature-wide disable ran instead of
 * rows.
 *
 * @param report The row's lane report.
 * @param text The row as typed.
 */
export function rowMatches(report: TransformReport | undefined, text: string): number | null {
  if (report === undefined || report.featureWide) return null;
  const matched = report.matchedRows.find((row) => row.row === text);
  if (matched !== undefined) return matched.matches;
  return report.unmatchedRows.includes(text) ? 0 : null;
}
