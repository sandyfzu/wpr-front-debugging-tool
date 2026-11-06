/**
 * The LCP & Vitals page's panel-lifetime state: the LCP analysis (with its
 * session-only highlight choice) and the current-visit vitals read — kept
 * across route changes, so leaving the page mid-ask never loses the answer.
 *
 * Both are the panel's ask machine (`../ask-run`): the shown answer stays
 * while a newer ask is pending or after it failed, a throwing ask shows as a
 * failed page ask, and answers read stale once the page reloaded or
 * navigated. The vitals read (passive) runs on show when none is shown or
 * the shown one is stale.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { LcpAnalysisOutcome } from '../../../../lib/lcp-analysis/run-analysis';
import type { Logger } from '../../../../lib/logger';
import type { LcpAnalysisRequest } from '../../../../lib/messaging/lcp-analysis';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';
import { ASK_THREW, createAskRun, isPageUnreachable, type AskRun } from '../ask-run';

/** What the session runs against (production binds the inspected tab; tests inject doubles). */
export interface LcpVitalsSessionDeps {
  readonly analyse: (request: LcpAnalysisRequest) => Promise<LcpAnalysisOutcome>;
  readonly readVitals: () => Promise<CurrentVisitOutcome>;
  /** The inspected page's load identity: new on every reload or navigation; null without a payload. */
  readonly pageId: Accessor<string | null>;
  /** Whether `pageId` is current (no shell refetch in flight). */
  readonly pageSettled: Accessor<boolean>;
  readonly log: Logger;
}

/** The session. */
export interface LcpVitalsSession {
  /** Frame the LCP element on the page when analysing (off by default, never stored). */
  readonly highlight: Accessor<boolean>;
  readonly setHighlight: (on: boolean) => void;
  readonly analysis: AskRun<LcpAnalysisOutcome>;
  readonly vitals: AskRun<CurrentVisitOutcome>;
  /** Read the vitals unless a read for the current page is shown or one is on its way. */
  readonly ensureVitals: () => void;
  readonly dispose: () => void;
}

/**
 * Create the session (call inside a reactive root that outlives the page body).
 *
 * @param deps See {@link LcpVitalsSessionDeps}.
 */
export function createLcpVitalsSession(deps: LcpVitalsSessionDeps): LcpVitalsSession {
  const [highlight, setHighlight] = createSignal(false);
  const analysis = createAskRun<LcpAnalysisOutcome>({
    ask: () => deps.analyse({ highlight: highlight() }),
    threw: ASK_THREW,
    isFailure: isPageUnreachable,
    pageId: deps.pageId,
    pageSettled: deps.pageSettled,
    log: deps.log,
    label: 'LCP analysis'
  });
  const vitals = createAskRun<CurrentVisitOutcome>({
    ask: deps.readVitals,
    threw: ASK_THREW,
    isFailure: isPageUnreachable,
    pageId: deps.pageId,
    pageSettled: deps.pageSettled,
    log: deps.log,
    label: 'Current-visit vitals read'
  });
  return {
    highlight,
    setHighlight: (on) => setHighlight(on),
    analysis,
    vitals,
    ensureVitals: () => {
      const current = vitals.state();
      if (current.pending) return;
      // Same rule as the runtime read: reading is passive, so a stale read is refreshed on show.
      if (current.shown === null || vitals.stale()) void vitals.start();
    },
    dispose: () => {
      analysis.dispose();
      vitals.dispose();
    }
  };
}
