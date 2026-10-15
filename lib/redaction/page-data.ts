/**
 * The page data as an export may carry it (the palette's JSON file): every
 * secret-bearing part withheld by the shared rule, and the document saying
 * so up front.
 *
 * - `pageHeaders` — through the header rule ({@link redactPageHeaders}):
 *   rows the capture already withheld pass as they are; any other row is
 *   re-checked (defence in depth, a no-op on a capture-redacted row).
 * - every other page-derived value (detections, preloaded resources, the
 *   diagnoser report, undefined references, cookie names) — walked whole:
 *   a field under a sensitive NAME (the diagnoser's `consumer_key`,
 *   `secret_key`, `*_email`, …) is replaced wholesale, and every string is
 *   scrubbed as text ({@link scrubText}): URLs reduced by the URL rule,
 *   sensitive query pairs and `key: "value"` / `key = 'value'` string
 *   literals (localized-script nonces in inline script content) withheld.
 *
 * Best effort by design for free text: the scrub is name-based and
 * over-inclusive, like the rule it applies.
 */

import type { FdtData } from '../wp-rocket/types';
import { isRecord } from '../../utils/is-record';
import { redactPageHeaders } from './headers';
import { decodeParamName, isSensitiveName, REDACTED_PARAM, reduceAbsoluteUrls } from './rule';

/** The notice an export carries first, so a reader knows what was withheld. */
export const EXPORT_REDACTION_NOTICE = {
  applied: true,
  note:
    'Secret-bearing values are withheld. Header rows marked "redacted": true keep only their name ' +
    '(a Set-Cookie also its cookie name); URLs lose credentials, fragments and sensitive query ' +
    'values; fields and string literals with sensitive names read "[redacted]".'
} as const;

/** The exported document: the notice, then the page data's own (redacted) fields. */
export type PageDataExport = { readonly redaction: typeof EXPORT_REDACTION_NOTICE } & Readonly<
  Record<string, unknown>
>;

/**
 * A query/fragment pair inside text (`?token=…`, `&_wpnonce=…`, also in a
 * JSON-escaped or relative URL the absolute-URL pass cannot parse).
 */
const TEXT_PAIR = /([?&;#])([^\s=&;#?"'<>\\]{1,128})=([^\s&;#"'<>\\]*)/g;

/**
 * A string literal assigned to a key (`"nonce":"…"`, `api_key = '…'`).
 * Anchored after a non-identifier character so each key is tried once
 * (linear over long minified scripts); the value stops at its closing quote
 * or the line's end, escapes kept whole.
 */
const KEYED_STRING =
  /(?<![\w$-])(["']?)([A-Za-z_$][\w$-]*)\1(\s*[:=]\s*)(["'])((?:\\.|(?!\4)[^\\\r\n])*)\4/g;

/**
 * Scrub free page text: absolute URLs reduced by the URL rule, then any
 * remaining sensitive query pair and sensitive-keyed string literal
 * withheld. Text without either passes unchanged.
 *
 * @param text Page-derived text (a URL, a script body, a config string).
 * @returns The scrubbed text.
 */
export function scrubText(text: string): string {
  return reduceAbsoluteUrls(text)
    .replace(TEXT_PAIR, (whole, separator: string, name: string) =>
      isSensitiveName(decodeParamName(name)) ? `${separator}${name}=${REDACTED_PARAM}` : whole
    )
    .replace(
      KEYED_STRING,
      (whole, keyQuote: string, key: string, assign: string, valueQuote: string) =>
        isSensitiveName(key)
          ? `${keyQuote}${key}${keyQuote}${assign}${valueQuote}${REDACTED_PARAM}${valueQuote}`
          : whole
    );
}

/**
 * Redact a page-derived JSON value whole: sensitive-named fields replaced
 * by the marker, strings scrubbed, structure otherwise kept. Objects are
 * rebuilt with `Object.fromEntries`, so a page-provided `__proto__` key
 * stays an own data field instead of reshaping the result's prototype.
 *
 * @param value Any JSON-shaped value.
 * @returns The redacted copy.
 */
function redactTree(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(redactTree);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveName(key) ? REDACTED_PARAM : redactTree(child)
      ])
    );
  }
  return value;
}

/**
 * The exportable form of the page data.
 *
 * @param data The loaded page data (left untouched).
 * @returns The notice first, then every field of `data`, redacted.
 */
export function redactPageDataForExport(data: FdtData): PageDataExport {
  const { pageHeaders, ...rest } = data;
  const redacted = redactTree(rest) as Record<string, unknown>;
  return {
    redaction: EXPORT_REDACTION_NOTICE,
    ...redacted,
    pageHeaders: pageHeaders === null ? null : redactPageHeaders(pageHeaders)
  };
}
