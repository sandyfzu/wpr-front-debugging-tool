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
 * Most characters {@link buildRucssEndpointUrl} adds around the page address:
 * the endpoint and `?url=` before it, then `?`, the seconds (a safe integer:
 * at most 16 digits) and both flags after it.
 */
export const RUCSS_ENDPOINT_URL_OVERHEAD_CHARS =
  `${RUCSS_ENDPOINT}?url=?&mobile&home`.length + String(Number.MAX_SAFE_INTEGER).length;

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
 * Build the request address in the established form: the page address
 * unencoded, then `?<seconds>` even when it already has a query, then the
 * bare `&mobile` / `&home` flags. How the service splits that query is not
 * confirmed: a standard query parser would cut a page address at its second
 * query parameter (`&` reads as a separator), so multi-parameter pages may
 * reach the service truncated.
 *
 * Two parts of the page address are dropped first. The fragment: everything
 * after a `#` never leaves the browser (it would swallow the seconds and both
 * flags), and it never changes a page's CSS. The credentials
 * (`user:password@`): this is a third-party service, and a request address
 * travels into its logs — secrets never go there.
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
  return `${RUCSS_ENDPOINT}?url=${page.href}?${String(query.unixSeconds)}${flags}`;
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
