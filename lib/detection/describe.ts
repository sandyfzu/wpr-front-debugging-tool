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
  LABEL_AUTOMATIC_LAZY_RENDERING,
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
  LABEL_ROCKETCDN,
  LABEL_WP_ROCKET
} from './labels';

/** One feature's page state: the evidence-true states the checks defer to views. */
export type FeatureState = 'applied' | 'collecting' | 'not enabled' | 'not applied';

/**
 * The largest instant `new Date`/`toISOString` can represent (ECMA-262's
 * ± 100,000,000 days from the epoch, in ms). A page-derived stamp beyond it
 * is not a time, only a crash waiting for `toISOString` — callers see null.
 *
 * This is the platform ceiling's one declaring site, shared by both
 * page-derived-stamp defenses that need it: the cache-stamp predicate below
 * (epoch seconds × 1000) and the messaging boundary's capture stamps
 * (`parsePageCookies`' `capturedAt`, used as ms directly).
 */
export const MAX_REPRESENTABLE_MS = 8.64e15;

/**
 * The report object: one row per detected surface, keyed by the real feature
 * name (labels verified against WP Rocket 3.23 where the audit verified
 * them — single-sourced in `./labels`), values plain enough to read straight
 * from the console.
 */
export interface PageAnalysisReport {
  [LABEL_WP_ROCKET]: {
    'plugin detected': boolean;
    'page served from cache': boolean;
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
  [LABEL_MINIFY_CSS]: { state: FeatureState };
  [LABEL_MINIFY_JAVASCRIPT]: { state: FeatureState };
  [LABEL_PRELOAD_LINKS]: { state: FeatureState };
  [LABEL_ROCKETCDN]: { state: FeatureState };
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

/** Real names for the four beacon-served features, keyed by the plugin's own config ids. */
const FAMILY_FEATURE_NAMES: Record<(typeof BEACON_STATUS_KEYS)[number], string> = {
  atf: LABEL_OPTIMIZE_CRITICAL_IMAGES,
  lrc: LABEL_AUTOMATIC_LAZY_RENDERING,
  preload_fonts: LABEL_PRELOAD_FONTS,
  preconnect_external_domain: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS
};

/** The state of a plain markup-evidence optimization: the evidence is the answer. */
function simpleState(present: boolean): FeatureState {
  return present ? 'applied' : 'not applied';
}

/**
 * A Priority Elements feature's state: applied evidence wins, collecting-
 * phase markup (or an allowed context in the parsed config without one yet)
 * reads "collecting", a readable config that withholds the context reads
 * "not enabled", and an unreadable/absent config (`status` null) degrades to
 * "not applied" — silence proves nothing (white-label strips configs).
 *
 * @param key The feature's own beacon-config id.
 * @param applied Evidence count of the transform already on the page.
 * @param collecting Extra in-markup collecting-phase evidence (e.g. ALR's
 *   render hashes), composed as collecting without applied rows.
 * @param config The beacon row (its `status` may be null).
 * @returns The honest composed state.
 */
function familyState(
  key: (typeof BEACON_STATUS_KEYS)[number],
  applied: number,
  collecting: boolean,
  config: WprDetections['priority_elements_beacon']
): FeatureState {
  if (applied > 0) return 'applied';
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
 * Whether a page-derived epoch-seconds stamp names a real, representable
 * instant (finite, within the platform date range). The concept's one home:
 * the timestamp formatter consumes this answer, and callers that matter-
 * gate on the stamp (a relative age beside it) gate on it too, so a wild
 * page-crafted digit run renders as an unstamped cache — never as a made-up
 * countdown beside a missing stamp.
 *
 * @param seconds The stamp to judge (null is simply absent).
 */
export function isRepresentableCacheStamp(seconds: number | null): seconds is number {
  return (
    seconds !== null && Number.isFinite(seconds) && Math.abs(seconds * 1000) <= MAX_REPRESENTABLE_MS
  );
}

/**
 * Format the cache timestamp: UTC-stamped and locale-independent, so the same
 * support conversation reads identically on every contributor's console.
 *
 * The stamp is page-derived text through and through (the debug comment the
 * engine parses), so a hand-crafted or mangled `cached@<digits>` can carry a
 * value far past the platform's representable time range — where `new Date`
 * constructs a garbage date and `toISOString` throws `RangeError`. Any stamp
 * that does not resolve to a real instant therefore renders as its absence
 * (null): callers answer "unstamped" instead of losing the whole report —
 * or the whole strip — to one hostile integer.
 *
 * @param seconds The debug comment's epoch seconds, or null when absent.
 * @returns `YYYY-MM-DD HH:MM:SS UTC`, or null for null, non-finite, or
 *   outside-the-platform-range stamps.
 */
export function formatCacheTimestamp(seconds: number | null): string | null {
  if (!isRepresentableCacheStamp(seconds)) return null;
  return `${new Date(seconds * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/**
 * Build the organized page-analysis report. Pure: same detections in, same
 * object out; prints expandably (`log.info('Page analysis', report)`), never
 * page content.
 *
 * @param detections The complete page classification from the engine.
 * @returns The report object keyed by real feature names.
 */
export function describeDetections(detections: WprDetections): PageAnalysisReport {
  const { wpr, priority_elements_beacon: beacon } = detections;
  const applied = familyAppliedCounts(detections);
  const status = beacon.status;
  const enabledFeatures =
    status === null
      ? []
      : BEACON_STATUS_KEYS.filter((key) => status[key] === true).map(
          (key) => FAMILY_FEATURE_NAMES[key]
        );
  return {
    [LABEL_WP_ROCKET]: {
      'plugin detected': wpr.present,
      'page served from cache': wpr.cached,
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
      'deferred scripts': detections.defer_all_js.scripts.length
    },
    [LABEL_LOAD_CSS_ASYNCHRONOUSLY]: { state: simpleState(detections.async_css.present) },
    [LABEL_IMAGE_LAZYLOAD]: {
      state: simpleState(detections.lazyload.present),
      'lazy-loaded images': detections.lazyload.images.length
    },
    [LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD]: {
      state: simpleState(detections.lazyload_iframes.present),
      'YouTube preview image replacement': detections.lazyload_iframes.replaceImage
    },
    [LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD]: {
      state: simpleState(detections.lazyload_css_bg_img.present)
    },
    [LABEL_MINIFY_CSS]: { state: simpleState(detections.minify_css.present) },
    [LABEL_MINIFY_JAVASCRIPT]: { state: simpleState(detections.minify_js.present) },
    [LABEL_PRELOAD_LINKS]: { state: simpleState(detections.preload_links.present) },
    [LABEL_ROCKETCDN]: { state: simpleState(detections.rocket_cdn.present) },
    [LABEL_OPTIMIZE_CRITICAL_IMAGES]: {
      state: familyState('atf', applied.atf, false, beacon),
      'preloaded images': applied.atf
    },
    [LABEL_AUTOMATIC_LAZY_RENDERING]: {
      state: familyState(
        'lrc',
        applied.lrc,
        detections.automatic_lazy_rendering.locationHashes > 0,
        beacon
      ),
      'converted elements': detections.automatic_lazy_rendering.lazyRenderElements,
      'render hashes on page': detections.automatic_lazy_rendering.locationHashes
    },
    [LABEL_PRELOAD_FONTS]: {
      state: familyState('preload_fonts', applied.preload_fonts, false, beacon),
      'preloaded fonts': applied.preload_fonts
    },
    [LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]: {
      state: familyState(
        'preconnect_external_domain',
        applied.preconnect_external_domain,
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
