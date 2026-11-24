/**
 * Parse a URL string, tolerating invalid input.
 *
 * @param raw The URL string to parse; WHATWG parsing rules apply (leading/trailing
 *   whitespace is ignored, percent-encoding stays encoded).
 * @returns The parsed URL, or `null` when `raw` is not an absolute URL — callers
 *   branch on `null` instead of catching.
 */
export function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Parse a URL string, keeping it only when it is a plain HTTP(S) URL.
 *
 * The parsed form of the {@link isHttpUrl} gate, for callers that go on to use
 * the URL (no second parse, no second scheme check).
 *
 * @param raw The URL string to parse.
 * @returns The parsed URL when `raw` is an absolute `http:`/`https:` URL (scheme
 *   case-insensitive), otherwise `null`.
 */
export function parseHttpUrl(raw: string): URL | null {
  const url = parseUrl(raw);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:') ? url : null;
}

/**
 * Resolve a page-captured URL (an attribute as written: relative,
 * protocol-relative or absolute) against the page's base URL, keeping it
 * only when the result is a plain HTTP(S) URL. Pure string work — nothing is
 * fetched.
 *
 * @param raw The URL as captured.
 * @param base The page's base URL (`document.baseURI`); only an HTTP(S) base resolves.
 * @returns The absolute `http:`/`https:` href, or `null` (no usable base, or
 *   a result of another scheme or unparsable).
 */
export function resolveHttpUrl(raw: string, base: string | null): string | null {
  if (base === null || parseHttpUrl(base) === null) return null;
  try {
    const url = new URL(raw, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Check whether a URL string points at a plain HTTP(S) resource.
 *
 * Gate for anything the extension opens or fetches (Known Conflicts links, resource
 * URLs, page targets): schemes like `javascript:`, `data:` or `chrome-extension:`
 * must never flow into link/fetch contexts.
 *
 * @param raw The URL string to test.
 * @returns `true` only when `raw` is an absolute `http:` or `https:` URL (scheme case-insensitive).
 */
export function isHttpUrl(raw: string): boolean {
  return parseHttpUrl(raw) !== null;
}

/**
 * Check whether a string is a serialized HTTP(S) origin — exactly what
 * `new URL(page).origin` yields (`https://host[:port]`, lower-cased host, no
 * default port, no path/query/fragment).
 *
 * Gate for per-origin keys read back from untrusted storage: anything that is
 * not its own canonical origin (a full URL, a trailing slash, `null` origins,
 * other schemes) is not a key any writer could have produced.
 *
 * @param raw The candidate origin string.
 * @returns `true` only when `raw` is an `http:`/`https:` origin in canonical form.
 */
export function isHttpOrigin(raw: string): boolean {
  return parseHttpUrl(raw)?.origin === raw;
}

/**
 * A base for resolving a relative URL when only its path matters (shape
 * checks, never a request). `.invalid` is reserved (RFC 2606), so it can
 * never name a real host; `https:` makes every relative form resolve to an
 * http(s) URL — a protocol-relative one keeps its own host and path.
 */
export const PLACEHOLDER_BASE_URL = 'https://document.invalid/';

/**
 * The `window.open` features for every link a content script opens in a new
 * tab: no `opener` handle back into the page being debugged, and no
 * `Referer` — the page's address (a support inbox's conversation, a private
 * staging site) stays off the destination's logs.
 */
export const NEW_TAB_FEATURES = 'noopener,noreferrer';
