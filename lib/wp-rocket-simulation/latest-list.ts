/**
 * The latest Delay JS exclusion list WP Media publishes: where it is read
 * from and how a fetched document is validated before any of it is kept.
 *
 * The answer is untrusted remote data — never code: only the
 * `delay_js_exclusions` array is read (every other key is ignored, never
 * iterated), its text is capped before parsing, and every row must pass
 * the engine contract's bounds and be a row the Delay JS transform
 * reproduces exactly as WP Rocket applies it — a list the transform would
 * refuse never replaces the bundled one.
 */
import { parseSimulationListRows } from '../messaging/exclusion-simulation';
import { isRecord, ownValue } from '../../utils/is-record';
import { firstUnreproducibleListRow } from './delay-js-forward';
import type { LatestListMiss } from './spec';

/**
 * WP Media's endpoint serving WP Rocket's current exclusion lists (the URL
 * the plugin refreshes its own copy from, asked here with no query and no
 * credentials: it serves one list for every plugin version).
 */
export const LATEST_LIST_ENDPOINT = 'https://b.rucss.wp-rocket.me/api/v2/exclusions/list';

/**
 * Cap on the endpoint's answer (UTF-8 bytes; characters for an already
 * decoded text): the document held 24 403 B (2026-10-28/29), so a ≥ 20×
 * margin for growth, while a hostile body is refused unparsed.
 */
export const LATEST_LIST_MAX_BYTES = 512 * 1024;

/** The one key read from the endpoint's document. */
const DELAY_JS_LIST_KEY = 'delay_js_exclusions';

/** The misses a validation can name (the transport's are the fetcher's). */
export type LatestListValidationMiss = Extract<
  LatestListMiss,
  'oversize' | 'malformed' | 'invalid'
>;

/** A validation's answer: the rows, or why the list is unusable (with what failed). */
export type LatestListValidation =
  | { readonly ok: true; readonly rows: readonly string[] }
  | { readonly ok: false; readonly miss: LatestListValidationMiss; readonly detail: string };

/**
 * Validate a list's rows: 1 to the engine's row cap rows, each a string of
 * 1 to the engine's character cap, every one reproduced by the transform
 * (a row PCRE rejects counts as reproduced: it never matches, as on WP
 * Rocket). Shared by the fetch and the read of the kept copy.
 *
 * @param value The candidate rows.
 * @returns The rows (a fresh array), or `invalid` with what failed.
 */
export function validateLatestListRows(value: unknown): LatestListValidation {
  if (!Array.isArray(value)) {
    return { ok: false, miss: 'malformed', detail: `${DELAY_JS_LIST_KEY} is not an array` };
  }
  if (value.length === 0) {
    return { ok: false, miss: 'invalid', detail: `${DELAY_JS_LIST_KEY} is empty` };
  }
  const rows = parseSimulationListRows(value);
  if (rows === null) {
    return {
      ok: false,
      miss: 'invalid',
      detail: `${DELAY_JS_LIST_KEY} holds a non-string, empty or over-long row, or too many rows`
    };
  }
  const unreproducible = firstUnreproducibleListRow(rows);
  if (unreproducible !== null) {
    return {
      ok: false,
      miss: 'invalid',
      detail: `${DELAY_JS_LIST_KEY} row ${String(unreproducible.index)} cannot be reproduced: ${unreproducible.reason}`
    };
  }
  return { ok: true, rows };
}

/**
 * Validate the endpoint's answer text: within the size cap, JSON, an
 * object holding the `delay_js_exclusions` array, whose rows pass
 * {@link validateLatestListRows}.
 *
 * @param text The decoded answer body.
 * @returns The rows, or the miss with what failed.
 */
export function parseLatestList(text: string): LatestListValidation {
  if (text.length > LATEST_LIST_MAX_BYTES) {
    return {
      ok: false,
      miss: 'oversize',
      detail: `${String(text.length)} characters over the ${String(LATEST_LIST_MAX_BYTES)} cap`
    };
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (cause) {
    return { ok: false, miss: 'malformed', detail: `not JSON (${String(cause)})` };
  }
  if (!isRecord(document)) {
    return { ok: false, miss: 'malformed', detail: 'not a JSON object' };
  }
  return validateLatestListRows(ownValue(document, DELAY_JS_LIST_KEY));
}
