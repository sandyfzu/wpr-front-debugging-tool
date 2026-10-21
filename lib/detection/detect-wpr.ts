/**
 * WP Rocket's own footprints: the generator `meta` (version), and the cache
 * comment after the document element when a cached page is served
 * (`<!-- This website is like a Rocket, isn't it? … -->`, or a white-label
 * footer). The vocabulary itself is single-sourced in `../wp-rocket/constants`.
 */

import {
  CACHE_COMMENT_MARKERS,
  CACHE_DEBUG_MARKER,
  extractWprVersion,
  GENERATOR_META_SELECTOR,
  parseCacheTimestampToken,
  WPR_NAME_PATTERN
} from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';

/**
 * Whether a comment starts with one of WP Rocket's cache markers. Prefix
 * text before the marker is not the plugin's footer; leading whitespace is
 * tolerated because the parser preserves it.
 *
 * @param data The comment's text.
 */
function startsWithCacheMarker(data: string): boolean {
  const trimmed = data.trimStart();
  return CACHE_COMMENT_MARKERS.some((marker) => trimmed.startsWith(marker));
}

/** Full `wpr` detection. Pure in `document`; reads nothing live. */
export function detectWpr(document: Document): WprDetections['wpr'] {
  const wpr: WprDetections['wpr'] = {
    present: false,
    cacheMarkerFound: false,
    cached: false,
    version: null,
    timeStamp: null
  };

  const metaTag = [...document.querySelectorAll<HTMLMetaElement>(GENERATOR_META_SELECTOR)].find(
    (tag) => WPR_NAME_PATTERN.test(tag.content)
  );
  if (metaTag !== undefined) {
    wpr.version = extractWprVersion(metaTag.content);
    wpr.present = wpr.version !== null;
  }

  let sibling: ChildNode | null = document.documentElement.nextSibling;
  while (sibling !== null) {
    // Only comment nodes can be the footer; element/text siblings (parser
    // relocation artifacts) must be skipped, not crashed on.
    if (sibling instanceof Comment && startsWithCacheMarker(sibling.data)) {
      wpr.present = true;
      wpr.cacheMarkerFound = true;
      if (sibling.data.includes(CACHE_DEBUG_MARKER)) {
        wpr.cached = true;
        wpr.timeStamp = parseCacheTimestampToken(sibling.data);
      }
      break;
    }
    sibling = sibling.nextSibling;
  }
  return wpr;
}
