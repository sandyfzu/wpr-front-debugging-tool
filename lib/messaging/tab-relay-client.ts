/**
 * The asking side of the tab relay: the {@link TabAsks} a context without
 * the `tabs` API uses, each ask sent to the background as one
 * `relayTabAsk` request and its typed reply turned back into what the
 * direct transport would have produced — the answer, or a rejection the
 * shared no-receiver classifier sorts exactly as it sorts a direct miss.
 */
import type { TabAsks } from './tab-asks';
import { parseTabRelayReply, type TabRelayFailure, type TabRelayRequest } from './tab-relay';

/** One relay round trip (production: the runtime send of `relayTabAsk`). */
export type RelaySend = (request: TabRelayRequest) => Promise<unknown>;

/**
 * The failures that mean "nothing answered in the tab" — the direct
 * transport's no-receiver case (a closed tab included: a direct send to it
 * resolves empty and the transport folds that into "No response").
 */
const NO_RECEIVER_FAILURES: ReadonlySet<TabRelayFailure> = new Set(['no-receiver']);

/**
 * The rejection for a relay failure. A no-receiver-class failure carries
 * the transport's own "No response" wording, so `isNoReceiverError` routes
 * it to the same expected-miss branch as a direct send; every other
 * failure reads as a real one.
 *
 * @param failure The relay's typed failure.
 * @param ask The ask that failed, for the message.
 */
export function relayFailureError(failure: TabRelayFailure, ask: string): Error {
  return NO_RECEIVER_FAILURES.has(failure)
    ? new Error(`No response from the tab to the relayed ${ask} (${failure}).`)
    : new Error(`The background relay could not run ${ask} (${failure}).`);
}

/**
 * Send one request and unwrap its reply.
 *
 * @param send The relay round trip.
 * @param request The wire request.
 * @returns The content script's untrusted answer.
 * @throws {@link Error} for a failure reply or an unreadable one; a
 *   rejected round trip (no background listener) passes through untouched.
 */
async function relay(send: RelaySend, request: TabRelayRequest): Promise<unknown> {
  const reply = parseTabRelayReply(await send(request));
  if (reply === null) throw new Error(`The background relay answered ${request.ask} unreadably.`);
  if (!reply.ok) throw relayFailureError(reply.failure, request.ask);
  return reply.answer;
}

/**
 * A missing inspected tab: nothing to target, the expected no-receiver
 * case (the direct transport fails it the same way).
 *
 * @param ask The ask that had no target.
 */
function noTarget(ask: string): Promise<never> {
  return Promise.reject(new Error(`No response: no inspected tab to relay ${ask} to.`));
}

/**
 * Build the relayed asks.
 *
 * @param send The relay round trip (injected; production sends `relayTabAsk`).
 * @returns The asks, shaped exactly like the direct transport's.
 */
export function relayTabAsks(send: RelaySend): TabAsks {
  return {
    processPageData: (tabId) =>
      tabId === undefined
        ? noTarget('processPageData')
        : relay(send, { tabId, ask: 'processPageData' }),
    getFdtData: (tabId) =>
      tabId === undefined ? noTarget('getFdtData') : relay(send, { tabId, ask: 'getFdtData' }),
    getScriptSourceChunk: (tabId, request) =>
      relay(send, { tabId, ask: 'getScriptSourceChunk', payload: request })
  };
}
