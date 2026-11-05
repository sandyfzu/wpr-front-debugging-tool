/**
 * The background's RUCSS service requests (`fetchRucssShakenCss`): the only
 * place a request to the service is sent, and only when a page asks — the
 * user started a test; nothing here runs on its own.
 *
 * - No open proxy: the request address is the fixed service endpoint
 *   (`lib/rucss-tester/endpoint`); the page address it carries must be an
 *   http(s) page on the asking top frame's own origin.
 * - What leaves: the page address (fragment and credentials dropped), the
 *   mobile/home flags and the safelist entries — never page content.
 * - Bounded: one time budget over the request and the capped body read;
 *   the timeout and a cancel stay distinct outcomes (`AbortSignal.any` of
 *   the timeout signal and the cancel signal — the request rejects with the
 *   reason of whichever fired). A newer request from the same tab, or the
 *   tab closing, cancels the older one.
 * - Logs never carry the page or request address, nor the answer.
 */
import { createLogger, type Logger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import {
  parseRucssFetchRequest,
  RUCSS_TEST_LIMITS,
  type RucssFetchReply,
  type RucssFetchRequest
} from '../../lib/messaging/rucss-test';
import { resolveTopFrameSender, type LooseMessageSender } from '../../lib/messaging/sender';
import { RUCSS_FETCH_TIMEOUT_MS } from '../../lib/rucss-tester/deadlines';
import {
  buildRucssEndpointUrl,
  buildRucssRequestInit,
  toUnixSeconds
} from '../../lib/rucss-tester/endpoint';
import {
  parseRucssResponse,
  RUCSS_RESPONSE_MAX_BYTES,
  rucssTransportFailure,
  type RucssFetchOutcome
} from '../../lib/rucss-tester/response';
import { readCappedText } from '../../utils/read-capped-text';
import { parseHttpUrl } from '../../utils/urls';

const log = createLogger('rucss-fetch');

/** What the requests run against (tests inject doubles). */
export interface RucssFetchDeps {
  readonly fetch: typeof fetch;
  /** The current time (epoch ms) — the request's unique seconds. */
  readonly now: () => number;
  /** Builds the time budget's signal (production: `AbortSignal.timeout`). */
  readonly timeoutSignal: (ms: number) => AbortSignal;
  readonly log: Logger;
}

/**
 * Send one request and judge the answer. Never rejects.
 *
 * @param requestUrl The built request address.
 * @param safelist The safelist entries (the body).
 * @param cancel Aborted (without a reason) to cancel the request.
 * @param deps See {@link RucssFetchDeps}.
 * @returns The service's CSS, or the typed failure.
 */
export async function sendRucssRequest(
  requestUrl: string,
  safelist: readonly string[],
  cancel: AbortSignal,
  deps: RucssFetchDeps
): Promise<RucssFetchOutcome> {
  const signal = AbortSignal.any([cancel, deps.timeoutSignal(RUCSS_FETCH_TIMEOUT_MS)]);
  try {
    const response = await deps.fetch(requestUrl, {
      ...buildRucssRequestInit(safelist),
      // Nothing of the user's session rides along to the third-party service.
      credentials: 'omit',
      cache: 'no-store',
      signal
    });
    return parseRucssResponse(
      response.status,
      await readCappedText(response, RUCSS_RESPONSE_MAX_BYTES)
    );
  } catch (cause) {
    // The request, or the body read under the same signal, rejected.
    return rucssTransportFailure(cause);
  }
}

/**
 * The request address for a sender's request, or null when the page address
 * is not an http(s) page on the sender's own origin, or when the built
 * address passes {@link RUCSS_TEST_LIMITS}' `requestUrlChars` (only a page
 * address that grows when normalized can: the reply carrying it would be
 * refused, so nothing is sent).
 *
 * @param request The validated request.
 * @param senderOrigin The asking top frame's origin.
 * @param now The current time (epoch ms).
 */
export function rucssRequestUrlFor(
  request: RucssFetchRequest,
  senderOrigin: string,
  now: number
): string | null {
  if (parseHttpUrl(request.pageUrl)?.origin !== senderOrigin) return null;
  const requestUrl = buildRucssEndpointUrl({
    pageUrl: request.pageUrl,
    unixSeconds: toUnixSeconds(now),
    mobile: request.mobile,
    home: request.home
  });
  return requestUrl.length <= RUCSS_TEST_LIMITS.requestUrlChars ? requestUrl : null;
}

/** The per-tab in-flight requests (one at most per tab). */
export interface RucssInflight {
  /**
   * Begin a tab's request, cancelling its previous one.
   *
   * @returns The new request's cancel signal and its release (call once it settled).
   */
  begin(tabId: number): { readonly signal: AbortSignal; readonly release: () => void };
  /** Cancel a tab's request (e.g. the tab closed). */
  cancel(tabId: number): void;
}

/** Create the per-tab in-flight registry. */
export function createRucssInflight(): RucssInflight {
  const controllers = new Map<number, AbortController>();
  return {
    begin(tabId) {
      // A plain abort (no reason) reads as `cancelled`, never as `timeout`.
      controllers.get(tabId)?.abort();
      const controller = new AbortController();
      controllers.set(tabId, controller);
      return {
        signal: controller.signal,
        release: () => {
          if (controllers.get(tabId) === controller) controllers.delete(tabId);
        }
      };
    },
    cancel(tabId) {
      controllers.get(tabId)?.abort();
      controllers.delete(tabId);
    }
  };
}

/**
 * Answer one request. Never rejects: a refused sender or request answers
 * `refused` with nothing sent.
 *
 * @param sender The runtime sender, untrusted.
 * @param data The request, untrusted.
 * @param inflight The per-tab in-flight registry.
 * @param deps See {@link RucssFetchDeps}.
 */
export async function answerRucssFetch(
  sender: LooseMessageSender | undefined,
  data: unknown,
  inflight: RucssInflight,
  deps: RucssFetchDeps
): Promise<RucssFetchReply> {
  const page = resolveTopFrameSender(sender);
  const request = parseRucssFetchRequest(data);
  const requestUrl =
    page === null || request === null ? null : rucssRequestUrlFor(request, page.origin, deps.now());
  if (page === null || request === null || requestUrl === null) {
    // No address in the log: it may carry private paths or queries.
    deps.log.warn('RUCSS request refused — not a top-frame page asking for its own address');
    return { kind: 'refused' };
  }
  const { signal, release } = inflight.begin(page.tabId);
  try {
    const outcome = await sendRucssRequest(requestUrl, request.safelist, signal, deps);
    if (!outcome.ok) deps.log.info(`RUCSS request failed: ${outcome.failure.kind}`);
    return { kind: 'answered', requestUrl, outcome };
  } finally {
    release();
  }
}

/** Register the channel and the tab-close cancel (once per background start). */
export function registerRucssFetch(): void {
  const inflight = createRucssInflight();
  const deps: RucssFetchDeps = {
    fetch: (input, init) => fetch(input, init),
    now: () => Date.now(),
    timeoutSignal: (ms) => AbortSignal.timeout(ms),
    log
  };
  onMessage('fetchRucssShakenCss', ({ sender, data }) =>
    answerRucssFetch(sender, data, inflight, deps)
  );
  browser.tabs.onRemoved.addListener((tabId) => {
    inflight.cancel(tabId);
  });
}
