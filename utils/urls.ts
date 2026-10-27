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
  const url = parseUrl(raw);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
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
  const url = parseUrl(raw);
  return (
    url !== null && (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === raw
  );
}
