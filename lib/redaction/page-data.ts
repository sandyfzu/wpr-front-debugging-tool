/**
 * The page data as an export may carry it (the palette's JSON file): every
 * secret-bearing part withheld by the shared rule, and the document saying
 * so up front.
 *
 * - `pageHeaders` — through the header rule ({@link redactPageHeaders}):
 *   rows the capture already withheld pass as they are; any other row is
 *   re-checked (defence in depth, a no-op on a capture-redacted row).
 * - inline script bodies (Delay JS `content`) — withheld whole, replaced
 *   by `{ withheld: true, length }`: scripts carry nonces and keys in more
 *   shapes than any text scrub can recognise (call arguments, nested
 *   objects, JSON inside strings, template literals, concatenation), so
 *   only their length leaves; `src` and every flag stay.
 * - every other page-derived value (detections, preloaded resources,
 *   undefined references, cookie names, any field added later) — walked
 *   whole: a field under a sensitive NAME (`consumer_key`, `secret_key`,
 *   `licenseKey`, `*_email`, …) is replaced wholesale, and every string is
 *   scrubbed as text ({@link scrubText}).
 *
 * The text scrub is name-based and over-inclusive, like the rule it
 * applies; it serves short page strings (URLs, config values), never code.
 */

import type { DelayedScriptRecord, FdtData } from '../wp-rocket/types';
import { isRecord } from '../../utils/is-record';
import { redactPageHeaders } from './headers';
import { decodeParamName, isSensitiveName, REDACTED_PARAM, redactUrlReference } from './rule';

/** The notice an export carries first, so a reader knows what was withheld. */
export const EXPORT_REDACTION_NOTICE = {
  applied: true,
  note:
    'Secret-bearing values are withheld. Header rows marked "redacted": true keep only their name ' +
    '(a Set-Cookie also its cookie name); inline script bodies are withheld whole and read ' +
    '{ "withheld": true, "length": N } (src and flags kept); URLs lose credentials, fragments ' +
    'and sensitive query values; fields and string literals with sensitive names read "[redacted]".'
} as const;

/** The exported document: the notice, then the page data's own (redacted) fields. */
export type PageDataExport = { readonly redaction: typeof EXPORT_REDACTION_NOTICE } & Readonly<
  Record<string, unknown>
>;

/**
 * An HTML-escaped `&` (`&amp;`, decimal `&#38;`/`&#038;`, hex `&#x26;`):
 * part of a URL in page markup. One source for both patterns below.
 */
const ESCAPED_AMP_SOURCE = '&(?:amp|#0*38|#x0*26);';

/** One {@link ESCAPED_AMP_SOURCE} occurrence. */
const ESCAPED_AMP = new RegExp(ESCAPED_AMP_SOURCE, 'i');

/**
 * An absolute http(s) URL inside text, its HTML-escaped `&`s included (a
 * bare `;` or `#` would otherwise cut `&#038;` into a fake fragment). The
 * run has nothing after it to fail on, so the alternation never backtracks.
 */
const TEXT_URL = new RegExp(`https?://(?:${ESCAPED_AMP_SOURCE}|[^\\s,;"<>])+`, 'gi');

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
 * Reduce one absolute URL found in text by the URL rule, its escaped `&`s
 * read as `&` and written back in the same escape.
 *
 * @param url The URL as written.
 * @returns The reduced URL (the same text when nothing changed).
 */
function reduceTextUrl(url: string): string {
  const escape = ESCAPED_AMP.exec(url)?.[0];
  const plain = escape === undefined ? url : url.replace(new RegExp(ESCAPED_AMP_SOURCE, 'gi'), '&');
  const reduced = redactUrlReference(plain);
  if (reduced === plain) return url;
  return escape === undefined ? reduced : reduced.replace(/&/g, escape);
}

/**
 * Scrub free page text: absolute URLs reduced by the URL rule, then any
 * remaining sensitive query pair and sensitive-keyed string literal
 * withheld. Text without either passes unchanged.
 *
 * @param text Page-derived text (a URL, a config string).
 * @returns The scrubbed text.
 */
export function scrubText(text: string): string {
  // Every pattern below needs a `:` or an `=`: most page strings (names,
  // selectors, versions) skip the three passes entirely.
  if (!/[:=]/.test(text)) return text;
  return text
    .replace(TEXT_URL, reduceTextUrl)
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

/** What an inline script body reads as in an export. */
export interface WithheldBody {
  readonly withheld: true;
  /** The body's length in characters (its only exported trace). */
  readonly length: number;
}

/**
 * The Delay JS rows with every inline body withheld (`src`, flags kept).
 *
 * @param scripts The rows.
 * @returns Fresh rows, `content` replaced by a {@link WithheldBody}.
 */
function withholdBodies(
  scripts: readonly DelayedScriptRecord[]
): (Omit<DelayedScriptRecord, 'content'> & { content?: WithheldBody })[] {
  return scripts.map(({ content, ...row }) =>
    content === undefined ? row : { ...row, content: { withheld: true, length: content.length } }
  );
}

/**
 * Redact a page-derived JSON value whole: sensitive-named fields replaced
 * by the marker, strings scrubbed, structure otherwise kept. Objects are
 * rebuilt with `Object.fromEntries`, so a page-provided `__proto__` key
 * stays an own data field instead of reshaping the result's prototype.
 *
 * @param value Any JSON-shaped value.
 * @param sensitive The name rule, memoised per export (thousands of rows
 *   repeat the same few keys).
 * @returns The redacted copy.
 */
function redactTree(value: unknown, sensitive: (key: string) => boolean): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map((item) => redactTree(item, sensitive));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitive(key) ? REDACTED_PARAM : redactTree(child, sensitive)
      ])
    );
  }
  return value;
}

/**
 * {@link isSensitiveName}, memoised for one export.
 *
 * @returns The memoised rule.
 */
function memoisedNameRule(): (key: string) => boolean {
  const known = new Map<string, boolean>();
  return (key) => {
    let verdict = known.get(key);
    if (verdict === undefined) {
      verdict = isSensitiveName(key);
      known.set(key, verdict);
    }
    return verdict;
  };
}

/**
 * The exportable form of the page data.
 *
 * @param data The loaded page data (left untouched).
 * @returns The notice first, then every field of `data`, redacted.
 */
export function redactPageDataForExport(data: FdtData): PageDataExport {
  const { pageHeaders, wprDetections, ...rest } = data;
  const detections = {
    ...wprDetections,
    delay_js: { ...wprDetections.delay_js, scripts: withholdBodies(wprDetections.delay_js.scripts) }
  };
  const redacted = redactTree({ ...rest, wprDetections: detections }, memoisedNameRule()) as Record<
    string,
    unknown
  >;
  return {
    redaction: EXPORT_REDACTION_NOTICE,
    ...redacted,
    pageHeaders: pageHeaders === null ? null : redactPageHeaders(pageHeaders)
  };
}
