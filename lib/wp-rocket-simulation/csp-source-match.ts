/**
 * Whether a CSP source list allows a script URL (pure): CSP Level 3
 * "does url match source list in origin" for a request that was not
 * redirected, as Chromium and Firefox apply it (observed on Chromium 156 /
 * Firefox 155, where they leave the spec):
 *
 * - `*` matches an http(s) URL, or one of the document's scheme.
 * - A scheme source (`https:`) matches its scheme, `http:` also `https:`
 *   (`ws:`/`wss:` never match an http(s) URL, though CSP3 lets them).
 * - A host source (`[scheme://]host[:port][/path]`): its scheme (or, with
 *   none, the document's) must match the URL's as above; its host matches
 *   exactly (ASCII-caseless, an IPv4 address included), `*` any host,
 *   `*.suffix` a domain ending in `.suffix` (never an IP address); a host
 *   with characters outside letters, digits, `-` and `.`, or in brackets,
 *   makes the source invalid. No port: the scheme's default port only;
 *   `*`: any; a number: on Chromium, with the scheme upgraded (`http`
 *   source, or none on an `http` document, and an `https` URL), only `80`
 *   or `443` for the default `https` port (`http://host:8080` never
 *   admits `https://host:8080`), else that effective port; on Firefox that
 *   effective port, or `80` the default `https` port — written with a
 *   leading zero (`:0443`), never (Chromium reads it as the number). A path ending in
 *   `/` is a segment prefix, any other path exact, segments compared
 *   percent-decoded and case-sensitively; a `?…`/`#…` after the path is
 *   dropped — on Firefox also right after the host or port (Chromium
 *   then drops the source).
 * - `'self'` matches the document's origin, or its host on the same port
 *   (or both on default ports) when the URL is `https` or both are `http`
 *   (the WebSocket half of the rule never applies to a script URL).
 * - Firefox, under a policy with `upgrade-insecure-requests`: an `http`
 *   URL also matches where its `https` twin's scheme would (scheme
 *   sources, host sources' schemes, `'self'`); its port stays its own.
 * - Anything else (keywords, nonces, hashes) matches no URL — so an empty
 *   list or `'none'` alone matches nothing.
 */
import type { SimulationCspBrowser } from './spec';

/** A host source: `[scheme://]host[:port][/path][?…|#…]` (host chars: letters, digits, `-`, `.`). */
const HOST_SOURCE =
  /^(?:([A-Za-z][A-Za-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.?)(?::([0-9]+|\*))?(?:(\/[^?#]*)(?:[?#].*)?)?$/;

/** A scheme source: `scheme:`. */
const SCHEME_SOURCE = /^([A-Za-z][A-Za-z0-9+.-]*):$/;

/** A dotted-quad host (a URL parser's IPv4 serialization). */
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Default ports per special scheme (a URL serializes them as no port). */
const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  'http:': 80,
  'https:': 443,
  'ws:': 80,
  'wss:': 443
};

/** A port written with a leading zero (Firefox: the source never matches). */
const LEADING_ZERO_PORT = /^0\d/;

/** A query or fragment and everything after it. */
const QUERY_OR_FRAGMENT = /[?#].*$/s;

/**
 * Whether a source scheme admits a URL scheme: equal, or `http` upgraded
 * to `https` — CSP3 also lets `ws:`/`wss:` admit http(s), which neither
 * engine does (observed: `ws:`, `wss:`, `ws://host`, `wss://host` block an
 * `https` script).
 *
 * @param source The source's scheme, without `:` (any case).
 * @param url The URL's scheme, without `:` (lowercase).
 * @param upgradeAsHttps An `http` URL also matches as `https` (Firefox under `upgrade-insecure-requests`).
 */
export function schemePartMatches(source: string, url: string, upgradeAsHttps = false): boolean {
  const lower = source.toLowerCase();
  if (lower === url || (lower === 'http' && url === 'https')) return true;
  return upgradeAsHttps && lower === 'https' && url === 'http';
}

/**
 * A URL's scheme without its `:`.
 *
 * @param url The URL.
 */
function schemeOf(url: URL): string {
  return url.protocol.slice(0, -1);
}

/**
 * A URL's effective port (its default when it serializes none).
 *
 * @param url The URL.
 * @returns The port, or null for a scheme without a default.
 */
function effectivePort(url: URL): number | null {
  return url.port === '' ? (DEFAULT_PORTS[url.protocol] ?? null) : Number(url.port);
}

/**
 * Whether a host part admits a URL's host.
 *
 * @param pattern The source's host part.
 * @param host The URL's host (as serialized: lowercase, IPv6 bracketed).
 */
function hostPartMatches(pattern: string, host: string): boolean {
  if (pattern === '*') return true;
  const lower = pattern.toLowerCase();
  if (lower.startsWith('*.')) {
    const isDomain = !IPV4_HOST.test(host) && !host.startsWith('[');
    return isDomain && host.endsWith(lower.slice(1));
  }
  return lower === host;
}

/**
 * Whether a source's port admits a URL (see the module doc for the
 * upgraded-scheme rule and leading zeros per engine).
 *
 * @param port The source's port part (undefined: none).
 * @param url The URL.
 * @param upgraded The source's scheme (or the document's) is `http` and the URL's `https`.
 * @param browser The engine.
 */
function portPartMatches(
  port: string | undefined,
  url: URL,
  upgraded: boolean,
  browser: SimulationCspBrowser
): boolean {
  if (port === undefined) return url.port === '';
  if (port === '*') return true;
  const wanted = Number(port);
  const actual = effectivePort(url);
  if (browser === 'chromium') {
    return upgraded ? actual === 443 && (wanted === 80 || wanted === 443) : wanted === actual;
  }
  if (LEADING_ZERO_PORT.test(port)) return false;
  return wanted === actual || (wanted === 80 && url.protocol === 'https:' && url.port === '');
}

/**
 * A path piece percent-decoded (a malformed `%` kept), as one code unit per byte.
 *
 * @param piece The piece.
 */
function percentDecoded(piece: string): string {
  return piece.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );
}

/**
 * CSP3 "path-part matching": a source path against a URL path.
 *
 * @param source The source's path (non-empty).
 * @param path The URL's serialized path.
 */
export function pathPartMatches(source: string, path: string): boolean {
  if (source === '/' && path === '') return true;
  const exact = !source.endsWith('/');
  const sourcePieces = source.split('/');
  const pathPieces = path.split('/');
  if (sourcePieces.length > pathPieces.length) return false;
  if (exact && sourcePieces.length !== pathPieces.length) return false;
  if (!exact) sourcePieces.pop();
  return sourcePieces.every(
    (piece, at) => percentDecoded(piece) === percentDecoded(pathPieces[at] ?? '')
  );
}

/**
 * Whether `'self'` admits a URL.
 *
 * @param url The URL.
 * @param self The document's URL.
 * @param upgradeAsHttps An `http` URL also matches as `https`.
 */
function selfMatches(url: URL, self: URL, upgradeAsHttps: boolean): boolean {
  if (url.origin === self.origin) return true;
  if (url.hostname !== self.hostname || url.port !== self.port) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (self.protocol === 'http:' || upgradeAsHttps);
}

/**
 * Whether a host source admits a URL.
 *
 * @param source The source's parts.
 * @param url The URL.
 * @param self The document's URL.
 * @param browser The engine.
 * @param upgradeAsHttps An `http` URL also matches as `https` (its port stays its own).
 */
function hostSourceMatches(
  source: RegExpExecArray,
  url: URL,
  self: URL,
  browser: SimulationCspBrowser,
  upgradeAsHttps: boolean
): boolean {
  const [, scheme, host = '', port, path] = source;
  const urlScheme = schemeOf(url);
  const sourceScheme = scheme ?? schemeOf(self);
  if (!schemePartMatches(sourceScheme, urlScheme, upgradeAsHttps)) return false;
  if (!hostPartMatches(host, url.hostname)) return false;
  const upgraded = sourceScheme.toLowerCase() === 'http' && urlScheme === 'https';
  if (!portPartMatches(port, url, upgraded, browser)) return false;
  return path === undefined || path === '' || pathPartMatches(path, url.pathname);
}

/**
 * Whether one source expression admits a URL.
 *
 * @param token The expression as written.
 * @param url The URL.
 * @param self The document's URL.
 * @param browser The engine.
 * @param upgradeAsHttps An `http` URL also matches as `https`.
 */
function expressionMatches(
  token: string,
  url: URL,
  self: URL,
  browser: SimulationCspBrowser,
  upgradeAsHttps: boolean
): boolean {
  if (token === '*') {
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === self.protocol;
  }
  if (token.toLowerCase() === "'self'") return selfMatches(url, self, upgradeAsHttps);
  const scheme = SCHEME_SOURCE.exec(token);
  if (scheme !== null) return schemePartMatches(scheme[1] ?? '', schemeOf(url), upgradeAsHttps);
  const host = HOST_SOURCE.exec(
    browser === 'firefox' ? token.replace(QUERY_OR_FRAGMENT, '') : token
  );
  return host !== null && hostSourceMatches(host, url, self, browser, upgradeAsHttps);
}

/**
 * Whether a source list admits a URL fetched without a redirect.
 *
 * @param list The list's tokens as written.
 * @param url The URL as the engine checks it.
 * @param self The document's URL (its origin is the policy's).
 * @param browser The engine.
 * @param upgradeAsHttps Firefox under a policy with `upgrade-insecure-requests`: an `http` URL also matches as `https`.
 */
export function sourceListAllowsUrl(
  list: readonly string[],
  url: URL,
  self: URL,
  browser: SimulationCspBrowser,
  upgradeAsHttps = false
): boolean {
  return list.some((token) => expressionMatches(token, url, self, browser, upgradeAsHttps));
}
