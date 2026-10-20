/**
 * The per-transform report contract: counts and row attributions for
 * UI/status consumption — which rows matched what, how many candidates a
 * transform found, how many it actually rewrote, and whether the
 * feature-wide disable (not a row) drove the rewrites.
 */
import type { ExclusionFeatureId } from './set';

/** How a feature's rows match — distinguishes the two row kinds in reports. */
export type ExclusionRowKind = 'pattern' | 'literal';

/** One row's match count within one transform run. */
export interface ExclusionRowMatch {
  /** The row as given. */
  readonly row: string;
  /** How the row matches (its feature's kind). */
  readonly rowKind: ExclusionRowKind;
  /** Elements this row matched (first matching row only — the plugin's own semantics). */
  readonly matches: number;
}

/** One transform's report. */
export interface TransformReport {
  /** The feature the transform acts for. */
  readonly feature: ExclusionFeatureId;
  /** The feature-wide disable drove this run — rows were not consulted. */
  readonly featureWide: boolean;
  /** Candidate elements found (delayed scripts, lazy images, stamped elements). */
  readonly candidates: number;
  /** Candidates actually rewritten (a candidate can carry nothing to restore). */
  readonly rewritten: number;
  /** Rows that matched at least one element, in row order. */
  readonly matchedRows: readonly ExclusionRowMatch[];
  /** Rows that matched nothing — the honest no-match signal for status. */
  readonly unmatchedRows: readonly string[];
}

/** One transform's output: the rewritten html plus its report. */
export interface TransformResult {
  readonly html: string;
  readonly report: TransformReport;
}

/** The inputs of {@link transformReport} — a transform's collected counters. */
export interface TransformCounters {
  readonly feature: ExclusionFeatureId;
  readonly rowKind: ExclusionRowKind;
  /** The rows as given. */
  readonly rows: readonly string[];
  /** Match count per row, parallel to `rows` (all zero when feature-wide). */
  readonly matchCounts: readonly number[];
  readonly candidates: number;
  readonly rewritten: number;
  readonly featureWide: boolean;
}

/**
 * Build the report from a transform's counters: rows split into matched
 * (count > 0) and unmatched, both in row order. A feature-wide run reports
 * no row attributions — the disable, not a row, matched.
 *
 * @param counters The transform's collected counters.
 * @returns The report.
 */
export function transformReport(counters: TransformCounters): TransformReport {
  const { feature, rowKind, rows, matchCounts, candidates, rewritten, featureWide } = counters;
  if (featureWide) {
    return {
      feature,
      featureWide: true,
      candidates,
      rewritten,
      matchedRows: [],
      unmatchedRows: []
    };
  }
  const matchedRows: ExclusionRowMatch[] = [];
  const unmatchedRows: string[] = [];
  rows.forEach((row, index) => {
    const matches = matchCounts[index] ?? 0;
    if (matches > 0) matchedRows.push({ row, rowKind, matches });
    else unmatchedRows.push(row);
  });
  return { feature, featureWide: false, candidates, rewritten, matchedRows, unmatchedRows };
}
