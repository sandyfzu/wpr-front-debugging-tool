/**
 * One RUCSS test run, driven from the DevTools panel, in the order that
 * keeps the page intact on every failure:
 *
 * 1. read the configuration once and compile every pattern — any invalid
 *    pattern stops the run before a request is sent;
 * 2. start on the tab: the service request (sent by the background for the
 *    page's own address), then the page's style snapshot — no page change;
 * 3. build the CSS and judge the stylesheet URLs with the user's patterns
 *    in a time-boxed worker — off every page thread;
 * 4. apply on the tab: inject the built CSS and, once the page took it,
 *    remove the styles not kept.
 *
 * Only plain data crosses contexts; compiled patterns stay where they run.
 * Every outcome is typed — the caller renders each as its own state.
 */
import type { Logger } from '../logger';
import { boundedAsk, type AskOutcome } from '../messaging/bounded-ask';
import {
  parseRucssApplyReply,
  parseRucssStartReply,
  type RucssApplyFailure,
  type RucssApplyReply,
  type RucssApplyRequest,
  type RucssApplySummary,
  type RucssStartFailure,
  type RucssStartReply,
  type RucssStartRequest
} from '../messaging/rucss-test';
import type { TabAsks } from '../messaging/tab-asks';
import type { RucssBuildInput } from './build';
import type { RucssBuildOutcome } from './build-client';
import type { RucssTesterConfig } from './config';
import { RUCSS_APPLY_DEADLINE_MS, RUCSS_START_DEADLINE_MS } from './deadlines';
import { prepareRucssRun, type ReplacementCount, type RucssPlanProblem } from './run-plan';

/** An ask that got no usable answer. */
export type RucssAskMiss = Exclude<AskOutcome<unknown>['kind'], 'reply'>;

/** How a run ended. */
export type RucssTestOutcome =
  /** The configuration could not be read (storage failed). */
  | { readonly kind: 'config-unreadable' }
  /** Patterns that do not compile; nothing was sent. */
  | { readonly kind: 'invalid-config'; readonly problems: readonly RucssPlanProblem[] }
  /**
   * The page did not answer usably (no content script, navigated, no answer
   * in time). After a `start` miss the page is untouched; after an `apply`
   * miss its state is unknown (a late apply may still land) — reload to be sure.
   */
  | {
      readonly kind: 'page-unreachable';
      readonly step: 'start' | 'apply';
      readonly miss: RucssAskMiss;
    }
  /** The start failed (request, refusal, snapshot); the page is untouched. */
  | { readonly kind: 'start-failed'; readonly failure: RucssStartFailure }
  /** The CSS could not be built; the page is untouched. */
  | {
      readonly kind: 'build-failed';
      readonly requestUrl: string;
      readonly failure: Extract<RucssBuildOutcome, { ok: false }>;
    }
  /** The page refused the apply; it is untouched. */
  | { readonly kind: 'apply-failed'; readonly failure: RucssApplyFailure }
  /** The test's CSS is on the page. */
  | {
      readonly kind: 'applied';
      readonly requestUrl: string;
      readonly summary: RucssApplySummary;
      readonly applied: readonly ReplacementCount[];
    };

/** What a run needs (the caller binds the tab; tests inject doubles). */
export interface RucssTestDeps {
  /** Read the stored configuration. */
  readonly readConfig: () => Promise<RucssTesterConfig>;
  readonly start: (request: RucssStartRequest) => Promise<AskOutcome<RucssStartReply>>;
  readonly build: (input: RucssBuildInput) => Promise<RucssBuildOutcome>;
  readonly apply: (request: RucssApplyRequest) => Promise<AskOutcome<RucssApplyReply>>;
  readonly log: Logger;
}

/**
 * Bind the two tab steps to one tab: bounded asks, answers guarded.
 *
 * @param asks The tab transport (direct or relayed).
 * @param tabId The inspected tab.
 */
export function rucssTabSteps(
  asks: TabAsks,
  tabId: number
): Pick<RucssTestDeps, 'start' | 'apply'> {
  return {
    start: (request) =>
      boundedAsk({
        send: () => asks.startRucssTest(tabId, request),
        parse: parseRucssStartReply,
        timeoutMs: RUCSS_START_DEADLINE_MS
      }),
    apply: (request) =>
      boundedAsk({
        send: () => asks.applyRucssTest(tabId, request),
        parse: parseRucssApplyReply,
        timeoutMs: RUCSS_APPLY_DEADLINE_MS
      })
  };
}

/**
 * Log an ask miss: a real send failure loudly, the expected ones quietly.
 *
 * @param log The logger.
 * @param step The step that missed.
 * @param outcome The miss.
 */
function logMiss(
  log: Logger,
  step: string,
  outcome: Exclude<AskOutcome<unknown>, { kind: 'reply' }>
): void {
  if (outcome.kind === 'failed') {
    log.warn(
      `RUCSS test ${step} failed`,
      outcome.cause instanceof Error ? outcome.cause.message : outcome.cause
    );
  } else {
    log.debug(`RUCSS test ${step} got no answer: ${outcome.kind}`);
  }
}

/**
 * Run one test.
 *
 * @param deps See {@link RucssTestDeps}.
 * @returns How the run ended (never rejects).
 */
export async function runRucssTest(deps: RucssTestDeps): Promise<RucssTestOutcome> {
  let config: RucssTesterConfig;
  try {
    config = await deps.readConfig();
  } catch (cause) {
    deps.log.warn(
      'RUCSS test: reading the configuration failed',
      cause instanceof Error ? cause.message : cause
    );
    return { kind: 'config-unreadable' };
  }
  const prepared = prepareRucssRun(config);
  if (!prepared.ok) return { kind: 'invalid-config', problems: prepared.problems };
  const { plan } = prepared;

  const started = await deps.start({
    safelist: plan.safelist,
    inlinePreserves: plan.inlinePreserves,
    mobile: plan.mobile,
    home: plan.home
  });
  if (started.kind !== 'reply') {
    logMiss(deps.log, 'start', started);
    return { kind: 'page-unreachable', step: 'start', miss: started.kind };
  }
  const start = started.reply;
  if (!start.ok) return { kind: 'start-failed', failure: start.failure };

  const built = await deps.build({ config, shakenCss: start.shakenCss, links: start.links });
  if (!built.ok) return { kind: 'build-failed', requestUrl: start.requestUrl, failure: built };

  const applied = await deps.apply({
    runId: start.runId,
    css: built.css,
    keepLinks: built.keepLinks
  });
  if (applied.kind !== 'reply') {
    logMiss(deps.log, 'apply', applied);
    return { kind: 'page-unreachable', step: 'apply', miss: applied.kind };
  }
  const apply = applied.reply;
  if (!apply.ok) return { kind: 'apply-failed', failure: apply.failure };
  return {
    kind: 'applied',
    requestUrl: start.requestUrl,
    summary: apply.summary,
    applied: built.applied
  };
}
