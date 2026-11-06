/**
 * One beacon test, driven from the DevTools panel: check the form's draft
 * (every issue at once — the "at least one feature" reason included), then
 * ask the inspected tab's top frame to run it, bounded by
 * {@link BEACON_TEST_ASK_DEADLINE_MS}. The page's answer is validated on
 * arrival (results included); every outcome is typed, and the caller
 * renders each as its own state. Nothing is sent for an invalid draft.
 */
import type { Logger } from '../logger';
import { boundedAsk, logAskMiss, type AskMiss, type AskOutcome } from '../messaging/bounded-ask';
import {
  parseBeaconTestReply,
  type BeaconTestAnswer,
  type BeaconTestRequest
} from '../messaging/beacon-test';
import type { TabAsks } from '../messaging/tab-asks';
import {
  checkBeaconDraft,
  type BeaconConfigIssue,
  type BeaconTestDraft,
  type SelectorValidity
} from './config';
import { BEACON_TEST_ASK_DEADLINE_MS } from './deadlines';

/** How a test ended. */
export type BeaconTestOutcome =
  /** The draft cannot run; nothing was sent. */
  | { readonly kind: 'invalid-config'; readonly issues: readonly BeaconConfigIssue[] }
  /** The page did not answer usably (no content script, navigated, no answer in time). */
  | { readonly kind: 'page-unreachable'; readonly miss: AskMiss }
  /** The page's answer (see {@link BeaconTestAnswer}). */
  | BeaconTestAnswer;

/** What a test needs (the caller binds the tab; tests inject doubles). */
export interface BeaconTestDeps {
  /** The selector parser check (the panel's own document). */
  readonly isValidSelector: SelectorValidity;
  /** Ask the tab to run the test. */
  readonly run: (request: BeaconTestRequest) => Promise<AskOutcome<BeaconTestAnswer>>;
  readonly log: Logger;
}

/**
 * Bind the run ask to one tab: bounded, answer guarded.
 *
 * @param asks The tab transport (direct or relayed; only this ask is used).
 * @param tabId The inspected tab.
 */
export function beaconTabStep(
  asks: Pick<TabAsks, 'runBeaconTest'>,
  tabId: number
): BeaconTestDeps['run'] {
  return (request) =>
    boundedAsk({
      send: () => asks.runBeaconTest(tabId, request),
      parse: parseBeaconTestReply,
      timeoutMs: BEACON_TEST_ASK_DEADLINE_MS
    });
}

/**
 * Run one test.
 *
 * @param draft The form's values.
 * @param deps See {@link BeaconTestDeps}.
 * @returns How the test ended (never rejects).
 */
export async function runBeaconTest(
  draft: BeaconTestDraft,
  deps: BeaconTestDeps
): Promise<BeaconTestOutcome> {
  const check = checkBeaconDraft(draft, deps.isValidSelector);
  if (!check.ok) return { kind: 'invalid-config', issues: check.issues };
  const outcome = await deps.run({ config: check.config });
  if (outcome.kind === 'reply') return outcome.reply;
  logAskMiss(deps.log, 'Beacon test', outcome);
  return { kind: 'page-unreachable', miss: outcome.kind };
}
