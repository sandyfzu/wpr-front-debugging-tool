/**
 * One current-visit vitals read, driven from the DevTools panel: ask the
 * inspected tab's top frame for this visit's entries (bounded, validated on
 * arrival) and reduce them. One visit's values — never field data.
 */
import type { Logger } from '../logger';
import { boundedAsk, logAskMiss, type AskMiss, type AskOutcome } from '../messaging/bounded-ask';
import {
  parseCurrentVisitVitalsReply,
  type CurrentVisitVitalsReply
} from '../messaging/current-visit-vitals';
import type { TabAsks } from '../messaging/tab-asks';
import { reduceCurrentVisit, type CurrentVisitVitals } from './current-visit';

/** The panel's wait (ms) on a read: a synchronous read plus the hops. */
export const CURRENT_VISIT_ASK_DEADLINE_MS = 5_000;

/** How a read ended. */
export type CurrentVisitOutcome =
  /** The page did not answer usably. */
  | { readonly kind: 'page-unreachable'; readonly miss: AskMiss }
  | {
      readonly kind: 'read';
      readonly vitals: CurrentVisitVitals;
      /** A collection bound was reached: later entries were not counted. */
      readonly capped: boolean;
    };

/** What a read needs (the caller binds the tab; tests inject doubles). */
export interface CurrentVisitDeps {
  readonly read: () => Promise<AskOutcome<CurrentVisitVitalsReply>>;
  readonly log: Logger;
}

/**
 * Bind the read ask to one tab: bounded, answer guarded.
 *
 * @param asks The tab transport (direct or relayed; only this ask is used).
 * @param tabId The inspected tab.
 */
export function currentVisitTabStep(
  asks: Pick<TabAsks, 'getCurrentVisitVitals'>,
  tabId: number
): CurrentVisitDeps['read'] {
  return () =>
    boundedAsk({
      send: () => asks.getCurrentVisitVitals(tabId),
      parse: parseCurrentVisitVitalsReply,
      timeoutMs: CURRENT_VISIT_ASK_DEADLINE_MS
    });
}

/**
 * Read and reduce this visit's vitals.
 *
 * @param deps See {@link CurrentVisitDeps}.
 * @returns How the read ended (never rejects).
 */
export async function readCurrentVisitVitals(deps: CurrentVisitDeps): Promise<CurrentVisitOutcome> {
  const outcome = await deps.read();
  if (outcome.kind !== 'reply') {
    logAskMiss(deps.log, 'Current-visit vitals read', outcome);
    return { kind: 'page-unreachable', miss: outcome.kind };
  }
  return {
    kind: 'read',
    vitals: reduceCurrentVisit(outcome.reply.input),
    capped: outcome.reply.capped
  };
}
