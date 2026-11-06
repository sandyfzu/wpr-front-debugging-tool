/**
 * One LCP analysis, driven from the DevTools panel: ask the inspected tab's
 * top frame for its LCP facts (bounded, validated on arrival) and compute
 * the breakdown of the page's LCP — the last candidate — from them.
 */
import type { Logger } from '../logger';
import { boundedAsk, logAskMiss, type AskMiss, type AskOutcome } from '../messaging/bounded-ask';
import {
  parseLcpAnalysisReply,
  type LcpAnalysisReply,
  type LcpAnalysisRequest,
  type LcpCandidateFacts,
  type LcpHighlight
} from '../messaging/lcp-analysis';
import type { TabAsks } from '../messaging/tab-asks';
import { domTiming } from '../../utils/dom-timing';
import { computeLcpBreakdown, type LcpBreakdown, type LcpBreakdownGap } from './breakdown';
import { LCP_ANALYSIS_ASK_DEADLINE_MS } from './deadlines';

/** How an analysis ended. */
export type LcpAnalysisOutcome =
  /** The page did not answer usably. */
  | { readonly kind: 'page-unreachable'; readonly miss: AskMiss }
  /** The browser reports no LCP entries. */
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'analysed';
      /** The page's LCP split into its four parts, or why it cannot be. */
      readonly breakdown: LcpBreakdown | LcpBreakdownGap;
      /** Every candidate, in order (the last is the page's LCP). */
      readonly candidates: readonly LcpCandidateFacts[];
      /**
       * The prerender activation offset (ms; 0 when not prerendered or
       * unknown): candidate times read from it, as the breakdown's do.
       */
      readonly activationStart: number;
      readonly highlight: LcpHighlight;
    };

/** What an analysis needs (the caller binds the tab; tests inject doubles). */
export interface LcpAnalysisDeps {
  readonly analyse: (request: LcpAnalysisRequest) => Promise<AskOutcome<LcpAnalysisReply>>;
  readonly log: Logger;
}

/**
 * Bind the analysis ask to one tab: bounded, answer guarded.
 *
 * @param asks The tab transport (direct or relayed; only this ask is used).
 * @param tabId The inspected tab.
 */
export function lcpTabStep(
  asks: Pick<TabAsks, 'runLcpAnalysis'>,
  tabId: number
): LcpAnalysisDeps['analyse'] {
  return (request) =>
    boundedAsk({
      send: () => asks.runLcpAnalysis(tabId, request),
      parse: parseLcpAnalysisReply,
      timeoutMs: LCP_ANALYSIS_ASK_DEADLINE_MS
    });
}

/**
 * The analysis of a validated answer.
 *
 * @param reply The page's measured facts.
 */
export function analysisOf(
  reply: Extract<LcpAnalysisReply, { kind: 'measured' }>
): Extract<LcpAnalysisOutcome, { kind: 'analysed' }> {
  const last = reply.candidates.at(-1);
  return {
    kind: 'analysed',
    breakdown: computeLcpBreakdown(
      reply.navigation,
      last === undefined ? null : { startTime: last.startTime, url: last.url },
      reply.resource === null ? [] : [reply.resource]
    ),
    candidates: reply.candidates,
    activationStart: domTiming(reply.navigation?.activationStart),
    highlight: reply.highlight
  };
}

/**
 * Run one analysis.
 *
 * @param request Whether to highlight the LCP element.
 * @param deps See {@link LcpAnalysisDeps}.
 * @returns How it ended (never rejects).
 */
export async function runLcpAnalysis(
  request: LcpAnalysisRequest,
  deps: LcpAnalysisDeps
): Promise<LcpAnalysisOutcome> {
  const outcome = await deps.analyse(request);
  if (outcome.kind !== 'reply') {
    logAskMiss(deps.log, 'LCP analysis', outcome);
    return { kind: 'page-unreachable', miss: outcome.kind };
  }
  return outcome.reply.kind === 'unsupported' ? outcome.reply : analysisOf(outcome.reply);
}
