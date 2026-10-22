/**
 * The engine report read for the editor: per-lane counts and per-row match
 * counts of the page the session rewrote. A count is shown only where it is
 * true — for a row the applied set carried, on the page it was applied to.
 */
import { trimExclusionRow } from '../../../lib/exclusion-builder/field-text';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import { laneFeature, type LaneKey } from './draft';

/** One lane's counts on the rewritten page, with what the engine could not tell. */
export interface LaneCounts {
  /** Elements the feature had acted on (candidates for the exclusion). */
  readonly candidates: number;
  /** Elements the session restored. */
  readonly rewritten: number;
  /** The feature-wide disable, not rows, drove the run. */
  readonly featureWide: boolean;
  /**
   * Candidates left as served because how WP Rocket matched them cannot be
   * read off the page (the inline-jQuery share excluded: see `inlineUnknown`).
   */
  readonly undetermined: number;
  /** Candidates matched against a rebuilt tag (WP Rocket's original was not on the page). */
  readonly approximate: number;
  /**
   * Defer JS: wrapped inline scripts were left as served because whether WP
   * Rocket's inline-jQuery pass runs depends on the site's own exclusions —
   * told once for the page, never counted per script.
   */
  readonly inlineUnknown: boolean;
  /** The per-row counts credit the first matching row only (WP Rocket matches the rows as one pattern). */
  readonly bestEffort: boolean;
  /**
   * Whether WP Rocket runs the feature on the page under the applied rows
   * wasn't checked: the counts assume it does.
   */
  readonly pageUnknown: boolean;
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
  const inline = report.inlineUndetermined ?? 0;
  return {
    candidates: report.candidates,
    rewritten: report.rewritten,
    featureWide: report.featureWide,
    undetermined: (report.undetermined ?? 0) - inline,
    approximate: report.approximate ?? 0,
    inlineUnknown: inline > 0,
    bestEffort: report.rowCountsBestEffort === true,
    pageUnknown: report.pageState === 'unknown'
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
  // The report names rows as applied — stored; the row may still be typed.
  const row = trimExclusionRow(text);
  const matched = report.matchedRows.find((candidate) => candidate.row === row);
  if (matched !== undefined) return matched.matches;
  return report.unmatchedRows.includes(row) ? 0 : null;
}
