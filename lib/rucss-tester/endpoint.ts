/**
 * The WP Rocket support service that runs Remove Unused CSS on demand for a
 * public page: its fixed address, the query it is sent and the request it
 * takes. Only these builders produce a request to it, and the address is a
 * constant, so a caller can never point the request elsewhere.
 */
import { parseHttpUrl } from '../../utils/urls';

/** The service address (fixed; never derived from input). */
export const RUCSS_ENDPOINT = 'https://mega.wp-rocket.me/support/wpr-rucss-v2.php';

/**
 * Most characters {@link buildRucssEndpointUrl} adds around the encoded page
 * address: the endpoint and `?url=` before it, then the longest seconds
 * joiner (`%26`), the seconds (a safe integer: at most 16 digits) and both
 * flags after it.
 */
export const RUCSS_ENDPOINT_URL_OVERHEAD_CHARS =
  `${RUCSS_ENDPOINT}?url=%26&mobile&home`.length + String(Number.MAX_SAFE_INTEGER).length;

/** Most characters encoding writes per page-address character (`%XX`). */
export const RUCSS_PAGE_URL_ENCODED_GROWTH = 3;

/**
 * What a test sends, for the run trigger's disclosure: only on the user's
 * start, the page address (minus fragment and credentials), the two flags
 * and the safelist — never page content.
 */
export const RUCSS_REQUEST_DISCLOSURE =
  "Starting a test sends this page's address, the Mobile and Home choices and your safelist to WP Rocket's RUCSS service (mega.wp-rocket.me). No page content is sent.";

/** What one request asks the service. */
export interface RucssEndpointQuery {
  /** The tested page (absolute `http:`/`https:` URL). */
  readonly pageUrl: string;
  /** Request time in Unix seconds — makes every request's page address unique (no service-side cache hit). */
  readonly unixSeconds: number;
  /** Ask for the mobile variant. */
  readonly mobile: boolean;
  /** Treat the page as the home page. */
  readonly home: boolean;
}

/**
 * Unix seconds of an epoch-ms instant (floored).
 *
 * @param epochMs The instant, e.g. `Date.now()`.
 * @returns Whole seconds since the Unix epoch.
 * @throws {@link RangeError} when `epochMs` is not a finite non-negative number.
 */
export function toUnixSeconds(epochMs: number): number {
  if (!Number.isFinite(epochMs) || epochMs < 0) {
    throw new RangeError(`Not an epoch-ms instant: ${String(epochMs)}`);
  }
  return Math.floor(epochMs / 1000);
}

/**
 * How the seconds join the encoded page address, inside the `url` value, so
 * the page address the service fetches is unique per request without
 * changing any of the page's own parameters:
 *
 * - no query: a literal `?` — the page address gains the query `?<seconds>`;
 * - a query: an encoded `&` (`%26`; a literal one would end the `url`
 *   value) — the seconds become one more, valueless parameter, never part
 *   of the page's last value (`lang=fr?<seconds>` would ask for another page);
 * - a bare trailing `?` (an empty query: no parameter to change): nothing —
 *   its `?` already opens the query, as in the no-query form.
 *
 * Decoded, the `url` value is the page address plus `?<seconds>`,
 * `&<seconds>` or `<seconds>` respectively.
 *
 * Decided from the parsed query, never from the href's last character: a
 * non-empty query may itself end in a raw `?` (`?q=what?`, `??`).
 *
 * @param page The parsed page address, fragment removed (so a trailing `?`
 *   in its href can only be an empty query's opener).
 */
function secondsJoiner(page: URL): '?' | '%26' | '' {
  if (page.search !== '') return '%26';
  // `search` is '' both without a query and for an empty one (`/p?`).
  return page.href.endsWith('?') ? '' : '?';
}

/**
 * Build the request address: the page address as one encoded `url` value,
 * then the seconds joined to it ({@link secondsJoiner}: each request's page
 * address is unique), then the bare `&mobile` / `&home` flags. Encoded
 * because the service
 * splits its query as standard parameters: a raw page address was cut at
 * its own `&` (a multi-parameter page was tested as its first parameter
 * only — verified against the live service), and a page parameter named
 * `mobile` or `home` would have set that flag.
 *
 * Two parts of the page address are dropped first. The fragment: everything
 * after a `#` never leaves the browser, and it never changes a page's CSS.
 * The credentials (`user:password@`): this is a third-party service, and a
 * request address travels into its logs — secrets never go there.
 *
 * @param query The page and flags.
 * @returns The full request address.
 * @throws {@link RangeError} when `pageUrl` is not an absolute HTTP(S) URL or
 *   `unixSeconds` is not a non-negative safe integer.
 */
export function buildRucssEndpointUrl(query: RucssEndpointQuery): string {
  const page = parseHttpUrl(query.pageUrl);
  // The address is never echoed: it may carry credentials, and messages reach logs.
  if (page === null) throw new RangeError('The page URL is not an absolute HTTP(S) URL');
  if (!Number.isSafeInteger(query.unixSeconds) || query.unixSeconds < 0) {
    throw new RangeError(`Not a Unix-seconds time: ${String(query.unixSeconds)}`);
  }
  page.hash = '';
  page.username = '';
  page.password = '';
  const flags = `${query.mobile ? '&mobile' : ''}${query.home ? '&home' : ''}`;
  const seconds = `${secondsJoiner(page)}${String(query.unixSeconds)}`;
  return `${RUCSS_ENDPOINT}?url=${encodeURIComponent(page.href)}${seconds}${flags}`;
}

/**
 * The request options: a JSON POST whose body is `{ safelist }` when there
 * are safelist entries and `{}` otherwise, following redirects. The caller
 * adds its abort signal.
 *
 * @param safelist The parsed safelist entries.
 * @returns Fresh `fetch` options.
 */
export function buildRucssRequestInit(safelist: readonly string[]): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(safelist.length > 0 ? { safelist } : {}),
    redirect: 'follow'
  };
}
