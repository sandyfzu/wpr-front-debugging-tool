/**
 * Firefox only — the RUCSS Tester's data-consent wiring: before a run sends
 * the page address, ask the background (the panel has no `permissions`
 * API in Firefox; the background checks the grant and opens the consent
 * page when it is missing), and follow the consent page's answers so a
 * waiting run carries on. Chromium has no data consent: its build never
 * imports this module.
 */
import type { Logger } from '../../../../lib/logger';
import { onMessage, sendMessage } from '../../../../lib/messaging';
import { boundedAsk, logAskMiss, type AskOutcome } from '../../../../lib/messaging/bounded-ask';
import {
  DATA_CONSENT_ASK_DEADLINE_MS,
  parseDataConsentAnswer,
  parseDataConsentReply,
  type DataConsentAnswer,
  type DataConsentReply
} from '../../../../lib/messaging/data-consent';
import type { RucssConsentGate } from '../../../../lib/rucss-tester/run-test';

/** What the gate runs against (production: the extension messenger). */
export interface RucssConsentDeps {
  /** Ask the background for the inspected tab. */
  readonly ask: (tabId: number) => Promise<unknown>;
  readonly log: Logger;
}

/**
 * The run's consent gate for one tab. Never rejects: no answer, a junk one
 * or a refusal reads `ask-failed` (nothing is sent on anything but `granted`).
 *
 * @param tabId The inspected tab (the consent page opens next to it).
 * @param deps See {@link RucssConsentDeps}.
 */
export async function askRucssConsent(
  tabId: number,
  deps: RucssConsentDeps
): Promise<RucssConsentGate> {
  const outcome: AskOutcome<DataConsentReply> = await boundedAsk({
    send: () => deps.ask(tabId),
    parse: parseDataConsentReply,
    timeoutMs: DATA_CONSENT_ASK_DEADLINE_MS
  });
  if (outcome.kind !== 'reply') {
    logAskMiss(deps.log, 'RUCSS data-consent ask', outcome);
    return 'ask-failed';
  }
  const { status } = outcome.reply;
  // `missing` answers a check-only ask, never this one: read as a failed ask.
  return status === 'granted' || status === 'asking' ? status : 'ask-failed';
}

/**
 * The answer a RUCSS run waiting on the consent acts on: only one given for
 * the RUCSS Tester's own ask. Another tool's grant restarts nothing (the
 * RUCSS consent tab, if open, then settles itself and sends its own).
 *
 * @param data The push, untrusted.
 * @returns The grant (`true`/`false`), or null when the push is not for this tool.
 */
export function rucssConsentAnswer(data: unknown): boolean | null {
  const answer: DataConsentAnswer | null = parseDataConsentAnswer(data);
  return answer?.feature === 'rucss' ? answer.granted : null;
}

/**
 * The production gate for one tab: the ask over the extension messenger.
 *
 * @param tabId The inspected tab.
 * @param log Where a missed ask is reported.
 */
export function realRucssConsentGate(tabId: number, log: Logger): () => Promise<RucssConsentGate> {
  return () =>
    askRucssConsent(tabId, {
      ask: (id) => sendMessage('askDataConsent', { feature: 'rucss', tabId: id }),
      log
    });
}

/**
 * Follow the consent page's answers (one listener per panel: the session
 * is panel-lifetime).
 *
 * @param onAnswer Called with each answer for this tool.
 * @param log Where a throwing consumer is reported (the listener stays up).
 * @returns The unsubscribe.
 */
export function watchRucssConsentAnswers(
  onAnswer: (granted: boolean) => void,
  log: Logger
): () => void {
  return onMessage('dataConsentAnswered', ({ data }): true => {
    const granted = rucssConsentAnswer(data);
    try {
      if (granted !== null) onAnswer(granted);
    } catch (cause) {
      log.error('RUCSS tester: acting on the consent answer threw', cause);
    }
    return true;
  });
}
