/**
 * The page-cache vocabulary: one typed answer for every surface that reports
 * what the served HTML and the captured headers can prove. The states are
 * deliberately explicit — absence of a marker never renders a verdict:
 *
 * - `cached`: the cache debug stamp is on the served HTML (the plugin's own
 *   statement that a cached copy was served);
 * - `uncertain-signature`: the signature comment exists without the debug
 *   stamp — the plugin handled the render, but this visit's cache state is
 *   not proven;
 * - `possibly-cached`: no signature, but a verified hosting cache-layer
 *   marker was captured (the page may be served from that layer); a captured
 *   bypass is carried alongside it because it only disables WP Rocket's own
 *   cache;
 * - `not-detected`: no signature and no host marker that served the response.
 *   How complete the capture was is carried explicitly (`captured`,
 *   `unavailable`, `truncated`, `redacted`), because "nothing captured"
 *   proves nothing while a complete capture with no served marker is a real
 *   negative;
 * - `not-cached`: the captured URL carries WP Rocket's bypass parameter and
 *   no captured host marker showed a cache serving the response. This is
 *   WP Rocket's cache only; host and CDN layers are separate.
 *
 * The chip label, tooltip and report line live here too: the strip, the
 * status bar, the page-analysis report and the support report all read this
 * module, so one cache state can never be spelled two ways.
 */

import type { FdtData, PageHeaderCapture, PageHeaders, WprDetections } from '../wp-rocket/types';
import { formatCacheTimestamp, isRepresentableCacheStamp } from './cache-time';

/** The report line for a page WP Rocket did not handle: no cache question exists. */
export const CACHE_NOT_APPLICABLE_REPORT = 'Not applicable (WP Rocket not detected)';

/** What the page and its capture prove about this visit's cache state. */
export type CacheState =
  | {
      readonly kind: 'cached';
      /** Epoch seconds in the cache display domain, else null (absent/mangled stamp). */
      readonly seconds: number | null;
      /** Absolute UTC form of `seconds`, else null. */
      readonly formatted: string | null;
    }
  | { readonly kind: 'uncertain-signature' }
  | {
      readonly kind: 'possibly-cached';
      readonly evidence: string;
      /** The captured URL attested WP Rocket's bypass; host layers may still serve. */
      readonly bypassAttested?: true;
    }
  | {
      readonly kind: 'not-detected';
      /**
       * `unavailable` = nothing was captured (proves nothing); `truncated` =
       * the capture was clipped; `redacted` = a known marker's value was
       * withheld; `captured` = a complete capture without a served marker.
       */
      readonly headers: 'captured' | 'unavailable' | 'truncated' | 'redacted';
    }
  | { readonly kind: 'not-cached' };

/**
 * A verified hosting cache-layer marker. Only exact headers with a known
 * meaning are listed: the capture's absence of a row is not evidence, and a
 * generic word match across the header blob (a page can send it in any value)
 * would be the fake marker this vocabulary exists to avoid.
 */
interface CacheLayerMarker {
  /** Lowercase header name. */
  readonly header: string;
  /** The layer's display name. */
  readonly evidence: string;
  /** Whether this row's value indicates the layer served the response. */
  readonly served: (value: string) => boolean;
}

/** A value is a serve only when the exact status (trimmed, case-folded) says so. */
function isStatus(...statuses: readonly string[]): (value: string) => boolean {
  return (value) => statuses.includes(value.trim().toUpperCase());
}

/**
 * The verified markers this port reports. SiteGround's file cache emits
 * `sg-f-cache: HIT`; `MISS`/`BYPASS` are non-serves. Cloudflare's served set
 * is HIT/STALE/REVALIDATED/UPDATING — `EXPIRED` is served from the origin,
 * and MISS/DYNAMIC/BYPASS/NONE/UNKNOWN are not cache serves. The generic
 * `x-proxy-cache` header is a host/proxy layer, not a vendor marker, and is
 * outside this registry.
 */
const CACHE_LAYER_MARKERS: readonly CacheLayerMarker[] = [
  {
    header: 'sg-f-cache',
    evidence: 'SiteGround',
    served: isStatus('HIT')
  },
  {
    header: 'cf-cache-status',
    evidence: 'Cloudflare',
    served: isStatus('HIT', 'STALE', 'REVALIDATED', 'UPDATING')
  }
];

/** What a known cache-layer header said: served, withheld, or nothing usable. */
type CacheLayerScan =
  | { readonly kind: 'served'; readonly evidence: string }
  | { readonly kind: 'withheld' }
  | { readonly kind: 'none' };

/**
 * The hosting layer whose captured marker proves a cache likely served the
 * page, if any. Later duplicate rows (the last hop) win, matching the
 * capture's general header-intake rule. A redacted known-marker row withholds
 * its value but does not stop the scan: another layer's served marker still
 * wins.
 *
 * @param headers The captured response headers (possibly empty).
 * @returns The layer's evidence, a withheld marker, or neither.
 */
function scanCacheLayers(headers: PageHeaders): CacheLayerScan {
  let withheld = false;
  for (const marker of CACHE_LAYER_MARKERS) {
    for (let index = headers.length - 1; index >= 0; index -= 1) {
      const row = headers[index];
      if (row === undefined || row.name.toLowerCase() !== marker.header) continue;
      if (row.redacted === true) {
        withheld = true;
        // The last row for this marker is the one the capture withheld; do
        // not resurrect an earlier duplicate's value. Other markers still
        // scan (a different served layer wins).
        break;
      }
      if (marker.served(row.value ?? '')) return { kind: 'served', evidence: marker.evidence };
      break;
    }
  }
  return withheld ? { kind: 'withheld' } : { kind: 'none' };
}

/**
 * The hosting cache layer whose captured marker says it served the response,
 * independent of WP Rocket's own state — the layer that can strip the
 * plugin's signature (and, on a cached page, served WP Rocket's copy).
 *
 * @param headers The captured response headers, or null when none were.
 * @returns The layer's display name, or null (nothing captured proves nothing).
 */
export function servedCacheLayer(headers: PageHeaders | null): string | null {
  if (headers === null) return null;
  const layer = scanCacheLayers(headers);
  return layer.kind === 'served' ? layer.evidence : null;
}

/**
 * The hosting layer worth naming beside a page-cache state, or null. Never
 * on `cached` (the debug stamp proves WP Rocket's copy and its signature
 * survived) nor on `possibly-cached` (that state's own copy already names
 * the vendor); every other state names a served marker when one was
 * captured — in practice the signature-without-stamp state, where a host
 * cache serving the response explains the missing stamp.
 *
 * @param state The resolved cache state.
 * @param headers The captured response headers, or null.
 * @returns The layer's display name, or null.
 */
export function cacheLayerHint(state: CacheState, headers: PageHeaders | null): string | null {
  if (state.kind === 'cached' || state.kind === 'possibly-cached') return null;
  return servedCacheLayer(headers);
}

/**
 * The cache-layer hint's copy (summary fact and report line).
 *
 * @param evidence The layer's display name.
 * @returns The short fact and the report line.
 */
export function cacheLayerCopy(evidence: string): {
  readonly fact: string;
  readonly report: string;
} {
  return {
    fact: `${evidence} cache-layer marker captured`,
    report: `${evidence} cache-layer marker captured (that layer served this response, so this visit may not have reached WP Rocket's cache)`
  };
}

/** The inputs the cache answer reads. */
export interface CacheStateInput {
  readonly wpr: WprDetections['wpr'];
  readonly headers: PageHeaders | null;
  readonly bypassAttested: boolean;
  /** The header capture was clipped, so a marker may be missing. */
  readonly truncated?: boolean;
}

/**
 * Resolve the cache state from the plugin's own evidence and the capture.
 * The precedence is deliberate: the served stamp outranks everything, the
 * signature proves the plugin handled the render, a captured host marker
 * outranks the bypass (it saw a layer serve the response), the bypass is
 * counter-evidence for WP Rocket's own cache, and the header arms describe
 * how complete the capture was.
 *
 * @param input The plugin row, captured headers (null when none), bypass mark
 *   and capture-completeness flag.
 * @returns The explicit state.
 */
export function cacheStateForPage(input: CacheStateInput): CacheState {
  const { wpr, headers, bypassAttested, truncated = false } = input;
  if (wpr.cached) {
    const seconds = isRepresentableCacheStamp(wpr.timeStamp) ? wpr.timeStamp : null;
    return {
      kind: 'cached',
      seconds,
      formatted: formatCacheTimestamp(seconds)
    };
  }
  if (wpr.cacheMarkerFound) return { kind: 'uncertain-signature' };
  const layer = headers === null ? { kind: 'none' as const } : scanCacheLayers(headers);
  if (layer.kind === 'served') {
    return {
      kind: 'possibly-cached',
      evidence: layer.evidence,
      ...(bypassAttested ? { bypassAttested: true as const } : {})
    };
  }
  if (bypassAttested) return { kind: 'not-cached' };
  if (headers === null || headers.length === 0) {
    return { kind: 'not-detected', headers: 'unavailable' };
  }
  if (layer.kind === 'withheld') return { kind: 'not-detected', headers: 'redacted' };
  if (truncated) return { kind: 'not-detected', headers: 'truncated' };
  return { kind: 'not-detected', headers: 'captured' };
}

/**
 * The same-context read's cache answer from the live header capture: the one
 * bridge that carries the capture's truncation mark into the state, so the
 * strip and the page-analysis log can never disagree about completeness.
 *
 * @param wpr The plugin row.
 * @param capture The fetched header capture, or null when the fetch failed.
 * @param bypassAttested Whether the captured URL carried the bypass.
 */
export function cacheStateFromCapture(
  wpr: WprDetections['wpr'],
  capture: PageHeaderCapture | null,
  bypassAttested: boolean
): CacheState {
  return cacheStateForPage({
    wpr,
    headers: capture?.headers ?? null,
    bypassAttested,
    truncated: capture?.truncated === true
  });
}

/**
 * The panel payload's cache answer, or null when the plugin is absent (its
 * cache is not the question on a page it did not handle).
 *
 * @param data The loaded page data.
 */
export function cacheStateFromFdtData(data: FdtData): CacheState | null {
  if (!data.wprDetections.wpr.present) return null;
  return cacheStateForPage({
    wpr: data.wprDetections.wpr,
    headers: data.pageHeaders,
    bypassAttested: data.bypassAttested === true,
    truncated: data.pageHeadersTruncated === true
  });
}

/** One cache state's three renderings (chip text, tooltip, report line). */
export interface CacheCopy {
  readonly chip: string;
  readonly tooltip: string;
  readonly report: string;
}

/**
 * The state's user-facing copy. Single declaring site for every cache
 * surface; the tooltip states the evidence and what it does not prove.
 *
 * @param state The explicit cache state.
 * @returns The chip label, tooltip and report line.
 */
export function cacheCopy(state: CacheState): CacheCopy {
  switch (state.kind) {
    case 'cached': {
      const generated = state.formatted === null ? null : ` generated ${state.formatted}`;
      return {
        chip: '✓ Cached',
        tooltip:
          generated === null
            ? "The page is served from WP Rocket's cache (no usable generation stamp was carried)."
            : `The page is served from WP Rocket's cache${generated}.`,
        report:
          state.formatted === null
            ? 'Cached (generation time not available)'
            : `Cached, generated ${state.formatted}`
      };
    }
    case 'uncertain-signature':
      return {
        chip: 'Cache not proven',
        tooltip:
          "WP Rocket's cache signature is on the served HTML, but the debug stamp is absent — the plugin handled the page; this visit's cache state is not proven.",
        report: 'Plugin fingerprint found, cache not proven for this visit'
      };
    case 'possibly-cached': {
      const bypass = state.bypassAttested === true;
      return {
        chip: 'Possibly cached',
        tooltip:
          `A ${state.evidence} cache-layer marker was captured, but WP Rocket's cache signature was not found on the served HTML. The page may be served from that cache.` +
          (bypass ? " WP Rocket's cache was bypassed for this request." : ''),
        report: `Possibly cached (${state.evidence} cache-layer marker; no WP Rocket signature${bypass ? '; WP Rocket cache bypassed' : ''})`
      };
    }
    case 'not-detected':
      return {
        chip: 'Cache not detected',
        tooltip:
          state.headers === 'unavailable'
            ? 'No WP Rocket cache signature was found. Response headers were not captured, so hosting cache markers could not be checked.'
            : state.headers === 'truncated'
              ? 'No WP Rocket cache signature was found. The header capture was incomplete (truncated), so a hosting cache marker may not have been seen.'
              : state.headers === 'redacted'
                ? 'No WP Rocket cache signature was found. A hosting cache header was captured with its value withheld, so cache use is not proven.'
                : 'No WP Rocket cache signature was found, and no captured hosting cache marker showed that a cache served this response.',
        report:
          state.headers === 'unavailable'
            ? 'Cache not detected (response headers unavailable)'
            : state.headers === 'truncated'
              ? 'Cache not detected (header capture truncated)'
              : state.headers === 'redacted'
                ? 'Cache not detected (cache header value withheld)'
                : 'Cache not detected'
      };
    case 'not-cached':
      return {
        chip: 'Not cached',
        tooltip:
          "The captured URL carries WP Rocket's cache-bypass parameter, so WP Rocket's cache did not serve this visit. Host and CDN caches are separate layers; this capture does not attest them.",
        report: 'Not cached by WP Rocket (cache bypass requested)'
      };
  }
}

/**
 * The report line for a state (the copy module's report text).
 *
 * @param state The explicit cache state.
 */
export function cacheReportText(state: CacheState): string {
  return cacheCopy(state).report;
}
