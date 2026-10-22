/**
 * The per-transform report contract: counts and row attributions for
 * UI/status consumption — which rows matched what, how many candidates a
 * transform found, how many it actually rewrote, and whether the
 * feature-wide disable (not a row) drove the rewrites.
 */
import type { ExclusionFeatureId, ExclusionRowKind } from './set';

/** One row's match count within one transform run. */
export interface ExclusionRowMatch {
  /** The row as given. */
  readonly row: string;
  /** How the row matches (its feature's kind). */
  readonly rowKind: ExclusionRowKind;
  /** Elements this row matched (first matching row in list order wins per element; see {@link TransformReport.rowCountsBestEffort}). */
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
  /**
   * Whole-region removals — spans deleted outright (start..end), never
   * attribute edits: the feature-wide disable's markup removals (the
   * plugin's inline CSS block, its controller scripts). A row-matched run
   * removes no region, so this is 0 there.
   */
  readonly regionRemovals: number;
  /** Rows that matched at least one element, in row order. */
  readonly matchedRows: readonly ExclusionRowMatch[];
  /** Rows that matched nothing — the honest no-match signal for status. */
  readonly unmatchedRows: readonly string[];
  /**
   * Candidates whose outcome the engine cannot determine (left as served);
   * present only when non-zero.
   */
  readonly undetermined?: number;
  /**
   * Candidates matched against a rebuilt, approximate subject (WP Rocket's
   * original could not be read off the page); present only when non-zero.
   */
  readonly approximate?: number;
  /**
   * WP Rocket's own run of the feature on this page could not be
   * determined (Defer JS: whether its joined-pattern pre-check passes, which
   * decides whether it defers anything at all): the row matches are
   * reported as if it runs. Present only then — a set that turns the
   * feature off fails validation, so a report never says `off`.
   */
  readonly pageState?: 'unknown';
  /**
   * The per-row counts are best effort: WP Rocket matches the rows as one
   * pattern, so which row matched is not observable there; the first
   * matching row in list order is credited. Present only then (Defer JS,
   * more than one row).
   */
  readonly rowCountsBestEffort?: true;
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
  /** Whole-region removals (see {@link TransformReport.regionRemovals}). */
  readonly regionRemovals: number;
  readonly featureWide: boolean;
  /** See {@link TransformReport.undetermined} (0 when omitted). */
  readonly undetermined?: number;
  /** See {@link TransformReport.approximate} (0 when omitted). */
  readonly approximate?: number;
  /** See {@link TransformReport.pageState} (WP Rocket runs the feature when omitted). */
  readonly pageState?: 'unknown';
  /** See {@link TransformReport.rowCountsBestEffort} (exact when omitted). */
  readonly rowCountsBestEffort?: boolean;
}

/**
 * The optional counts of a report, each only when non-zero.
 *
 * @param counters The transform's counters.
 */
function optionalCounts(
  counters: TransformCounters
): Pick<TransformReport, 'undetermined' | 'approximate'> {
  return {
    ...(counters.undetermined ? { undetermined: counters.undetermined } : {}),
    ...(counters.approximate ? { approximate: counters.approximate } : {})
  };
}

/**
 * The row-driven caveats of a report, each only when set (a feature-wide
 * run consults no rows, so it never carries them).
 *
 * @param counters The transform's counters.
 */
function rowCaveats(
  counters: TransformCounters
): Pick<TransformReport, 'pageState' | 'rowCountsBestEffort'> {
  return {
    ...(counters.pageState === 'unknown' ? { pageState: 'unknown' as const } : {}),
    ...(counters.rowCountsBestEffort === true ? { rowCountsBestEffort: true as const } : {})
  };
}

/**
 * Build the report from a transform's counters: rows split into matched
 * (count > 0) and unmatched, both in row order. A feature-wide run reports
 * no row attributions or row caveats — the disable, not a row, matched.
 *
 * @param counters The transform's collected counters.
 * @returns The report.
 */
export function transformReport(counters: TransformCounters): TransformReport {
  const {
    feature,
    rowKind,
    rows,
    matchCounts,
    candidates,
    rewritten,
    regionRemovals,
    featureWide
  } = counters;
  if (featureWide) {
    return {
      feature,
      featureWide: true,
      candidates,
      rewritten,
      regionRemovals,
      matchedRows: [],
      unmatchedRows: [],
      ...optionalCounts(counters)
    };
  }
  const matchedRows: ExclusionRowMatch[] = [];
  const unmatchedRows: string[] = [];
  rows.forEach((row, index) => {
    const matches = matchCounts[index] ?? 0;
    if (matches > 0) matchedRows.push({ row, rowKind, matches });
    else unmatchedRows.push(row);
  });
  return {
    feature,
    featureWide: false,
    candidates,
    rewritten,
    regionRemovals,
    matchedRows,
    unmatchedRows,
    ...optionalCounts(counters),
    ...rowCaveats(counters)
  };
}
