/**
 * The latest Delay JS and Defer JS exclusion lists WP Media publishes:
 * where they are read from and how a fetched document is validated before
 * any of it is kept.
 *
 * The answer is untrusted remote data — never code: only the
 * `delay_js_exclusions`, `defer_js_external_exclusions` and
 * `defer_js_inline_exclusions` arrays are read (every other key is
 * ignored, never iterated), its text is capped before parsing, and every
 * row must pass the engine contract's bounds and be a row its transform
 * reproduces exactly as WP Rocket applies it — a list the transform would
 * refuse never replaces the bundled one.
 *
 * The Delay JS list decides the document: without a usable one nothing is
 * kept. The two Defer JS lists are one unit beside it (WP Rocket reads
 * them together): when either is missing or unusable, the document's
 * Delay JS list is still kept and Defer JS runs the bundled lists, with
 * the Defer lists' own miss named.
 */
import { parseSimulationListRows } from '../messaging/exclusion-simulation';
import { isRecord, ownValue } from '../../utils/is-record';
import { deferUrlMatcher, inlineExclusions, type DeferJsLists } from './defer-js-forward';
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

/** The Delay JS list's key in the endpoint's document. */
const DELAY_JS_LIST_KEY = 'delay_js_exclusions';

/** The Defer JS lists' keys in the endpoint's document. */
const DEFER_JS_LIST_KEYS = {
  external: 'defer_js_external_exclusions',
  inline: 'defer_js_inline_exclusions'
} as const satisfies Record<keyof DeferJsLists, string>;

/** The misses a validation can name (the transport's are the fetcher's). */
export type LatestListValidationMiss = Extract<
  LatestListMiss,
  'oversize' | 'malformed' | 'invalid'
>;

/** A validation's miss: why a list is unusable, with what failed. */
export interface LatestListValidationFailure {
  readonly ok: false;
  readonly miss: LatestListValidationMiss;
  readonly detail: string;
}

/** A validation's answer: the rows, or why the list is unusable (with what failed). */
export type LatestListValidation =
  { readonly ok: true; readonly rows: readonly string[] } | LatestListValidationFailure;

/** The Defer JS lists' validation: both lists, or why they are unusable. */
export type DeferListsValidation =
  { readonly ok: true; readonly lists: DeferJsLists } | LatestListValidationFailure;

/** A document's validation: the Delay JS rows, and the Defer JS lists' own outcome. */
export type LatestDocumentValidation =
  | { readonly ok: true; readonly rows: readonly string[]; readonly defer: DeferListsValidation }
  | LatestListValidationFailure;

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
  const rows = boundedListRows(value, DELAY_JS_LIST_KEY);
  if (!rows.ok) return rows;
  const unreproducible = firstUnreproducibleListRow(rows.rows);
  if (unreproducible !== null) {
    return {
      ok: false,
      miss: 'invalid',
      detail: `${DELAY_JS_LIST_KEY} row ${String(unreproducible.index)} cannot be reproduced: ${unreproducible.reason}`
    };
  }
  return rows;
}

/**
 * A list's rows within the engine's bounds: an array (else `malformed`)
 * of 1 to the row cap strings of 1 to the character cap each (else
 * `invalid`; an empty list never replaces a bundled one).
 *
 * @param value The candidate rows.
 * @param key The list's document key (named in the detail).
 * @returns The rows (a fresh array), or the miss with what failed.
 */
function boundedListRows(value: unknown, key: string): LatestListValidation {
  if (!Array.isArray(value))
    return { ok: false, miss: 'malformed', detail: `${key} is not an array` };
  if (value.length === 0) return { ok: false, miss: 'invalid', detail: `${key} is empty` };
  const rows = parseSimulationListRows(value);
  return rows === null
    ? {
        ok: false,
        miss: 'invalid',
        detail: `${key} holds a non-string, empty or over-long row, or too many rows`
      }
    : { ok: true, rows };
}

/**
 * Validate the Defer JS lists: each within the bounds of
 * {@link boundedListRows}, and each one the Defer JS transform reproduces
 * as WP Rocket joins it — a pattern PCRE is known to reject counts as
 * reproduced (WP Rocket then defers nothing, or excludes no inline
 * script); one whose verdict is not known is refused: an external pattern
 * whose pre-check cannot be replayed (its compiled size included), an
 * inline one too near PCRE's compiled-size cap. Shared by the fetch and
 * the read of the kept copy.
 *
 * @param external The candidate `defer_js_external_exclusions` rows.
 * @param inline The candidate `defer_js_inline_exclusions` rows.
 * @returns Both lists (fresh arrays), or the first miss with what failed.
 */
export function validateDeferLists(external: unknown, inline: unknown): DeferListsValidation {
  const externalRows = boundedListRows(external, DEFER_JS_LIST_KEYS.external);
  if (!externalRows.ok) return externalRows;
  const inlineRows = boundedListRows(inline, DEFER_JS_LIST_KEYS.inline);
  if (!inlineRows.ok) return inlineRows;
  const lists: DeferJsLists = { external: externalRows.rows, inline: inlineRows.rows };
  try {
    // The quoting delimiter only shapes the inline pattern, which this check does not build.
    deferUrlMatcher({ rows: [], lists, inlineQuoteDelimiter: '/' });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, miss: 'invalid', detail: `${DEFER_JS_LIST_KEYS.external}: ${reason}` };
  }
  // The size verdict does not depend on the version's quoting delimiter.
  if (inlineExclusions(lists.inline, '/').kind === 'uncertain') {
    const detail = `${DEFER_JS_LIST_KEYS.inline}: its pattern is too near PCRE's compiled-size cap to tell whether it compiles`;
    return { ok: false, miss: 'invalid', detail };
  }
  return { ok: true, lists };
}

/**
 * Validate the endpoint's answer text: within the size cap, JSON, an
 * object holding the `delay_js_exclusions` array, whose rows pass
 * {@link validateLatestListRows} — and, read from the same document, the
 * Defer JS lists ({@link validateDeferLists}; their miss never fails the
 * document).
 *
 * @param text The decoded answer body.
 * @returns The Delay JS rows with the Defer JS lists' outcome, or the
 *   document's miss with what failed.
 */
export function parseLatestList(text: string): LatestDocumentValidation {
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
  const delay = validateLatestListRows(ownValue(document, DELAY_JS_LIST_KEY));
  if (!delay.ok) return delay;
  const defer = validateDeferLists(
    ownValue(document, DEFER_JS_LIST_KEYS.external),
    ownValue(document, DEFER_JS_LIST_KEYS.inline)
  );
  return { ok: true, rows: delay.rows, defer };
}
