/**
 * The redaction rule for anything secret-bearing the extension captures or
 * hands out (the background's header capture, a copied report, a ticket, an
 * export): which NAMES mark a secret — header names and URL query-parameter
 * names share one rule — and how a header value or a URL is reduced. The ONE
 * declaring site: every capture and export path runs its values through
 * {@link redactHeaderValue} / {@link redactUrl} / {@link redactUrlReference}.
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
 * - **whole words** (`-`/`_`/space-separated or camelCase humps, so
 *   `signal`, `turnkey` or `postcode` pass while `userEmail` and
 *   `licenseKey` do not) — `pass`, `sig`, `sid`, `ticket`, `otp`, `hash`,
 *   `salt`, the personal-data names `email` and `login` (`user_login`), and
 *   a trailing `key` (`X-Access-Key`; an unlisted cache key over-matches,
 *   which is acceptable); plus the PKCE `code_verifier`.
 *
 * Exemptions (exact names only, so `author_token` and the like stay
 * redacted): `author` (WordPress's `?author=1` archive id), the cache-key
 * headers (`surrogate-key`, `cache-key`, `x-cache-key` — caching evidence),
 * `www-authenticate` (a public server challenge) and WP Rocket's
 * `minify_css_key`/`minify_js_key` (a file-name cache-busting stamp).
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
 * Matched against the normalised name ({@link normalizeName}).
 */
const SENSITIVE_NAME_FRAGMENT =
  /token|secret|session|auth|nonce|signature|api[-_]?key|csrf|xsrf|passw(?:or)?d|credential|jwt|hmac|bearer|private|pwd|code[-_]verifier|(?:^|[-_])(?:pass|sig|sid|ticket|otp|hash|email|login|salt)(?:[-_]|$)|(?:^|[-_])key$/;

/**
 * Exact names exempt from the fragments and words — useful context, never a
 * credential: WordPress's `?author=` archive id, the cache-key headers CDNs
 * and caches emit as caching evidence (`surrogate-key`, `cache-key`,
 * `x-cache-key`), `www-authenticate`, a public challenge the server sends
 * (it names a scheme and realm; it carries no client secret), and WP
 * Rocket's `minify_css_key`/`minify_js_key` options — a `uniqid()` salt for
 * minified file names, regenerated on purge: a cache-busting stamp support
 * compares across purges, not a credential. Compared in the normalised form
 * too, so `cacheKey`-style spellings are exempt alike.
 */
const EXEMPT_NAMES: ReadonlySet<string> = new Set([
  'author',
  'surrogate-key',
  'cache-key',
  'x-cache-key',
  'www-authenticate',
  'minify_css_key',
  'minify_js_key'
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
 * A name in the word-separated form the fragments and words match: camelCase
 * humps (`accessKey`, `APIKey`) and letter/digit boundaries (`key2`) split
 * with `-` BEFORE lowercasing (or `userEmail` would read as one word),
 * whitespace and `+` read as `-` (`api key`, `api+key`).
 *
 * @param name The trimmed name, original casing.
 * @returns The lowercase, `-`-split form.
 */
function normalizeName(name: string): string {
  return name
    .replace(/([a-z])(?=[A-Z])|([A-Z])(?=[A-Z][a-z])/g, '$1$2-')
    .replace(/([A-Za-z])(?=\d)|(\d)(?=[A-Za-z])/g, '$1$2-')
    .toLowerCase()
    .replace(/[\s+]+/g, '-');
}

/**
 * Whether a header or query-parameter name marks its value as secret.
 *
 * @param name The (decoded) name, any casing; camelCase humps, digits,
 *   inner whitespace and `+` count as word separators.
 * @returns True for the exact names and any name carrying a fragment or
 *   word, except the exempt names.
 */
export function isSensitiveName(name: string): boolean {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  if (SENSITIVE_EXACT_NAMES.has(lower)) return true;
  const normalized = normalizeName(trimmed);
  if (EXEMPT_NAMES.has(lower) || EXEMPT_NAMES.has(normalized)) return false;
  return SENSITIVE_NAME_FRAGMENT.test(normalized);
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
 * a bare fragment keeps its plain anchor and loses its sensitive pair values
 * (`#access_token=…`). A non-web absolute reference
 * ({@link redactUrl} answers null for it) and an unparseable one are
 * withheld whole.
 *
 * @param ref The reference as written.
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns The reference, reduced where the rule bites.
 */
export function redactUrlReference(ref: string, depth = 1): string {
  const trimmed = ref.trim();
  // A bare fragment has no URL to rebuild: its pairs get the pair rule
  // (`#access_token=…` → redacted; a plain anchor `#top` stays).
  if (trimmed.startsWith('#')) {
    const reduced = `#${redactPairs(trimmed.slice(1), depth)}`;
    return reduced === trimmed ? ref : reduced;
  }
  let resolved: URL;
  try {
    resolved = SCHEME.test(trimmed) ? new URL(trimmed) : new URL(trimmed, RELATIVE_BASE);
  } catch {
    // Unparseable: nothing the rule can vouch for.
    return REDACTED_PARAM;
  }
  // One parse serves both the rule and the comparison (the rule mutates
  // the parsed URL in place, so its pre-rule `href` is read first).
  const original = resolved.href;
  const reduced = reduceParsedUrl(resolved, depth);
  if (reduced === null) return REDACTED_PARAM;
  if (reduced === original) return ref;
  if (SCHEME.test(trimmed)) return reduced;
  if (trimmed.startsWith('//')) return reduced.slice(resolved.protocol.length);
  if (trimmed.startsWith('/')) return reduced.slice(RELATIVE_BASE.length);
  // Path-relative: the original path text (its `;name=value` parameters
  // through the same rule), the rebuilt query.
  const pathText = trimmed.split(/[?#]/, 1)[0] ?? '';
  return `${redactPathParams(pathText)}${new URL(reduced).search}`;
}

/**
 * Reduce one `link` parameter value: `anchor` is a URL reference; an RFC
 * 8187 extended value (`title*=UTF-8''…`) is decoded, reduced and
 * re-encoded; any other value has its absolute URLs reduced.
 *
 * @param param The parameter name as written.
 * @param inner The value, unquoted.
 * @returns The reduced value (the same string when nothing changed).
 */
function reduceLinkParam(param: string, inner: string): string {
  if (param.toLowerCase() === 'anchor') return redactUrlReference(inner);
  const extended = param.endsWith('*') ? /^([^']*)'([^']*)'(.*)$/.exec(inner) : null;
  if (extended !== null) {
    const decoded = decodeParamName(extended[3] ?? '');
    const reduced = reduceAbsoluteUrls(decoded);
    return reduced === decoded
      ? inner
      : `${extended[1] ?? ''}'${extended[2] ?? ''}'${encodeURIComponent(reduced)}`;
  }
  return reduceAbsoluteUrls(inner);
}

/**
 * Reduce every absolute http(s) URL inside free text.
 *
 * @param text The text.
 * @returns The text with each URL reduced by the URL rule.
 */
function reduceAbsoluteUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s,;"<>]+/gi, (url) => redactUrlReference(url));
}

/**
 * Reduce a `link` value: every well-formed `<…>` target, every parameter
 * value (see {@link reduceLinkParam}), and an unterminated `<…` (no closing
 * `>`) withheld whole. A malformed value written without `<…>` at all has
 * the leading target of each comma-separated link run through the URL rule.
 *
 * @param value The raw `link` value.
 * @returns The reduced value.
 */
function reduceLinkValue(value: string): string {
  const targets = value.includes('<')
    ? value
        .replace(/<([^<>]*)>/g, (_whole, target: string) => `<${redactUrlReference(target)}>`)
        .replace(/<[^>]*$/, `<${REDACTED_PARAM}`)
    : value
        .split(',')
        .map((link) =>
          // A blank target stays blank: the rule hands an empty reference back.
          link.replace(
            /^(\s*)([^;]*)/,
            (_whole, lead: string, target: string) => `${lead}${redactUrlReference(target)}`
          )
        )
        .join(',');
  return targets.replace(
    /(;\s*)([\w*-]+)(\s*=\s*)("[^"]*"|[^;,\s]*)/g,
    (whole, lead: string, param: string, equals: string, raw: string) => {
      const quoted = raw.startsWith('"');
      const inner = quoted ? raw.slice(1, -1) : raw;
      const reduced = reduceLinkParam(param, inner);
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
export function decodeParamName(raw: string): string {
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
 * Whether text can parse as an http(s) URL, read the way the URL parser
 * reads a scheme: leading C0 controls and spaces stripped, tabs and line
 * breaks ignored anywhere. A false answer is exact (the parser would not
 * yield an http(s) URL either), so callers may skip the parse.
 *
 * @param text The candidate text.
 * @returns False only when the text cannot be an absolute http(s) URL.
 */
function looksLikeWebUrl(text: string): boolean {
  return /^[\u0000-\u0020]*https?:/i.test(text.replace(/[\t\n\r]/g, ''));
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
  // Only an http(s) URL is followed: skip the (throwing, slow) parse for the
  // ordinary values (`ver=1.2`) that make up nearly every query.
  if (!looksLikeWebUrl(value)) return pair;
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
  return reduceParsedUrl(url, depth);
}

/**
 * Apply the URL rule to an already parsed URL, in place. Each part is
 * written back only when the rule changed it — a setter re-serializes, and
 * skipping the no-op ones keeps long lists of ordinary URLs cheap.
 *
 * @param url The parsed URL (mutated).
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns The reduced `href`, or null when it is not an http(s) URL.
 */
function reduceParsedUrl(url: URL, depth: number): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '') url.username = '';
  if (url.password !== '') url.password = '';
  // Unconditional: an empty fragment (`#`) reads back as '' yet serializes.
  url.hash = '';
  const path = redactPathParams(url.pathname);
  if (path !== url.pathname) url.pathname = path;
  const query = url.search.slice(1);
  if (query !== '') {
    const reducedQuery = redactPairs(query, depth);
    if (reducedQuery !== query) url.search = reducedQuery;
  }
  return url.href;
}

/**
 * Run a path's `;name=value` parameters (`;jsessionid=…`) through the name
 * rule.
 *
 * @param path The path text as written.
 * @returns The path with sensitive parameter values redacted.
 */
function redactPathParams(path: string): string {
  return path.replace(/;([^/;=]*)=([^/;]*)/g, (whole, name: string) =>
    isSensitiveName(decodeParamName(name)) ? `;${name}=${REDACTED_PARAM}` : whole
  );
}

/**
 * Run a `&`/`;`-separated list of pairs (a query, or a fragment written
 * like one) through the pair rule, keeping each separator as written.
 *
 * @param pairs The pairs text, without its leading `?`/`#`.
 * @param depth How many URL-in-a-parameter levels may still be followed.
 * @returns The pairs with sensitive values (and bare tokens) redacted.
 */
function redactPairs(pairs: string, depth: number): string {
  // Split keeping the separators (odd indexes).
  return pairs
    .split(/([&;])/)
    .map((part, index) => (index % 2 === 1 ? part : redactQueryPair(part, depth)))
    .join('');
}
