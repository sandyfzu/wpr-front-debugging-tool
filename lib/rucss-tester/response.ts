/**
 * The service's answer, judged without trusting any of it: a usable answer
 * is a JSON object whose numeric `code` is 200 and whose
 * `contents.shakedCSS` is a string. Everything else becomes a typed failure
 * naming what went wrong, so the page is never touched on a bad answer.
 */
import { fetchFailureKind } from '../../utils/fetch-failure';
import { isRecord, ownValue } from '../../utils/is-record';
import type { CappedTextRead } from '../../utils/read-capped-text';

/** Largest answer body read (bytes); a bigger one is refused unread past the cap. */
export const RUCSS_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

/** The service code of a successful run. */
const SERVICE_OK = 200;

/** Why a request produced no usable CSS. */
export type RucssFetchFailure =
  /** The request never got an answer. */
  | { readonly kind: 'network-error' }
  /** The request's time budget ran out (its timeout signal fired). */
  | { readonly kind: 'timeout' }
  /** The caller cancelled the request (a plain abort, not the timeout signal). */
  | { readonly kind: 'cancelled' }
  /** The body passed {@link RUCSS_RESPONSE_MAX_BYTES}. */
  | { readonly kind: 'oversize' }
  /** The body is not UTF-8 text. */
  | { readonly kind: 'not-utf8' }
  /** A non-2xx answer without a readable service code. */
  | { readonly kind: 'http-status'; readonly httpStatus: number }
  /**
   * An answer that is not the expected JSON shape: a 2xx one without a
   * readable service code, or any status whose code is 200 but whose
   * `contents.shakedCSS` is not a string.
   */
  | { readonly kind: 'malformed'; readonly httpStatus: number }
  /** The service answered with a code other than 200. */
  | { readonly kind: 'service-code'; readonly httpStatus: number; readonly serviceCode: number };

/** One request's outcome. */
export type RucssFetchOutcome =
  | { readonly ok: true; readonly shakenCss: string }
  | { readonly ok: false; readonly failure: RucssFetchFailure };

/** Whether an HTTP status is a success (2xx). */
function isHttpOk(httpStatus: number): boolean {
  return httpStatus >= 200 && httpStatus <= 299;
}

/** Parse JSON text, `undefined` when it is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Not JSON: the caller classifies the answer as unreadable.
    return undefined;
  }
}

/**
 * Judge an answer. The service's own `code` decides — also on a non-2xx
 * status, where a readable code is the more precise reason; a non-2xx
 * answer without one is an `http-status` failure, a 2xx one `malformed`.
 *
 * @param httpStatus The HTTP status.
 * @param body The body, read with {@link RUCSS_RESPONSE_MAX_BYTES} as cap.
 * @returns The service's CSS, or the typed failure.
 */
export function parseRucssResponse(httpStatus: number, body: CappedTextRead): RucssFetchOutcome {
  if (!body.ok) return { ok: false, failure: { kind: body.problem } };
  const unreadable: RucssFetchOutcome = {
    ok: false,
    failure: isHttpOk(httpStatus)
      ? { kind: 'malformed', httpStatus }
      : { kind: 'http-status', httpStatus }
  };
  const data = parseJson(body.text);
  if (!isRecord(data)) return unreadable;
  const code = ownValue(data, 'code');
  if (typeof code !== 'number' || !Number.isFinite(code)) return unreadable;
  if (code !== SERVICE_OK) {
    return { ok: false, failure: { kind: 'service-code', httpStatus, serviceCode: code } };
  }
  const contents = ownValue(data, 'contents');
  const css = isRecord(contents) ? ownValue(contents, 'shakedCSS') : undefined;
  return typeof css === 'string'
    ? { ok: true, shakenCss: css }
    : { ok: false, failure: { kind: 'malformed', httpStatus } };
}

/**
 * The outcome of a request that rejected (before or while reading the body).
 * A request aborted through a signal rejects with that signal's reason: the
 * timeout signal's `TimeoutError` reads as `timeout`, a plain abort's
 * `AbortError` (the caller cancelling, e.g. the page going away) as
 * `cancelled`, anything else as a network error.
 *
 * @param cause The rejection.
 * @returns The failure outcome.
 */
export function rucssTransportFailure(cause: unknown): RucssFetchOutcome {
  const kind =
    cause instanceof DOMException && cause.name === 'AbortError'
      ? 'cancelled'
      : fetchFailureKind(cause);
  return { ok: false, failure: { kind } };
}
