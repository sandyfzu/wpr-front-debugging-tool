/**
 * URL derivation for the Side-by-Side compare flow, pure and testable:
 * which two URLs the overlay's iframes load, and where the "compare cached
 * vs bypassed in PageSpeed Insights" context-menu entry sends the user.
 *
 * Semantics are behavioral (the shapes below document each branch); the
 * `?nowprocket=1` bypass tag and the `wpr-sbs` round-trip are WP Rocket's
 * and this tool's shared URL vocabulary.
 */

import { parseUrl } from '../../../utils/urls';

/** The query parameter that bypasses WP Rocket's cache for one request. */
export const NOW_PROCKET_PARAM = 'nowprocket';
/** The query parameter this tool uses to hand a site URL to PageSpeed Insights. */
export const SIDE_BY_SITE_PARAM = 'wpr-sbs';
/** Host PageSpeed Insights runs on. */
export const PSI_HOST = 'pagespeed.web.dev';

/** The two URLs an overlay side loads, cached and cache-bypassed. */
export interface CompareUrls {
  cached: string;
  bypassed: string;
}

/**
 * The direct page URLs for one site: without the bypass tag the current
 * requests are "cached" and `nowprocket=1` is appended for the bypassed
 * side; with the tag present the page is already bypassed — it becomes the
 * bypassed side and a copy without it is the cached side.
 *
 * @param siteUrl The page the overlay is opened on.
 * @returns The two iframe URLs (fresh values; the argument is untouched).
 */
export function getSiteUrls(siteUrl: URL): CompareUrls {
  const working = new URL(siteUrl.href);
  if (!working.searchParams.has(NOW_PROCKET_PARAM)) {
    working.searchParams.append(NOW_PROCKET_PARAM, '1');
    return { cached: siteUrl.href, bypassed: working.href };
  }
  working.searchParams.delete(NOW_PROCKET_PARAM);
  return { bypassed: siteUrl.href, cached: working.href };
}

/**
 * The PageSpeed Insights analyses for a site: the analysis endpoint with the
 * cached URL in `url`, then with the bypassed URL.
 *
 * @param siteUrl The site's own URL.
 * @returns The two analysis URLs.
 */
export function getPsiUrls(siteUrl: URL): CompareUrls {
  const { cached, bypassed } = getSiteUrls(siteUrl);
  const analysis = new URL(`https://${PSI_HOST}/analysis`);
  analysis.searchParams.append('url', cached);
  const cachedAnalysis = analysis.href;
  analysis.searchParams.set('url', bypassed);
  return { cached: cachedAnalysis, bypassed: analysis.href };
}

/**
 * Whether a URL is the PageSpeed Insights host (the overlay's compare flow
 * happens there, where the close/refresh controls are hidden — the analyses
 * drive themselves).
 *
 * @param url The page URL.
 */
export function isPsiHost(url: URL): boolean {
  return url.host === PSI_HOST;
}

/**
 * The site URL a PageSpeed-Insights page was opened with, from the
 * `wpr-sbs` param (this tool's entry point into the PSI flow). A missing or
 * non-URL value yields null — the flow degrades instead of guessing.
 *
 * @param psiUrl The PageSpeed Insights page URL.
 * @returns The carried site URL, or null.
 */
export function importedSiteUrl(psiUrl: URL): URL | null {
  const raw = psiUrl.searchParams.get(SIDE_BY_SITE_PARAM);
  if (raw === null) return null;
  return parseUrl(raw);
}

/**
 * The direct-site URLs the overlay loads: the PageSpeed path when the page
 * carries a site (two pre-launched analyses), the page's own URLs otherwise —
 * which on an analysis page without a carried site means the analysis host's
 * page itself (the shipped flow's chain: the manual open never fails to
 * resolve, the auto-open validates its carried site before mounting).
 *
 * @param pageUrl The URL the overlay is being opened against.
 * @returns The two URL strings.
 */
export function getOverlayUrls(pageUrl: URL): CompareUrls {
  if (!isPsiHost(pageUrl)) return getSiteUrls(pageUrl);
  const site = importedSiteUrl(pageUrl);
  return site === null ? getSiteUrls(pageUrl) : getPsiUrls(site);
}

/**
 * The PageSpeed-Insights entry into the compare flow for a site: the site
 * URL without this tool's own tags (they belong to the site, not to the
 * page that advertises it), handed over in `wpr-sbs`.
 *
 * @param siteUrl The page the context menu was invoked on.
 * @returns The entry URL string, or null when the site URL is unusable.
 */
export function psiEntryUrl(siteUrl: URL): string | null {
  const pageSpeed = new URL(`https://${PSI_HOST}/`);
  const working = new URL(siteUrl.href);
  working.searchParams.delete(NOW_PROCKET_PARAM);
  working.searchParams.delete(SIDE_BY_SITE_PARAM);
  pageSpeed.searchParams.append(SIDE_BY_SITE_PARAM, working.href);
  return pageSpeed.href;
}
