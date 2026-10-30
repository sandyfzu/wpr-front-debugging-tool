/**
 * The URL a browser requests for a parser-inserted script (pure), before
 * any CSP check (observed on Chromium 156 / Firefox 155, both alike):
 *
 * - `upgrade-insecure-requests` upgrades an `http` URL to `https` (port
 *   `80` → the `https` default, any other port kept), on any host but a
 *   potentially trustworthy one (`localhost`, `*.localhost`, `127.0.0.0/8`,
 *   `[::1]`), which is requested as written.
 * - Otherwise an `https` page never loads an `http` script from such a
 *   host: mixed content, blocked before the request (an `http` page, even
 *   `http://localhost`, loads it).
 */

/** A dotted-quad loopback address (a URL parser's IPv4 serialization). */
const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** `localhost` or a subdomain of it, an optional trailing dot. */
const LOCALHOST_NAME = /(?:^|\.)localhost\.?$/;

/** The IPv6 loopback address as a URL serializes it. */
const LOOPBACK_IPV6 = '[::1]';

/** Why a script URL is never requested. */
export type ScriptRequestRefusal = 'mixed-content';

/**
 * Whether browsers treat an `http` host as potentially trustworthy (never
 * upgraded, never mixed content).
 *
 * @param hostname A URL's hostname (as serialized: lowercase, IPv6 bracketed).
 */
export function isPotentiallyTrustworthyHost(hostname: string): boolean {
  return (
    hostname === LOOPBACK_IPV6 || LOOPBACK_IPV4.test(hostname) || LOCALHOST_NAME.test(hostname)
  );
}

/**
 * A URL's `https` twin: same host, path, query; port `80` (the `http`
 * default) becomes the `https` default, any other is kept.
 *
 * @param url An `http` URL.
 * @returns The twin (a new URL).
 */
export function httpsTwin(url: URL): URL {
  const twin = new URL(url.href);
  // The protocol setter drops a port that is the new scheme's default (`:443`).
  twin.protocol = 'https:';
  return twin;
}

/**
 * The URL a page requests for a script written at `url`.
 *
 * @param url The script's URL as written.
 * @param page The document's URL.
 * @param upgradeInsecure An enforced policy of the page has `upgrade-insecure-requests`.
 * @returns The requested URL (the written one when not upgraded), or why none is requested.
 */
export function scriptRequestUrl(
  url: URL,
  page: URL,
  upgradeInsecure: boolean
): URL | ScriptRequestRefusal {
  if (url.protocol !== 'http:' || isPotentiallyTrustworthyHost(url.hostname)) return url;
  if (upgradeInsecure) return httpsTwin(url);
  return page.protocol === 'https:' ? 'mixed-content' : url;
}
