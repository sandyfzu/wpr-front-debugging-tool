/**
 * The pure side of one paused request (`Fetch.requestPaused`): the event
 * validated at the boundary, the decision whether it is a rewrite
 * candidate (a navigation response) or a script request a session may
 * answer (Request stage), the body read back into bytes, and the
 * `Fetch.fulfillRequest` parameters for a rewritten body or a runtime.
 *
 * Protocol facts relied on (CDP `Fetch`; Chromium `fetch_handler.cc` /
 * `devtools_url_loader_interceptor.cc`, verified 2026-10-20 and observed
 * on Chromium 156): a request is at the Response stage when
 * `responseStatusCode` or `responseErrorReason` is present; a redirect
 * pauses as its own 3xx response (continue → the next hop pauses with
 * `redirectedRequestId`); `responseHeaders` holds one entry per header
 * line (repeated names stay separate entries); the network layer has
 * already stored the response's cookies and strips `Set-Cookie` before
 * the pause (observed: absent from the paused headers, cookies set either
 * way); `fulfillRequest` without `responsePhrase` falls back to the
 * standard phrase and fails for a code that has none.
 */
import { isRecord } from '../../../utils/is-record';
import { base64ToBytes, bytesToBase64 } from '../../../utils/base64';
import {
  isRewritableResponse,
  rendersAsPage,
  type InterceptedResponseFacts
} from '../document-transform';
import type { PassedDocumentFailure } from '../../messaging/exclusion-session';
import { cspHeaderFacts } from '../../wp-rocket-simulation/csp-headers';

/** One response header line. */
export interface HeaderEntry {
  readonly name: string;
  readonly value: string;
}

/** A validated `Fetch.requestPaused` event. */
export interface PausedRequest {
  readonly requestId: string;
  /** The request URL (a redirect hop's own URL). */
  readonly url: string;
  readonly method: string;
  /** The frame the request is for (navigations: the navigated frame). */
  readonly frameId: string;
  readonly resourceType: string;
  /** The response status; null before a response (Request stage, or a network error). */
  readonly status: number | null;
  /** The response's reason phrase (empty over HTTP/2 and later). */
  readonly statusText: string;
  /** The response headers (empty before a response). */
  readonly headers: readonly HeaderEntry[];
  /** The network error the response stage reports, or null. */
  readonly errorReason: string | null;
}

/** Why a paused request is passed through unrewritten. */
export type PassReason =
  /** A non-script request paused before the response (continued to the network). */
  | 'request-stage'
  /** The response is a network error. */
  | 'network-error'
  /** Not a document request. */
  | 'not-document'
  /** A response the engine never rewrites (`isRewritableResponse`; redirects included). */
  | 'ineligible';

/**
 * What to do with a paused request before any frame check or body read: a
 * pass-through, a document response the engine may rewrite, or a script
 * request (only a simulated runtime's name pauses one) the session may
 * answer itself.
 */
export type PauseDisposition =
  | { readonly kind: 'pass'; readonly reason: PassReason }
  | { readonly kind: 'candidate'; readonly facts: InterceptedResponseFacts }
  | { readonly kind: 'script-request' };

/** The resource type of a script request (`Network.ResourceType`). */
const SCRIPT_RESOURCE = 'Script';

/**
 * The response headers a simulated runtime is served with: a classic
 * script's type (charset declared: the runtime is UTF-8), and never stored
 * — a cached copy would outlive the session and answer the URL after Stop.
 */
export const RUNTIME_RESPONSE_HEADERS: readonly HeaderEntry[] = [
  { name: 'content-type', value: 'text/javascript; charset=utf-8' },
  { name: 'cache-control', value: 'no-store' }
];

/**
 * The response header that adds speculation rules to a document (lowercase
 * name) — a session drops it (see `../speculation-rules`).
 */
export const SPECULATION_RULES_HEADER = 'speculation-rules';

/**
 * Response headers dropped from a fulfilled document, by lowercase name:
 * the fulfilled body is the decoded, unframed, rewritten bytes —
 * `Content-Encoding`, `Content-Length` and `Transfer-Encoding` described
 * the original wire form and would misframe it; `Set-Cookie` is already
 * processed by the network layer (fulfilling it again would store each
 * cookie a second time); `Speculation-Rules` would let the browser serve
 * the document's links from a prefetch, past interception.
 */
const DROPPED_FULFILL_HEADERS: ReadonlySet<string> = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'set-cookie',
  SPECULATION_RULES_HEADER
]);

/** A non-empty string field, or null. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** The header list, or null when any entry is malformed. */
function parseHeaders(value: unknown): HeaderEntry[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const headers: HeaderEntry[] = [];
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.value !== 'string')
      return null;
    headers.push({ name: entry.name, value: entry.value });
  }
  return headers;
}

/** The status code, null when absent, undefined when malformed. */
function parseStatus(value: unknown): number | null | undefined {
  if (value === undefined) return null;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * The request id of a `Fetch.requestPaused` event, even when the rest of
 * it is malformed — so the request can still be released.
 *
 * @param params The event parameters (untrusted).
 */
export function pausedRequestId(params: unknown): string | null {
  return isRecord(params) ? text(params.requestId) : null;
}

/**
 * Validate a `Fetch.requestPaused` event.
 *
 * @param params The event parameters (untrusted).
 * @returns The paused request, or null when a field it needs is missing or malformed.
 */
export function parsePausedRequest(params: unknown): PausedRequest | null {
  if (!isRecord(params) || !isRecord(params.request)) return null;
  const requestId = text(params.requestId);
  const url = text(params.request.url);
  const method = text(params.request.method);
  const frameId = text(params.frameId);
  const resourceType = text(params.resourceType);
  const status = parseStatus(params.responseStatusCode);
  const headers = parseHeaders(params.responseHeaders);
  const errorReason = params.responseErrorReason;
  const statusText = params.responseStatusText ?? '';
  if (
    requestId === null ||
    url === null ||
    method === null ||
    frameId === null ||
    resourceType === null ||
    status === undefined ||
    headers === null ||
    typeof statusText !== 'string' ||
    (errorReason !== undefined && typeof errorReason !== 'string')
  ) {
    return null;
  }
  return {
    requestId,
    url,
    method,
    frameId,
    resourceType,
    status,
    statusText,
    headers,
    errorReason: errorReason ?? null
  };
}

/**
 * Every value of a header, joined with `, ` (the Fetch-standard combined
 * value), or null when absent. Names compare ASCII-case-insensitively.
 *
 * @param headers The header lines.
 * @param name The header name.
 */
export function headerValue(headers: readonly HeaderEntry[], name: string): string | null {
  const wanted = name.toLowerCase();
  const values = headers
    .filter((header) => header.name.toLowerCase() === wanted)
    .map((header) => header.value);
  return values.length === 0 ? null : values.join(', ');
}

/**
 * Decide what a paused request is before any I/O: a pass-through, a
 * document response the engine may rewrite, or a script request the
 * session may answer (both pending the top-frame check).
 *
 * @param pause The paused request.
 */
export function classifyPause(pause: PausedRequest): PauseDisposition {
  if (pause.errorReason !== null) return { kind: 'pass', reason: 'network-error' };
  if (pause.status === null) {
    return pause.resourceType === SCRIPT_RESOURCE
      ? { kind: 'script-request' }
      : { kind: 'pass', reason: 'request-stage' };
  }
  if (pause.resourceType !== 'Document') return { kind: 'pass', reason: 'not-document' };
  const facts: InterceptedResponseFacts = {
    status: pause.status,
    method: pause.method,
    contentType: headerValue(pause.headers, 'content-type'),
    // One entry per header line, report-only under its own name.
    ...cspHeaderFacts(pause.headers)
  };
  return isRewritableResponse(facts)
    ? { kind: 'candidate', facts }
    : { kind: 'pass', reason: 'ineligible' };
}

/**
 * The network error reason of a navigation the browser cancelled (another
 * navigation, a stop): the current page stays, so nothing is recorded.
 */
const ABORTED_ERROR_REASON = 'Aborted';

/**
 * What a passed document response becomes on the tab, as the session
 * records it (when it is the session tab's top-level page on the session's
 * origin): `ineligible-response` for a response the engine never rewrites
 * that still becomes the page ({@link rendersAsPage}), `network-error` for a
 * failed one (the browser's error page replaces the page) — or null when it
 * is not a page at all (not a document, a redirect hop, no content, a
 * download, a cancelled navigation, a request-stage pause).
 *
 * @param pause The paused request.
 * @param reason Why it is passed.
 */
export function passedPageFailure(
  pause: PausedRequest,
  reason: PassReason
): PassedDocumentFailure | null {
  if (pause.resourceType !== 'Document') return null;
  if (reason === 'network-error')
    return pause.errorReason === ABORTED_ERROR_REASON ? null : 'network-error';
  if (reason !== 'ineligible' || pause.status === null) return null;
  const page = rendersAsPage({
    status: pause.status,
    method: pause.method,
    disposition: headerValue(pause.headers, 'content-disposition'),
    contentType: headerValue(pause.headers, 'content-type')
  });
  return page ? 'ineligible-response' : null;
}

/**
 * The bytes of a `Fetch.getResponseBody` result. Chromium always answers
 * base64; a textual answer is accepted only when it is pure ASCII (then
 * its bytes are unambiguous in any ASCII-compatible charset) — otherwise
 * the original bytes are unknowable and the body counts as unreadable.
 *
 * @param result The command result (untrusted).
 * @returns The bytes, or null when the result is malformed or ambiguous.
 */
export function responseBodyBytes(result: unknown): Uint8Array | null {
  if (!isRecord(result) || typeof result.body !== 'string') return null;
  if (result.base64Encoded === true) return base64ToBytes(result.body);
  if (result.base64Encoded !== false) return null;
  const body = result.body;
  const bytes = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) {
    const unit = body.charCodeAt(i);
    if (unit > 0x7f) return null;
    bytes[i] = unit;
  }
  return bytes;
}

/**
 * The headers a fulfilled document carries: the original lines, in order
 * (repeated names kept), minus the framing and cookie lines.
 *
 * @param headers The paused response's header lines.
 */
export function fulfillHeaders(headers: readonly HeaderEntry[]): HeaderEntry[] {
  return headers.filter((header) => !DROPPED_FULFILL_HEADERS.has(header.name.toLowerCase()));
}

/**
 * The `Fetch.fulfillRequest` parameters serving `body` in place of the
 * paused response: same status code and reason phrase, the passed-through
 * headers.
 *
 * @param pause The paused (response-stage) request.
 * @param body The rewritten body bytes.
 */
export function fulfillParams(pause: PausedRequest, body: Uint8Array): Record<string, unknown> {
  return {
    requestId: pause.requestId,
    responseCode: pause.status,
    responseHeaders: fulfillHeaders(pause.headers),
    body: bytesToBase64(body),
    // Without a phrase Chromium substitutes the standard one (the HTTP/2
    // case: no phrase on the wire).
    ...(pause.statusText.length > 0 && { responsePhrase: pause.statusText })
  };
}

/**
 * The `Fetch.continueResponse` parameters that serve the paused response
 * as it is but for its `Speculation-Rules` header (all of code, phrase and
 * headers must be given once one is), or null when it has no such header.
 *
 * @param pause The paused (response-stage) request.
 */
export function continueWithoutRulesHeaderParams(
  pause: PausedRequest
): Record<string, unknown> | null {
  if (pause.status === null || headerValue(pause.headers, SPECULATION_RULES_HEADER) === null)
    return null;
  return {
    requestId: pause.requestId,
    responseCode: pause.status,
    responseHeaders: pause.headers.filter(
      (header) => header.name.toLowerCase() !== SPECULATION_RULES_HEADER
    ),
    ...(pause.statusText.length > 0 && { responsePhrase: pause.statusText })
  };
}

/**
 * The `Fetch.fulfillRequest` parameters answering a paused script request
 * (before it reached the network) with a simulated runtime's bytes.
 *
 * @param requestId The paused (request-stage) request's id.
 * @param body The runtime's bytes.
 */
export function runtimeFulfillParams(requestId: string, body: Uint8Array): Record<string, unknown> {
  return {
    requestId,
    responseCode: 200,
    responseHeaders: RUNTIME_RESPONSE_HEADERS,
    body: bytesToBase64(body)
  };
}

/**
 * The top-level document's URL in a `Page.getFrameTree` result (the root
 * frame's `url` — the document's URL without its fragment), or null when
 * the result lacks it (validated: protocol results are untrusted).
 *
 * @param result The command's result.
 */
export function frameTreeDocumentUrl(result: unknown): string | null {
  return frameTreeRoot(result, 'url');
}

/**
 * The root frame's id in a `Page.getFrameTree` result — the top frame of
 * the session that answered it (`Page.Frame.id`) — or null when the result
 * lacks it (validated: protocol results are untrusted).
 *
 * @param result The command's result.
 */
export function frameTreeRootId(result: unknown): string | null {
  return frameTreeRoot(result, 'id');
}

/** One non-empty string field of a frame-tree result's root frame, or null. */
function frameTreeRoot(result: unknown, field: 'url' | 'id'): string | null {
  if (!isRecord(result) || !isRecord(result.frameTree) || !isRecord(result.frameTree.frame)) {
    return null;
  }
  return text(result.frameTree.frame[field]);
}
