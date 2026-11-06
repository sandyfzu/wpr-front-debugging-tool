/**
 * The LCP & Vitals page's panel-lifetime state: the LCP analysis (with its
 * session-only highlight choice) and the current-visit vitals read — kept
 * across route changes, so leaving the page mid-ask never loses the answer.
 *
 * Both are the same small machine (`createAskRun`):
 * `idle` → `pending` → `shown{outcome, page}`; asking again keeps the shown
 * answer on screen while pending (a refresh never blanks the view). An ask
 * that throws is logged and shown as a failed ask. Answers belong to the page
 * load they measured: once it reloads or navigates (a new payload identity)
 * they read as stale.
 */
import { batch, createMemo, createSignal, type Accessor } from 'solid-js';
import type { LcpAnalysisOutcome } from '../../../../lib/lcp-analysis/run-analysis';
import type { Logger } from '../../../../lib/logger';
import type { LcpAnalysisRequest } from '../../../../lib/messaging/lcp-analysis';
import type { CurrentVisitOutcome } from '../../../../lib/web-vitals/read-current-visit';

/** An answer on screen. */
export interface ShownAnswer<O> {
  readonly outcome: O;
  /** The page load it measured (payload identity; null when unknown). */
  readonly page: string | null;
  /** Names this answer (a newer one gets a higher number). */
  readonly sequence: number;
}

/** One ask's state. */
export interface AskRunState<O> {
  /** An ask is on its way. */
  readonly pending: boolean;
  /** The latest answer, kept while a newer ask is pending; null before the first. */
  readonly shown: ShownAnswer<O> | null;
}

/** One ask's machine. */
export interface AskRun<O> {
  readonly state: Accessor<AskRunState<O>>;
  /** The shown answer measured an earlier page load. */
  readonly stale: Accessor<boolean>;
  /** Ask (ignored while one is pending). */
  readonly start: () => Promise<void>;
  /** Stop recording answers (the session's owner is gone). */
  readonly dispose: () => void;
}

/** The outcome an ask that threw is shown as. */
export const ASK_THREW = { kind: 'page-unreachable', miss: 'failed' } as const;

/** What an ask machine needs. */
export interface AskRunDeps<O> {
  /** The ask (expected to never reject; a rejection is logged and shown as {@link ASK_THREW}). */
  readonly ask: () => Promise<O>;
  readonly threw: O;
  readonly pageId: Accessor<string | null>;
  readonly log: Logger;
  /** Names the ask in the log. */
  readonly label: string;
}

/**
 * Create one ask machine (call inside a reactive root).
 *
 * @param deps See {@link AskRunDeps}.
 */
export function createAskRun<O>(deps: AskRunDeps<O>): AskRun<O> {
  const [pending, setPending] = createSignal(false);
  const [shown, setShown] = createSignal<ShownAnswer<O> | null>(null);
  let sequence = 0;
  let disposed = false;

  const state = createMemo((): AskRunState<O> => ({ pending: pending(), shown: shown() }));
  const stale = createMemo((): boolean => {
    const answer = shown();
    const page = deps.pageId();
    // An unknown page on either side cannot prove a reload.
    return answer !== null && answer.page !== null && page !== null && page !== answer.page;
  });

  /** Ask (never rejects). */
  const start = async (): Promise<void> => {
    if (pending()) return;
    const page = deps.pageId();
    setPending(true);
    let outcome: O;
    try {
      outcome = await deps.ask();
    } catch (cause) {
      deps.log.error(
        `${deps.label}: the ask threw`,
        cause instanceof Error ? cause.message : cause
      );
      outcome = deps.threw;
    }
    if (disposed) return;
    sequence += 1;
    const answer: ShownAnswer<O> = { outcome, page, sequence };
    batch(() => {
      setShown(answer);
      setPending(false);
    });
  };

  return {
    state,
    stale,
    start,
    dispose: () => {
      disposed = true;
    }
  };
}

/** What the session runs against (production binds the inspected tab; tests inject doubles). */
export interface LcpVitalsSessionDeps {
  readonly analyse: (request: LcpAnalysisRequest) => Promise<LcpAnalysisOutcome>;
  readonly readVitals: () => Promise<CurrentVisitOutcome>;
  /** The inspected page's load identity: new on every reload or navigation; null without a payload. */
  readonly pageId: Accessor<string | null>;
  readonly log: Logger;
}

/** The session. */
export interface LcpVitalsSession {
  /** Frame the LCP element on the page when analysing (off by default, never stored). */
  readonly highlight: Accessor<boolean>;
  readonly setHighlight: (on: boolean) => void;
  readonly analysis: AskRun<LcpAnalysisOutcome>;
  readonly vitals: AskRun<CurrentVisitOutcome>;
  /** Read the vitals unless they were read (or are being read) already. */
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
    pageId: deps.pageId,
    log: deps.log,
    label: 'LCP analysis'
  });
  const vitals = createAskRun<CurrentVisitOutcome>({
    ask: deps.readVitals,
    threw: ASK_THREW,
    pageId: deps.pageId,
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
      if (current.shown === null && !current.pending) void vitals.start();
    },
    dispose: () => {
      analysis.dispose();
      vitals.dispose();
    }
  };
}
