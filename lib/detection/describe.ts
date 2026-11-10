/**
 * The page-analysis view model: `WprDetections` → a plain-language report a
 * debugging human reads — real WP Rocket feature names, one honest state per
 * feature, counts instead of raw page content (the console must never carry
 * the page's markup: no URLs, no sources). Composing the Priority Elements
 * family's "collecting / not enabled" states is exactly the view-model work
 * the evidence-pure checks defer here.
 */

import type { WprDetections } from '../wp-rocket/types';
import { BEACON_STATUS_KEYS } from '../wp-rocket/constants';
import {
  absoluteStampFromMs,
  formatCacheTimestamp,
  isRepresentableCacheStamp,
  isRepresentableStampMs,
  MAX_REPRESENTABLE_MS
} from './cache-time';
import type { CacheState } from './cache-context';
import { CACHE_NOT_APPLICABLE_REPORT, cacheReportText, cacheStateForPage } from './cache-context';

/** Re-exported so existing consumers keep the report module as their one path. */
export {
  absoluteStampFromMs,
  formatCacheTimestamp,
  isRepresentableCacheStamp,
  isRepresentableStampMs,
  MAX_REPRESENTABLE_MS
};
import {
  BEACON_STATUS_KEY_LABELS,
  LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_COMBINE_JAVASCRIPT,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS,
  LABEL_PRELOAD_LINKS,
  LABEL_PRIORITY_ELEMENTS_BEACON,
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_CDN,
  LABEL_SELF_HOST_GOOGLE_FONTS,
  LABEL_WP_ROCKET
} from './labels';

/** One feature's page state: the evidence-true states the checks defer to views. */
export type FeatureState = 'applied' | 'collecting' | 'not enabled' | 'not applied';

/**
 * The report object: one row per detected surface, keyed by the real feature
 * name (labels verified against WP Rocket 3.23 where the audit verified
 * them — single-sourced in `./labels`), values plain enough to read straight
 * from the console.
 */
export interface PageAnalysisReport {
  [LABEL_WP_ROCKET]: {
    'plugin detected': boolean;
    /** The explicit cache vocabulary's report line (never an absence-born verdict). */
    'page cache': string;
    version: string | null;
    /** UTC-stamped cache time (the debug comment's seconds → readable form). */
    'cache generated at': string | null;
  };
  [LABEL_REMOVE_UNUSED_CSS]: { state: FeatureState };
  [LABEL_DELAY_JAVASCRIPT_EXECUTION]: {
    state: FeatureState;
    'delayed scripts': number;
    'delay library version': string | null;
  };
  [LABEL_LOAD_JAVASCRIPT_DEFERRED]: { state: FeatureState; 'deferred scripts': number };
  [LABEL_LOAD_CSS_ASYNCHRONOUSLY]: { state: FeatureState };
  [LABEL_IMAGE_LAZYLOAD]: { state: FeatureState; 'lazy-loaded images': number };
  [LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD]: {
    state: FeatureState;
    'YouTube preview image replacement': boolean;
  };
  [LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD]: { state: FeatureState };
  [LABEL_SELF_HOST_GOOGLE_FONTS]: { state: FeatureState };
  [LABEL_ADD_MISSING_IMAGE_DIMENSIONS]: { state: FeatureState };
  [LABEL_MINIFY_CSS]: { state: FeatureState };
  [LABEL_MINIFY_JAVASCRIPT]: { state: FeatureState };
  [LABEL_COMBINE_JAVASCRIPT]: { state: FeatureState };
  [LABEL_PRELOAD_LINKS]: { state: FeatureState };
  [LABEL_CDN]: { state: FeatureState };
  [LABEL_OPTIMIZE_CRITICAL_IMAGES]: { state: FeatureState; 'preloaded images': number };
  [LABEL_AUTOMATIC_LAZY_RENDERING]: {
    state: FeatureState;
    'converted elements': number;
    'render hashes on page': number;
  };
  [LABEL_PRELOAD_FONTS]: { state: FeatureState; 'preloaded fonts': number };
  [LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]: { state: FeatureState; 'domains hinted': number };
  [LABEL_PRIORITY_ELEMENTS_BEACON]: {
    detected: boolean;
    'configured device': 'mobile' | 'desktop' | 'unknown';
    /** The real names the inline config allowed for this context. */
    'enabled features': string[];
  };
}

/** The state of a plain markup-evidence optimization: the evidence is the answer. */
function simpleState(present: boolean): FeatureState {
  return present ? 'applied' : 'not applied';
}

/**
 * A Priority Elements feature's state: the row's verdict (`present` — meta
 * declaration or applied evidence) wins; without it, collecting-phase markup
 * (or an allowed context in the parsed config) reads "collecting", a readable
 * config that withholds the context reads "not enabled", and an
 * unreadable/absent config (`status` null) degrades to "not applied" —
 * silence proves nothing (white-label strips configs).
 *
 * @param key The feature's own beacon-config id.
 * @param present The row's decided verdict.
 * @param collecting Extra in-markup collecting-phase evidence (e.g. ALR's
 *   render hashes), composed as collecting without a present verdict.
 * @param config The beacon row (its `status` may be null).
 * @returns The honest composed state.
 */
function familyState(
  key: (typeof BEACON_STATUS_KEYS)[number],
  present: boolean,
  collecting: boolean,
  config: WprDetections['priority_elements_beacon']
): FeatureState {
  if (present) return 'applied';
  if (collecting) return 'collecting';
  const { status } = config;
  if (status !== null && status[key] === true) return 'collecting';
  if (status !== null) return 'not enabled';
  return 'not applied';
}

/**
 * The applied-evidence counts of the four beacon-served features, keyed by
 * the config's own ids — the composition table for the family rows.
 */
function familyAppliedCounts(
  detections: WprDetections
): Record<(typeof BEACON_STATUS_KEYS)[number], number> {
  const {
    rocket_above_the_fold_optimization,
    automatic_lazy_rendering,
    auto_preload_fonts,
    preconnect_external_domains
  } = detections;
  return {
    atf:
      rocket_above_the_fold_optimization.preloadedImages === undefined
        ? 0
        : rocket_above_the_fold_optimization.preloadedImages.length,
    lrc: automatic_lazy_rendering.lazyRenderElements,
    preload_fonts: auto_preload_fonts.fonts.length,
    preconnect_external_domain: preconnect_external_domains.domains.length
  };
}

/**
 * Build the organized page-analysis report. Pure: same detections in, same
 * object out; prints expandably (`log.info('Page analysis', report)`), never
 * page content.
 *
 * @param detections The complete page classification from the engine.
 * @param cacheState The explicit cache answer when the caller has the
 *   headers/bypass capture; omitted, the report derives the signature-only
 *   answer and states that the headers were unavailable.
 * @returns The report object keyed by real feature names.
 */
export function describeDetections(
  detections: WprDetections,
  cacheState?: CacheState
): PageAnalysisReport {
  const { wpr, priority_elements_beacon: beacon } = detections;
  const applied = familyAppliedCounts(detections);
  const status = beacon.status;
  const cache = cacheState ?? cacheStateForPage({ wpr, headers: null, bypassAttested: false });
  const enabledFeatures =
    status === null
      ? []
      : BEACON_STATUS_KEYS.filter((key) => status[key] === true).map(
          (key) => BEACON_STATUS_KEY_LABELS[key]
        );
  return {
    [LABEL_WP_ROCKET]: {
      'plugin detected': wpr.present,
      // A page the plugin did not handle has no cache question: the explicit
      // state (when one was passed) is not a page verdict either.
      'page cache': wpr.present ? cacheReportText(cache) : CACHE_NOT_APPLICABLE_REPORT,
      version: wpr.version,
      'cache generated at': formatCacheTimestamp(wpr.timeStamp)
    },
    [LABEL_REMOVE_UNUSED_CSS]: { state: simpleState(detections.remove_unused_css.present) },
    [LABEL_DELAY_JAVASCRIPT_EXECUTION]: {
      state: simpleState(detections.delay_js.present),
      'delayed scripts': detections.delay_js.delayedScripts,
      'delay library version': detections.delay_js.version
    },
    [LABEL_LOAD_JAVASCRIPT_DEFERRED]: {
      state: simpleState(detections.defer_all_js.present),
      'deferred scripts': detections.defer_all_js.deferredScripts
    },
    [LABEL_LOAD_CSS_ASYNCHRONOUSLY]: { state: simpleState(detections.async_css.present) },
    [LABEL_IMAGE_LAZYLOAD]: {
      state: simpleState(detections.lazyload.present),
      // Only the images actually lazy-loaded: an image the plugin (or the
      // Exclusion Builder) left eager is not evidence of the feature.
      'lazy-loaded images': detections.lazyload.images.filter((image) => image.lazyloadDetected)
        .length
    },
    [LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD]: {
      state: simpleState(detections.lazyload_iframes.present),
      'YouTube preview image replacement': detections.lazyload_iframes.replaceImage
    },
    [LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD]: {
      state: simpleState(detections.lazyload_css_bg_img.present)
    },
    [LABEL_SELF_HOST_GOOGLE_FONTS]: { state: simpleState(detections.self_hosted_fonts.present) },
    [LABEL_ADD_MISSING_IMAGE_DIMENSIONS]: {
      state: simpleState(detections.image_dimensions.present)
    },
    [LABEL_MINIFY_CSS]: { state: simpleState(detections.minify_css.present) },
    [LABEL_MINIFY_JAVASCRIPT]: { state: simpleState(detections.minify_js.present) },
    [LABEL_COMBINE_JAVASCRIPT]: { state: simpleState(detections.minify_concatenate_js.present) },
    [LABEL_PRELOAD_LINKS]: { state: simpleState(detections.preload_links.present) },
    [LABEL_CDN]: { state: simpleState(detections.rocket_cdn.present) },
    [LABEL_OPTIMIZE_CRITICAL_IMAGES]: {
      state: familyState(
        'atf',
        detections.rocket_above_the_fold_optimization.present,
        false,
        beacon
      ),
      'preloaded images': applied.atf
    },
    [LABEL_AUTOMATIC_LAZY_RENDERING]: {
      state: familyState(
        'lrc',
        detections.automatic_lazy_rendering.present,
        detections.automatic_lazy_rendering.locationHashes > 0,
        beacon
      ),
      'converted elements': detections.automatic_lazy_rendering.lazyRenderElements,
      'render hashes on page': detections.automatic_lazy_rendering.locationHashes
    },
    [LABEL_PRELOAD_FONTS]: {
      state: familyState('preload_fonts', detections.auto_preload_fonts.present, false, beacon),
      'preloaded fonts': applied.preload_fonts
    },
    [LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]: {
      state: familyState(
        'preconnect_external_domain',
        detections.preconnect_external_domains.present,
        false,
        beacon
      ),
      'domains hinted': applied.preconnect_external_domain
    },
    [LABEL_PRIORITY_ELEMENTS_BEACON]: {
      detected: beacon.present,
      'configured device':
        beacon.isMobile === null ? 'unknown' : beacon.isMobile ? 'mobile' : 'desktop',
      'enabled features': enabledFeatures
    }
  };
}
