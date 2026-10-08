/**
 * WP Rocket's own footprints: the generator `meta` (version), and the cache
 * debug comment inserted before the document element when a cached page is
 * served (`<!-- This website is like a Rocket… -->`). The vocabulary itself is
 * single-sourced in `../wp-rocket/constants`.
 */

import {
  CACHE_COMMENT_MARKER,
  CACHE_DEBUG_MARKER,
  CACHE_TIMESTAMP_PATTERN,
  extractWprVersion,
  GENERATOR_META_SELECTOR,
  WPR_NAME_PATTERN
} from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';

/** Full `wpr` detection. Pure in `document`; reads nothing live. */
export function detectWpr(document: Document): WprDetections['wpr'] {
  const wpr: WprDetections['wpr'] = {
    present: false,
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
    // Comment/text-like nodes carry text in `data`; element siblings (parser
    // relocation artifacts) must be skipped, not crashed on.
    const data = sibling instanceof CharacterData ? sibling.data : undefined;
    if (data !== undefined && data.includes(CACHE_COMMENT_MARKER)) {
      wpr.present = true;
      if (data.includes(CACHE_DEBUG_MARKER)) {
        wpr.cached = true;
        // Truthy capture, as the reference engine reads it: an empty
        // `cached@` suffix keeps the timestamp null. The explicit radix is
        // the one delta vs the reference `parseInt`: `0x`-prefixed suffixes
        // parse as 0 instead of hexadecimal. Non-numeric suffixes normalize
        // to null rather than NaN.
        const timestamp = data.match(CACHE_TIMESTAMP_PATTERN)?.[1];
        if (timestamp) {
          const parsed = parseInt(timestamp, 10);
          wpr.timeStamp = Number.isNaN(parsed) ? null : parsed;
        }
      }
      break;
    }
    sibling = sibling.nextSibling;
  }
  return wpr;
}
