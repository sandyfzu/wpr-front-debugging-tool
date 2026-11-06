/**
 * The asking side of the tab relay: the {@link TabAsks} a context without
 * the `tabs` API uses, each ask sent to the background as one
 * `relayTabAsk` request and its typed reply turned back into what the
 * direct transport would have produced — the answer, or a rejection the
 * shared no-receiver classifier sorts exactly as it sorts a direct miss.
 * A failure of the relay itself (not of the page) rejects with the named
 * {@link RelayUnavailableError}, so no caller blames the page for it.
 */
import type { TabAsks } from './tab-asks';
import { parseTabRelayReply, type TabRelayFailure, type TabRelayRequest } from './tab-relay';

/** One relay round trip (production: the runtime send of `relayTabAsk`). */
export type RelaySend = (request: TabRelayRequest) => Promise<unknown>;

/**
 * Why the relay itself could not carry an ask — none of them the page's
 * doing, and none a retry changes:
 * - `refused` / `invalid-request` — the background turned this context's
 *   request down (both ends ship in one build, so this is a defect),
 * - `unreadable-reply` — the background's answer broke the reply contract,
 * - `unreachable` — the round trip itself failed (no relay listener in the
 *   background, e.g. its relay failed to start).
 */
export type RelayUnavailableReason =
  Extract<TabRelayFailure, 'refused' | 'invalid-request'> | 'unreadable-reply' | 'unreachable';

/**
 * The relay — not the page — could not carry an ask. Its message never
 * matches the no-receiver patterns (an underlying transport error rides as
 * `cause` only), so no caller files it as an expected page miss.
 */
export class RelayUnavailableError extends Error {
  override readonly name = 'RelayUnavailableError';

  /**
   * @param reason Why the relay could not carry the ask.
   * @param ask The ask that failed, for the message.
   * @param options The underlying failure, when there is one.
   */
  constructor(
    readonly reason: RelayUnavailableReason,
    ask: string,
    options?: ErrorOptions
  ) {
    super(`The background relay is unavailable for ${ask} (${reason}).`, options);
  }
}

/**
 * Whether a caught ask failure is the relay's own (see {@link RelayUnavailableError}).
 *
 * @param cause Any caught value.
 */
export function isRelayUnavailableError(cause: unknown): cause is RelayUnavailableError {
  return cause instanceof RelayUnavailableError;
}

/**
 * The rejection for a relay failure:
 * - `no-receiver` (a closed tab included) carries the transport's own
 *   "No response" wording, so `isNoReceiverError` routes it to the same
 *   expected-miss branch as a direct send;
 * - `refused` / `invalid-request` are the relay's own {@link RelayUnavailableError};
 * - `failed` (the forward broke on the way to the page) is a real failure.
 *
 * @param failure The relay's typed failure.
 * @param ask The ask that failed, for the message.
 */
export function relayFailureError(failure: TabRelayFailure, ask: string): Error {
  switch (failure) {
    case 'no-receiver':
      return new Error(`No response from the tab to the relayed ${ask} (${failure}).`);
    case 'refused':
    case 'invalid-request':
      return new RelayUnavailableError(failure, ask);
    case 'failed':
      return new Error(`The background relay could not run ${ask} (${failure}).`);
  }
}

/**
 * Send one request and unwrap its reply.
 *
 * @param send The relay round trip.
 * @param request The wire request.
 * @returns The content script's untrusted answer.
 * @throws {@link RelayUnavailableError} for a rejected round trip or an
 *   unreadable reply; {@link relayFailureError}'s error for a failure reply.
 */
async function relay(send: RelaySend, request: TabRelayRequest): Promise<unknown> {
  let raw: unknown;
  try {
    raw = await send(request);
  } catch (cause) {
    // The background never rejects a relay request (every failure is a
    // typed reply), so a rejected round trip means the relay is not there.
    throw new RelayUnavailableError('unreachable', request.ask, { cause });
  }
  const reply = parseTabRelayReply(raw);
  if (reply === null) throw new RelayUnavailableError('unreadable-reply', request.ask);
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
      relay(send, { tabId, ask: 'getScriptSourceChunk', payload: request }),
    startRucssTest: (tabId, request) =>
      relay(send, { tabId, ask: 'startRucssTest', payload: request }),
    applyRucssTest: (tabId, request) =>
      relay(send, { tabId, ask: 'applyRucssTest', payload: request }),
    runBeaconTest: (tabId, request) =>
      relay(send, { tabId, ask: 'runBeaconTest', payload: request }),
    runLcpAnalysis: (tabId, request) =>
      relay(send, { tabId, ask: 'runLcpAnalysis', payload: request }),
    getScriptRuntimeStatuses: (tabId) => relay(send, { tabId, ask: 'getScriptRuntimeStatuses' }),
    getCurrentVisitVitals: (tabId) => relay(send, { tabId, ask: 'getCurrentVisitVitals' })
  };
}
