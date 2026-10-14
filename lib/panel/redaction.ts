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
 *   `private` or `pwd`;
 * - **whole words** (`-`/`_`/space-separated, so `signal`, `turnkey` or
 *   `postcode` pass) — `pass`, `sig`, `sid`, `ticket`, `otp`, `hash`, the
 *   personal-data names `email` and `login` (`user_login`), and a trailing
 *   `key` (`X-Access-Key`; `X-Cache-Key` over-matches, which is acceptable).
 *
 * One exemption: the exact name `author` (WordPress's `?author=1` archive
 * id is useful support context, not a credential) — the `auth` fragment
 * would otherwise catch it; `author_token` and the like stay redacted.
 *
 * URLs ({@link redactUrl}): credentials and fragment are dropped; query
 * pairs (split on `&` and `;`) keep their names but lose sensitive values,
 * a value under an empty name is redacted, and a valueless pair that looks
 * like a token (≥ 24 characters, or a JWT-shaped `x.y.z`) is redacted
 * whole. Path segments are out of scope (they are routing, and redacting
 * them would break the URL's support value), except `;name=value` path
 * parameters (`;jsessionid=…`), which get the same name rule.
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

/**
 * Name fragments (anywhere in the name) and whole words (between `-`/`_`
 * separators or the name's edges) that mark a name as secret-bearing.
 * Matched against the normalised name (lowercase, whitespace and `+` as `-`).
 */
const SENSITIVE_NAME_FRAGMENT =
  /token|secret|session|auth|nonce|signature|api[-_]?key|csrf|xsrf|passw(?:or)?d|credential|jwt|hmac|bearer|private|pwd|(?:^|[-_])(?:pass|sig|sid|ticket|otp|hash|email|login)(?:[-_]|$)|(?:^|[-_])key$/;

/** Exact names exempt from the fragments (useful context, never a credential). */
const EXEMPT_NAMES: ReadonlySet<string> = new Set(['author']);

/** A valueless query pair this long reads as a bare token. */
const BARE_TOKEN_MIN_LENGTH = 24;

/** A JWT-shaped bare value: three base64url runs joined by dots. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** What a redacted header value reads as. */
export const REDACTED = '(value redacted)';

/** What a redacted query-parameter value reads as. */
export const REDACTED_PARAM = '[redacted]';

/**
 * Whether a header or query-parameter name marks its value as secret.
 *
 * @param name The (decoded) name, any casing; inner whitespace and `+`
 *   count as `-`.
 * @returns True for the exact names and any name carrying a fragment or
 *   word, except the exempt names.
 */
export function isSensitiveName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  if (SENSITIVE_EXACT_NAMES.has(lower)) return true;
  if (EXEMPT_NAMES.has(lower)) return false;
  // Whitespace and `+` read as word separators (`api key`, `api+key`).
  return SENSITIVE_NAME_FRAGMENT.test(lower.replace(/[\s+]+/g, '-'));
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

/** How many decoding passes undo nested escapes (`%252B` → `%2B` → `+`). */
const MAX_DECODE_PASSES = 3;

/**
 * Decode a query/path-parameter name fully, the way form decoding reads it
 * (`+` is a space at the first pass), undoing nested escapes so an
 * encoded separator (`api%2Bkey`) still reads as one; a malformed escape
 * (`%zz`) stops the decoding and the name is compared as decoded so far.
 *
 * @param raw The name as written in the URL.
 * @returns The decoded name.
 */
function decodeParamName(raw: string): string {
  let current = raw.replace(/\+/g, ' ');
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      // Malformed escape: compare what decoded cleanly so far.
      return current;
    }
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Whether a valueless query pair reads as a bare secret.
 *
 * @param pair The pair as written (no `=`).
 * @returns True for a long run or a JWT-shaped value.
 */
function isBareToken(pair: string): boolean {
  return pair.length >= BARE_TOKEN_MIN_LENGTH || JWT_SHAPE.test(pair);
}

/**
 * Redact one query pair.
 *
 * @param pair The pair as written (between separators).
 * @returns The pair, its value redacted when its name is sensitive or empty,
 *   or the whole pair redacted when it is a bare token.
 */
function redactQueryPair(pair: string): string {
  const equals = pair.indexOf('=');
  if (equals === -1) return isBareToken(pair) ? REDACTED_PARAM : pair;
  const name = pair.slice(0, equals);
  const decoded = decodeParamName(name);
  return decoded.trim() === '' || isSensitiveName(decoded) ? `${name}=${REDACTED_PARAM}` : pair;
}

/**
 * The exportable form of a page URL: rebuilt from the parsed URL (never the
 * raw string), credentials (`user:pw@`) and fragment dropped, the query
 * kept for support context (e.g. `?nowprocket`) with every pair run through
 * the rule (see the module doc), separators (`&`, `;`) and original
 * encoding kept; `;name=value` path parameters get the same name rule.
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
  url.pathname = url.pathname.replace(/;([^/;=]*)=([^/;]*)/g, (whole, name: string) =>
    isSensitiveName(decodeParamName(name)) ? `;${name}=${REDACTED_PARAM}` : whole
  );
  if (url.search !== '') {
    // Split keeping the separators (odd indexes), so `;`-joined queries
    // round-trip with their own separators.
    url.search = url.search
      .slice(1)
      .split(/([&;])/)
      .map((part, index) => (index % 2 === 1 ? part : redactQueryPair(part)))
      .join('');
  }
  return url.href;
}
