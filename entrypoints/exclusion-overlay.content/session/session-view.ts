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
import type { ExclusionFeatureId } from '../../../lib/exclusion-builder/set';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type { PageMatch } from './page-match';

/**
 * - `off` — nothing applied in this tab.
 * - `unavailable` — interception cannot run (the kept warning).
 * - `armed` — applied; no document intercepted yet.
 * - `applied` — this page was rewritten; `unmatched` counts rows that
 *   matched nothing (the no-match warnings).
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
  | {
      readonly kind: 'applied';
      readonly reports: readonly TransformReport[];
      readonly unmatched: number;
      readonly served: ExclusionServedDocument | undefined;
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
    };

/** Rows that matched nothing, summed over the reports. */
function unmatchedRows(reports: readonly TransformReport[]): number {
  return reports.reduce((sum, report) => sum + report.unmatchedRows.length, 0);
}

/**
 * The page's session view.
 *
 * @param status The tab's session status.
 * @param match Compares a recorded identity with this page (see `./page-match`).
 */
export function sessionView(
  status: ExclusionSessionStatus,
  match: (served: ExclusionServedDocument | undefined) => PageMatch
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
  if (document === null) return { kind: 'armed' };
  const verdict = match(document.served);
  if (verdict === 'other-page') return { kind: 'not-intercepted' };
  if (verdict === 'cant-tell') return { kind: 'cant-tell' };
  switch (document.outcome) {
    case 'rewritten':
      return {
        kind: 'applied',
        reports: document.reports,
        unmatched: unmatchedRows(document.reports),
        served: document.served
      };
    case 'over-budget':
      return {
        kind: 'unmodified',
        reason: {
          kind: 'over-budget',
          feature: document.feature,
          row: document.row,
          budgetMs: document.budgetMs
        },
        served: document.served
      };
    case 'failed':
      return {
        kind: 'unmodified',
        reason: { kind: 'failed', reason: document.reason },
        served: document.served
      };
  }
}
