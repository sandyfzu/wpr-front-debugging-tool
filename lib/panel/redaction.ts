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
 * Exemptions (exact names only, so `author_token` and the like stay
 * redacted): `author` (WordPress's `?author=1` archive id), the cache-key
 * headers (`surrogate-key`, `cache-key`, `x-cache-key` — caching evidence)
 * and `www-authenticate` (a public server challenge).
 *
 * Header values that are URLs ({@link redactHeaderValue}: `location`,
 * `content-location`, `refresh`'s `url=`, every `link` `<…>` target) run
 * through the URL rule below, so a redirect cannot carry a token past it.
 *
 * URLs ({@link redactUrl}): credentials and fragment are dropped; query
 * pairs (split on `&` and `;`) keep their names but lose sensitive values,
 * a value under an empty name is redacted, and a valueless pair that looks
 * like a token (≥ 24 characters, or a JWT-shaped `x.y.z`) is redacted
 * whole. Path segments are out of scope (they are routing, and redacting
 * them would break the URL's support value), except `;name=value` path
 * parameters (`;jsessionid=…`), which get the same name rule.
 *
 * `Set-Cookie` (and the obsolete `Set-Cookie2`) alone keeps the cookie's
 * NAME (which cookie the server set is useful evidence for caching issues);
 * its value and attributes never pass.
 */

import type { HeaderRowVM } from './headers-view-model';

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

/**
 * Exact names exempt from the fragments and words — useful context, never a
 * credential: WordPress's `?author=` archive id, the cache-key headers CDNs
 * and caches emit as caching evidence (`surrogate-key`, `cache-key`,
 * `x-cache-key`), and `www-authenticate`, a public challenge the server
 * sends (it names a scheme and realm; it carries no client secret).
 */
const EXEMPT_NAMES: ReadonlySet<string> = new Set([
  'author',
  'surrogate-key',
  'cache-key',
  'x-cache-key',
  'www-authenticate'
]);

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

/** The `Set-Cookie` header names (lowercase) whose cookie name may be kept. */
const SET_COOKIE_NAMES: ReadonlySet<string> = new Set(['set-cookie', 'set-cookie2']);

/**
 * The cookie name a `Set-Cookie` value sets: the text before `=` in its
 * first segment. Segments end at `;` and at a line break — engines that
 * fold several cookies into one value join them with `\n`, so
 * `SECRET\nname=v` must not read `SECRET\nname` as a name.
 *
 * @param value The raw `Set-Cookie` value.
 * @returns The trimmed, non-empty name, or null when there is none.
 */
function setCookieName(value: string): string | null {
  const first = value.split(/[;\n]/, 1)[0] ?? '';
  const equals = first.indexOf('=');
  const name = equals === -1 ? '' : first.slice(0, equals).trim();
  return name === '' ? null : name;
}

/**
 * The exportable form of one header value.
 *
 * @param name The header name, any casing.
 * @param value The captured value.
 * @returns `{ redacted: false, value }` for an ordinary header — reduced
 *   by {@link reduceHeaderValue} (URL targets, auth challenges); `{ redacted: true,
 *   cookieName }` for a sensitive one, where `cookieName` is the
 *   `Set-Cookie`/`Set-Cookie2` cookie's name when one is well-formed (the
 *   text before `=` within the first `;`/line-break segment, trimmed,
 *   non-empty), else null — a nameless `Set-Cookie: SECRET` keeps nothing.
 */
export function redactHeaderValue(
  name: string,
  value: string
):
  | { readonly redacted: false; readonly value: string }
  | { readonly redacted: true; readonly cookieName: string | null } {
  if (!isSensitiveName(name)) return { redacted: false, value: reduceHeaderValue(name, value) };
  if (!SET_COOKIE_NAMES.has(name.trim().toLowerCase())) return { redacted: true, cookieName: null };
  return { redacted: true, cookieName: setCookieName(value) };
}

/** A header row as a panel surface shows and copies it. */
export interface ShownHeader extends HeaderRowVM {
  /** True when the captured value was withheld (see {@link shownHeader}). */
  readonly redacted: boolean;
}

/**
 * A header row of the shared headers model as every panel surface (the
 * Headers & Cookies page, the Detections preview) may show and copy it. A
 * secret-bearing header keeps its name and loses its whole value —
 * attributes and hint included (a hint can echo the value); a `Set-Cookie`
 * keeps only a well-formed cookie name, which is caching evidence. Other
 * headers keep their value as {@link reduceHeaderValue} leaves it. Valueless
 * rows pass untouched.
 *
 * @param header A row of the shared headers model.
 * @returns The row to render and copy, flagged when its value was withheld.
 */
export function shownHeader(header: HeaderRowVM): ShownHeader {
  if (header.value === null) return { ...header, redacted: false };
  const exported = redactHeaderValue(header.name, header.value);
  if (!exported.redacted) return { ...header, value: exported.value, redacted: false };
  return {
    name: header.name,
    value: exported.cookieName === null ? REDACTED : `${exported.cookieName}=${REDACTED}`,
    hint: null,
    redacted: true
  };
}

/** Headers whose whole value is one URL reference. */
const URL_VALUED_HEADERS: ReadonlySet<string> = new Set([
  'location',
  'content-location',
  'x-redirect-to',
  'x-pingback'
]);

/** An absolute reference's scheme prefix. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** The throwaway base relative references resolve against (never shown). */
const RELATIVE_BASE = 'https://relative.invalid';

/**
 * Reduce one URL reference by the URL rule, keeping its original text when
 * nothing needed reducing (so ordinary redirects read exactly as sent).
 * Relative references keep their own form: a root-relative or
 * protocol-relative one drops what the throwaway base added; a
 * path-relative one (`next?token=…`, `?a=1`) keeps its original path text
 * and only its query is rebuilt (its fragment dropped, as the rule does);
 * a bare fragment (`#top`) stays as written. A non-web absolute reference
 * ({@link redactUrl} answers null for it) and an unparseable one are
 * withheld whole.
 *
 * @param ref The reference as written.
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns The reference, reduced where the rule bites.
 */
function redactUrlReference(ref: string, depth = 1): string {
  const trimmed = ref.trim();
  if (trimmed.startsWith('#')) return ref;
  let resolved: URL;
  try {
    resolved = SCHEME.test(trimmed) ? new URL(trimmed) : new URL(trimmed, RELATIVE_BASE);
  } catch {
    // Unparseable: nothing the rule can vouch for.
    return REDACTED_PARAM;
  }
  const reduced = redactUrlAt(resolved.href, depth);
  if (reduced === null) return REDACTED_PARAM;
  if (reduced === resolved.href) return ref;
  if (SCHEME.test(trimmed)) return reduced;
  if (trimmed.startsWith('//')) return reduced.slice(resolved.protocol.length);
  if (trimmed.startsWith('/')) return reduced.slice(RELATIVE_BASE.length);
  // Path-relative: the original path text, the rebuilt query.
  const pathText = trimmed.split(/[?#]/, 1)[0] ?? '';
  return `${pathText}${new URL(reduced).search}`;
}

/**
 * Reduce a `link` value: every well-formed `<…>` target and every `anchor`
 * parameter through the URL rule, absolute URLs inside any other parameter
 * likewise, and an unterminated `<…` (no closing `>`) withheld whole.
 *
 * @param value The raw `link` value.
 * @returns The reduced value.
 */
function reduceLinkValue(value: string): string {
  const targets = value.replace(
    /<([^<>]*)>/g,
    (_whole, target: string) => `<${redactUrlReference(target)}>`
  );
  const terminated = targets.replace(/<[^>]*$/, `<${REDACTED_PARAM}`);
  return terminated.replace(
    /(;\s*)([\w*-]+)(\s*=\s*)("[^"]*"|[^;,\s]*)/g,
    (whole, lead: string, param: string, equals: string, raw: string) => {
      const quoted = raw.startsWith('"');
      const inner = quoted ? raw.slice(1, -1) : raw;
      const reduced =
        param.toLowerCase() === 'anchor'
          ? redactUrlReference(inner)
          : inner.replace(/https?:\/\/[^\s,"<>]+/gi, (url) => redactUrlReference(url));
      if (reduced === inner) return whole;
      return `${lead}${param}${equals}${quoted ? `"${reduced}"` : reduced}`;
    }
  );
}

/** Challenge schemes whose data is a session-bound blob, never shown. */
const OPAQUE_AUTH_SCHEMES: ReadonlySet<string> = new Set(['negotiate', 'ntlm']);

/**
 * Reduce a `www-authenticate` value to what identifies the challenge: each
 * challenge's scheme and its `realm`; every other parameter (nonces,
 * opaque values) and every token68 blob is dropped, and the session-bound
 * schemes (`Negotiate`, `NTLM`) keep only their name plus the redaction
 * marker when they carried data.
 *
 * @param value The raw `www-authenticate` value.
 * @returns The reduced value.
 */
function reduceAuthChallenge(value: string): string {
  // Split on commas outside quotes: challenges and their parameters.
  const parts = value.match(/(?:[^,"]|"(?:[^"\\]|\\.)*")+/g) ?? [];
  const challenges: { scheme: string; realm: string | null; data: boolean }[] = [];
  for (const rawPart of parts) {
    // A blank part (`a, , b`) matches nothing below and adds nothing.
    const part = rawPart.trim();
    const opening = /^([A-Za-z][\w!#$%&'*+.^`|~-]*)(?:\s+(.*))?$/s.exec(part);
    const startsChallenge = opening !== null && !/^[\w!#$%&'*+.^`|~-]+\s*=/.test(part);
    if (startsChallenge) challenges.push({ scheme: opening[1] ?? '', realm: null, data: false });
    const current = challenges.at(-1);
    if (current === undefined) continue;
    const param = startsChallenge ? (opening[2] ?? '') : part;
    if (param === '') continue;
    current.data = true;
    const realm = /^realm\s*=\s*("(?:[^"\\]|\\.)*"|[^\s]+)$/i.exec(param.trim());
    if (realm !== null) current.realm = realm[1] ?? null;
  }
  return challenges
    .map(({ scheme, realm, data }) => {
      if (OPAQUE_AUTH_SCHEMES.has(scheme.toLowerCase())) {
        return data ? `${scheme} ${REDACTED}` : scheme;
      }
      return realm === null ? scheme : `${scheme} realm=${realm}`;
    })
    .join(', ');
}

/**
 * Reduce an ordinary (non-secret-named) header value by what it can carry:
 * the URL targets of `location`/`content-location`/`x-redirect-to`/
 * `x-pingback`, `refresh`'s target (with or without a delay), `link`'s
 * targets and URL-valued parameters, and `www-authenticate`'s challenges
 * (scheme + realm only). Other headers pass untouched.
 *
 * @param name The header name, any casing.
 * @param value The captured value.
 * @returns The reduced value.
 */
export function reduceHeaderValue(name: string, value: string): string {
  const lower = name.trim().toLowerCase();
  if (URL_VALUED_HEADERS.has(lower)) return redactUrlReference(value);
  if (lower === 'link') return reduceLinkValue(value);
  if (lower === 'www-authenticate') return reduceAuthChallenge(value);
  if (lower === 'refresh') {
    return value.replace(
      /^(\s*(?:[\d.]+\s*(?:[;,]\s*)?)?(?:url\s*=\s*)?)(['"]?)(.*?)\2(\s*)$/i,
      (_whole, lead: string, quote: string, target: string, tail: string) =>
        `${lead}${quote}${redactUrlReference(target)}${quote}${tail}`
    );
  }
  return value;
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
 * Redact one query pair. A value under an ordinary name that decodes to an
 * absolute http(s) URL (`redirect_to=https%3A%2F%2F…%3Ftoken%3D…`) is
 * itself reduced by the URL rule — once: `depth` bounds the recursion.
 *
 * @param pair The pair as written (between separators).
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns The pair, its value redacted when its name is sensitive or empty,
 *   its embedded URL reduced, or the whole pair redacted when it is a bare
 *   token.
 */
function redactQueryPair(pair: string, depth: number): string {
  const equals = pair.indexOf('=');
  if (equals === -1) return isBareToken(pair) ? REDACTED_PARAM : pair;
  const name = pair.slice(0, equals);
  const decoded = decodeParamName(name);
  if (decoded.trim() === '' || isSensitiveName(decoded)) return `${name}=${REDACTED_PARAM}`;
  if (depth <= 0) return pair;
  const value = decodeParamName(pair.slice(equals + 1));
  const reduced = redactUrlAt(value, depth - 1);
  if (reduced === null || reduced === new URL(value).href) return pair;
  return `${name}=${encodeURIComponent(reduced)}`;
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
  return redactUrlAt(raw, 1);
}

/**
 * {@link redactUrl} with an explicit bound on following URLs nested in
 * query values.
 *
 * @param raw The untrusted URL text.
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns As {@link redactUrl}.
 */
function redactUrlAt(raw: string, depth: number): string | null {
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
      .map((part, index) => (index % 2 === 1 ? part : redactQueryPair(part, depth)))
      .join('');
  }
  return url.href;
}
