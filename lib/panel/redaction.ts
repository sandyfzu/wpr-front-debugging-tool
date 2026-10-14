/**
 * Redaction for anything the panel exports (a copied report, a ticket, a
 * log): which NAMES mark a secret — header names and URL query-parameter
 * names share one rule — and how a header value or a page URL is reduced
 * before it leaves the panel. The ONE declaring site: every export path
 * runs its values through {@link redactHeaderValue} / {@link redactUrl}.
 *
 * The rule is name-based and deliberately over-inclusive — redacting a
 * harmless value costs a support engineer one question, leaking a session
 * token costs the site owner their account:
 *
 * - **exact names** — HTTP's credential carriers (`cookie`, `set-cookie`,
 *   `set-cookie2`, `authorization`, `proxy-authorization`), the
 *   debug-profiler links (`x-debug-token`, `x-debug-token-link`), and the
 *   short query names that carry one-time secrets in WordPress and OAuth
 *   flows (`key`, `_wpnonce`, `nonce`, `preview_nonce`, `token`, `code`,
 *   `state`, `sig`);
 * - **name fragments** — any name containing `token`, `secret`, `session`,
 *   `auth`, `nonce`, `signature`, `api-key`/`api_key`/`apikey`, `csrf`,
 *   `xsrf`, `password`/`passwd`, `credential`, `jwt`, `hmac`, `bearer`,
 *   `private` or `pwd`, plus `pass` and `sig` as whole `-`/`_`-separated
 *   words and a trailing `key` word (`X-Access-Key`; `X-Cache-Key`
 *   over-matches, which is acceptable).
 *
 * `Set-Cookie` alone keeps the cookie's NAME (which cookie the server set is
 * useful evidence for caching issues); its value and attributes never pass.
 */

/** Names whose values are always secret (compared trimmed, lowercase). */
const SENSITIVE_EXACT_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  'set-cookie',
  'set-cookie2',
  'authorization',
  'proxy-authorization',
  'x-debug-token',
  'x-debug-token-link',
  'key',
  '_wpnonce',
  'nonce',
  'preview_nonce',
  'token',
  'code',
  'state',
  'sig'
]);

/** Name fragments that mark a name as secret-bearing (case-insensitive). */
const SENSITIVE_NAME_FRAGMENT =
  /token|secret|session|auth|nonce|signature|api[-_]?key|csrf|xsrf|passw(?:or)?d|credential|jwt|hmac|bearer|private|pwd|(?:^|[-_])pass(?:[-_]|$)|(?:^|[-_])sig(?:[-_]|$)|(?:^|[-_])key$/i;

/** What a redacted header value reads as. */
export const REDACTED = '(value redacted)';

/** What a redacted query-parameter value reads as. */
export const REDACTED_PARAM = '[redacted]';

/**
 * Whether a header or query-parameter name marks its value as secret.
 *
 * @param name The name, any casing; inner whitespace counts as `-`.
 * @returns True for the exact names and any name carrying a fragment.
 */
export function isSensitiveName(name: string): boolean {
  // Inner whitespace reads as a word separator (a form-decoded `api+key`).
  const lower = name.trim().toLowerCase().replace(/\s+/g, '-');
  return SENSITIVE_EXACT_NAMES.has(lower) || SENSITIVE_NAME_FRAGMENT.test(lower);
}

/**
 * The exportable form of one header value.
 *
 * @param name The header name, any casing.
 * @param value The captured value.
 * @returns `{ redacted: false, value }` for an ordinary header;
 *   `{ redacted: true, cookieName }` for a sensitive one, where `cookieName`
 *   is the `Set-Cookie` cookie's name when one is well-formed (the text
 *   before `=` within the first `;`-segment, trimmed, non-empty), else null —
 *   a nameless `Set-Cookie: SECRET` keeps nothing.
 */
export function redactHeaderValue(
  name: string,
  value: string
):
  | { readonly redacted: false; readonly value: string }
  | { readonly redacted: true; readonly cookieName: string | null } {
  if (!isSensitiveName(name)) return { redacted: false, value };
  if (name.trim().toLowerCase() !== 'set-cookie') return { redacted: true, cookieName: null };
  const firstSegment = value.split(';', 1)[0] ?? '';
  const equals = firstSegment.indexOf('=');
  const cookieName = equals === -1 ? '' : firstSegment.slice(0, equals).trim();
  return { redacted: true, cookieName: cookieName === '' ? null : cookieName };
}

/**
 * Decode a query-parameter name the way form decoding reads it (`+` is a
 * space), tolerating malformed escapes (the raw name is then compared).
 *
 * @param raw The name as written in the query.
 * @returns The decoded name.
 */
function decodeParamName(raw: string): string {
  const spaced = raw.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(spaced);
  } catch {
    // A malformed escape (`%zz`) cannot be decoded; compare it as written.
    return spaced;
  }
}

/**
 * The exportable form of a page URL: rebuilt from the parsed URL (never the
 * raw string), credentials (`user:pw@`) and fragment dropped, the query
 * kept for support context (e.g. `?nowprocket`) with the VALUE of every
 * sensitive-named parameter replaced by {@link REDACTED_PARAM}. Parameters
 * keep their order and their original encoding; valueless ones stay as-is.
 *
 * @param raw The untrusted URL text.
 * @returns The normalised `href` (the URL parser strips tabs/newlines and
 *   percent-encodes other controls and non-ASCII), or null when it is not
 *   an absolute http(s) URL.
 */
export function redactUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL at all: nothing exportable.
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  url.hash = '';
  if (url.search !== '') {
    url.search = url.search
      .slice(1)
      .split('&')
      .map((pair) => {
        const equals = pair.indexOf('=');
        if (equals === -1) return pair;
        const name = pair.slice(0, equals);
        return isSensitiveName(decodeParamName(name)) ? `${name}=${REDACTED_PARAM}` : pair;
      })
      .join('&');
  }
  return url.href;
}
