/**
 * What the session means for the page on screen: the status alone cannot
 * say it — an active session's record may be another document's (a
 * navigation the session did not intercept), so the view joins the status
 * with the page-match verdict. Pure; the overlay renders one arm per kind.
 */
import type {
  ExclusionDocumentFailure,
  ExclusionServedDocument,
  ExclusionSessionStatus,
  InterceptionUnavailableCause
} from '../../../lib/messaging/exclusion-session';
import { INTERCEPTION_UNAVAILABLE_CAUSES } from '../../../lib/messaging/exclusion-session';
import {
  EXCLUSION_FEATURES,
  type ExclusionFeatureId,
  type ExclusionSet,
  type ExclusionSetRows
} from '../../../lib/exclusion-builder/set';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type {
  DeferSimulationReport,
  DelaySimulationReport,
  DocumentSimulationReport,
  LazyloadSimulationReport
} from '../../../lib/messaging/exclusion-simulation';
import type {
  SimulationRuntimeUnavailableCause,
  SimulationStage
} from '../../../lib/wp-rocket-simulation/spec';
import type { PageFacts, PageMatch } from './page-match';

/**
 * - `off` — nothing applied in this tab.
 * - `unavailable` — interception cannot run (the kept warning).
 * - `armed` — applied; no document intercepted yet.
 * - `unrecorded` — applied, and this page loaded after the apply, yet the
 *   session never recorded it within its record wait (see
 *   {@link awaitsRecord}): the page passed the session without a result —
 *   the user gets a way on (Reload, Stop, Re-apply), never an endless wait.
 * - `applied` — this page was rewritten; `unmatched` counts rows that
 *   matched nothing (the no-match warnings); `warnings` names the applied
 *   rows WP Rocket applies as-is that change the whole feature on the page;
 *   `simulation` is the Delay JS simulation step's report,
 *   `deferSimulation` the Defer JS one's and `lazyloadSimulation` the
 *   LazyLoad one's, each when the session simulates it.
 * - `unmodified` — this page was intercepted but served unmodified.
 * - `not-intercepted` — the session is on, but this page is not the one it
 *   rewrote.
 * - `cant-tell` — the session is on; whether this page was rewritten
 *   cannot be verified.
 */
export type SessionView =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'unavailable';
      readonly cause: InterceptionUnavailableCause;
      readonly retryable: boolean;
    }
  | { readonly kind: 'armed' }
  | { readonly kind: 'unrecorded' }
  | {
      readonly kind: 'applied';
      readonly reports: readonly TransformReport[];
      readonly unmatched: number;
      readonly warnings: readonly AppliedWarning[];
      readonly served: ExclusionServedDocument | undefined;
      readonly simulation?: DelaySimulationReport;
      readonly deferSimulation?: DeferSimulationReport;
      readonly lazyloadSimulation?: LazyloadSimulationReport;
    }
  | {
      readonly kind: 'unmodified';
      readonly reason: UnmodifiedReason;
      readonly served: ExclusionServedDocument | undefined;
    }
  | { readonly kind: 'not-intercepted' }
  | { readonly kind: 'cant-tell' };

/** Why an intercepted page was served unmodified. */
export type UnmodifiedReason =
  | { readonly kind: 'failed'; readonly reason: ExclusionDocumentFailure }
  | {
      readonly kind: 'over-budget';
      readonly feature: ExclusionFeatureId;
      readonly row: string | null;
      readonly budgetMs: number;
      /** `simulate`: the feature's simulation step overran (then no row). */
      readonly stage?: SimulationStage;
      /**
       * The session simulates (present only then): its simulation step's
       * time counts toward the same cumulative budget a row is billed for.
       */
      readonly simulating?: true;
    }
  | { readonly kind: 'runtime-unavailable'; readonly cause: SimulationRuntimeUnavailableCause };

/**
 * An applied warning, for the page-wide announcement: the rows behind a
 * page-off (`page-off`), or the rows matching every candidate (`match-all`),
 * by their 1-based position in the applied set's lane.
 */
export interface AppliedWarning {
  readonly lane: keyof ExclusionSetRows;
  readonly kind: 'page-off' | 'match-all';
  /** Positions in the applied lane (empty when the report names no row). */
  readonly positions: readonly number[];
}

/**
 * The applied warnings of a rewritten page, in pipeline order.
 *
 * @param reports The page's reports.
 * @param set The applied set (positions are read from it).
 */
export function appliedWarnings(
  reports: readonly TransformReport[],
  set: ExclusionSet
): AppliedWarning[] {
  return reports.flatMap((report): AppliedWarning[] => {
    const lane = EXCLUSION_FEATURES.find(({ id }) => id === report.feature)?.rowsKey;
    if (lane === undefined) return [];
    const positions = (rows: readonly string[]): number[] =>
      rows.map((row) => set.rows[lane].indexOf(row) + 1).filter((position) => position > 0);
    if (report.pageState === 'off') {
      return [{ lane, kind: 'page-off', positions: positions(report.pageOffRows ?? []) }];
    }
    const matchAll = positions(report.matchAllRows ?? []);
    return matchAll.length === 0 ? [] : [{ lane, kind: 'match-all', positions: matchAll }];
  });
}

/** Rows that matched nothing, summed over the reports. */
function unmatchedRows(reports: readonly TransformReport[]): number {
  return reports.reduce((sum, report) => sum + report.unmatchedRows.length, 0);
}

/**
 * Whether this page's own record is due from the session: an active
 * session with no document recorded, and a page whose navigation started
 * after the apply (its navigation start anchored at `document_start`, not
 * a back/forward-cache restore) — so the session intercepted, or should
 * have intercepted, this very load. A page that loaded before the apply
 * waits for the user's reload instead (`armed`, no wait).
 *
 * @param status The tab's session status.
 * @param page This page's facts.
 */
export function awaitsRecord(status: ExclusionSessionStatus, page: PageFacts): boolean {
  return (
    status.state === 'active' &&
    status.document === null &&
    page.anchoredAtStart === true &&
    page.restored !== true &&
    page.navigationStart > status.startedAt
  );
}

/**
 * The page's session view.
 *
 * @param status The tab's session status.
 * @param match Compares a recorded identity with this page (see `./page-match`).
 * @param recordOverdue This page's record wait passed without a record
 *   (only ever true for a page {@link awaitsRecord} held due).
 */
export function sessionView(
  status: ExclusionSessionStatus,
  match: (served: ExclusionServedDocument | undefined) => PageMatch,
  recordOverdue = false
): SessionView {
  if (status.state === 'inactive') return { kind: 'off' };
  if (status.state === 'unavailable') {
    return {
      kind: 'unavailable',
      cause: status.cause,
      retryable: INTERCEPTION_UNAVAILABLE_CAUSES[status.cause].retryable
    };
  }
  const document = status.document;
  if (document === null) return recordOverdue ? { kind: 'unrecorded' } : { kind: 'armed' };
  const verdict = match(document.served);
  if (verdict === 'other-page') return { kind: 'not-intercepted' };
  if (verdict === 'cant-tell') return { kind: 'cant-tell' };
  switch (document.outcome) {
    case 'rewritten':
      return {
        kind: 'applied',
        reports: document.reports,
        unmatched: unmatchedRows(document.reports),
        warnings: appliedWarnings(document.reports, status.set),
        served: document.served,
        ...(document.simulation === undefined ? {} : { simulation: document.simulation }),
        ...(document.deferSimulation === undefined
          ? {}
          : { deferSimulation: document.deferSimulation }),
        ...(document.lazyloadSimulation === undefined
          ? {}
          : { lazyloadSimulation: document.lazyloadSimulation })
      };
    case 'over-budget':
      return {
        kind: 'unmodified',
        reason: {
          kind: 'over-budget',
          feature: document.feature,
          row: document.row,
          budgetMs: document.budgetMs,
          ...(document.stage === undefined ? {} : { stage: document.stage }),
          ...(status.simulate === undefined ? {} : { simulating: true as const })
        },
        served: document.served
      };
    case 'failed':
      return {
        kind: 'unmodified',
        reason: { kind: 'failed', reason: document.reason },
        served: document.served
      };
    case 'runtime-unavailable':
      return {
        kind: 'unmodified',
        reason: { kind: 'runtime-unavailable', cause: document.cause },
        served: document.served
      };
  }
}

/**
 * An applied view's simulation reports in WP Rocket's buffer order
 * (LazyLoad, Defer JS, then Delay JS), each present only when the session
 * simulates it.
 *
 * @param view The applied view.
 */
export function simulationReports(
  view: Pick<
    Extract<SessionView, { kind: 'applied' }>,
    'simulation' | 'deferSimulation' | 'lazyloadSimulation'
  >
): DocumentSimulationReport[] {
  return [view.lazyloadSimulation, view.deferSimulation, view.simulation].filter(
    (report): report is DocumentSimulationReport => report !== undefined
  );
}
