/**
 * The consent page's address: which tool asked and, for PageSpeed Insights,
 * the analysis address to continue to once allowed. The background builds
 * it; the page parses it back (its query is a boundary like any other).
 */
import { isPsiHost } from '../side-by-side/analysis-host';
import { parseUrl } from '../../utils/urls';
import { isDataConsentFeature, type DataConsentFeature } from './consent';

/** The consent page's path in the extension (Firefox build only). */
export const DATA_CONSENT_PAGE_PATH = '/data-consent.html';

/** The longest continue address accepted (a page address in a PageSpeed query). */
export const DATA_CONSENT_NEXT_MAX_CHARS = 8_192;

/** What the consent page was opened for. */
export interface DataConsentPageQuery {
  readonly feature: DataConsentFeature;
  /** Where to go once allowed (PageSpeed Insights only), or null. */
  readonly next: string | null;
}

/**
 * Whether an address is a PageSpeed Insights page the consent may continue
 * to: https on the analysis host, within {@link DATA_CONSENT_NEXT_MAX_CHARS}.
 *
 * @param raw The address.
 */
export function isPageSpeedNext(raw: string): boolean {
  if (raw.length > DATA_CONSENT_NEXT_MAX_CHARS) return false;
  const url = parseUrl(raw);
  return url !== null && url.protocol === 'https:' && isPsiHost(url);
}

/**
 * The consent page's address for one ask.
 *
 * @param pageUrl The page's absolute extension URL (`runtime.getURL` of {@link DATA_CONSENT_PAGE_PATH}).
 * @param query What it is opened for (`next` only for PageSpeed Insights).
 * @returns The address.
 * @throws {@link Error} When `next` is not a {@link isPageSpeedNext} address.
 */
export function buildDataConsentPageUrl(pageUrl: string, query: DataConsentPageQuery): string {
  const url = new URL(pageUrl);
  url.searchParams.set('feature', query.feature);
  if (query.next !== null) {
    if (!isPageSpeedNext(query.next)) {
      throw new Error(
        `Consent page: not a PageSpeed Insights address to continue to: ${query.next}`
      );
    }
    url.searchParams.set('next', query.next);
  }
  return url.href;
}

/**
 * Read the consent page's query. A missing or unknown tool reads as null;
 * a `next` that is not a {@link isPageSpeedNext} address is dropped (the
 * page then never navigates anywhere it was not meant to).
 *
 * @param search The page's `location.search`.
 * @returns The query, or null when no known tool asked.
 */
export function parseDataConsentPageQuery(search: string): DataConsentPageQuery | null {
  const params = new URLSearchParams(search);
  const feature = params.get('feature');
  if (!isDataConsentFeature(feature)) return null;
  const next = params.get('next');
  return {
    feature,
    next: feature === 'pagespeed' && next !== null && isPageSpeedNext(next) ? next : null
  };
}
