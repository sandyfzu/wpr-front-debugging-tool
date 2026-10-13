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

/** One feature's page state: the evidence-true states the checks defer to views. */
export type FeatureState = 'applied' | 'collecting' | 'not enabled' | 'not applied';

/**
 * The largest instant `new Date`/`toISOString` can represent (ECMA-262's
 * ± 100,000,000 days from the epoch, in ms). A page-derived stamp beyond it
 * is not a time, only a crash waiting for `toISOString` — callers see null.
 */
const MAX_REPRESENTABLE_MS = 8.64e15;

/**
 * The report object: one row per detected surface, keyed by the real feature
 * name (labels verified against WP Rocket 3.23 where the audit verified
 * them), values plain enough to read straight from the console.
 */
export interface PageAnalysisReport {
  'WP Rocket': {
    'plugin detected': boolean;
    'page served from cache': boolean;
    version: string | null;
    /** UTC-stamped cache time (the debug comment's seconds → readable form). */
    'cache generated at': string | null;
  };
  'Remove Unused CSS': { state: FeatureState };
  'Delay JavaScript execution': {
    state: FeatureState;
    'delayed scripts': number;
    'delay library version': string | null;
  };
  'Load JavaScript deferred': { state: FeatureState; 'deferred scripts': number };
  'Load CSS asynchronously': { state: FeatureState };
  'Image LazyLoad': { state: FeatureState; 'lazy-loaded images': number };
  'Iframes and videos LazyLoad': {
    state: FeatureState;
    'YouTube preview image replacement': boolean;
  };
  'CSS background images LazyLoad': { state: FeatureState };
  'Minify CSS': { state: FeatureState };
  'Minify JavaScript': { state: FeatureState };
  'Preload links': { state: FeatureState };
  RocketCDN: { state: FeatureState };
  'Optimize critical images': { state: FeatureState; 'preloaded images': number };
  'Automatic lazy rendering': {
    state: FeatureState;
    'converted elements': number;
    'render hashes on page': number;
  };
  'Preload fonts': { state: FeatureState; 'preloaded fonts': number };
  'Preconnect to external domains': { state: FeatureState; 'domains hinted': number };
  'Priority Elements beacon': {
    detected: boolean;
    'configured device': 'mobile' | 'desktop' | 'unknown';
    /** The real names the inline config allowed for this context. */
    'enabled features': string[];
  };
}

/** Real names for the four beacon-served features, keyed by the plugin's own config ids. */
const FAMILY_FEATURE_NAMES: Record<(typeof BEACON_STATUS_KEYS)[number], string> = {
  atf: 'Optimize critical images',
  lrc: 'Automatic lazy rendering',
  preload_fonts: 'Preload fonts',
  preconnect_external_domain: 'Preconnect to external domains'
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
    'WP Rocket': {
      'plugin detected': wpr.present,
      'page served from cache': wpr.cached,
      version: wpr.version,
      'cache generated at': formatCacheTimestamp(wpr.timeStamp)
    },
    'Remove Unused CSS': { state: simpleState(detections.remove_unused_css.present) },
    'Delay JavaScript execution': {
      state: simpleState(detections.delay_js.present),
      'delayed scripts': detections.delay_js.delayedScripts,
      'delay library version': detections.delay_js.version
    },
    'Load JavaScript deferred': {
      state: simpleState(detections.defer_all_js.present),
      'deferred scripts': detections.defer_all_js.scripts.length
    },
    'Load CSS asynchronously': { state: simpleState(detections.async_css.present) },
    'Image LazyLoad': {
      state: simpleState(detections.lazyload.present),
      'lazy-loaded images': detections.lazyload.images.length
    },
    'Iframes and videos LazyLoad': {
      state: simpleState(detections.lazyload_iframes.present),
      'YouTube preview image replacement': detections.lazyload_iframes.replaceImage
    },
    'CSS background images LazyLoad': {
      state: simpleState(detections.lazyload_css_bg_img.present)
    },
    'Minify CSS': { state: simpleState(detections.minify_css.present) },
    'Minify JavaScript': { state: simpleState(detections.minify_js.present) },
    'Preload links': { state: simpleState(detections.preload_links.present) },
    RocketCDN: { state: simpleState(detections.rocket_cdn.present) },
    'Optimize critical images': {
      state: familyState('atf', applied.atf, false, beacon),
      'preloaded images': applied.atf
    },
    'Automatic lazy rendering': {
      state: familyState(
        'lrc',
        applied.lrc,
        detections.automatic_lazy_rendering.locationHashes > 0,
        beacon
      ),
      'converted elements': detections.automatic_lazy_rendering.lazyRenderElements,
      'render hashes on page': detections.automatic_lazy_rendering.locationHashes
    },
    'Preload fonts': {
      state: familyState('preload_fonts', applied.preload_fonts, false, beacon),
      'preloaded fonts': applied.preload_fonts
    },
    'Preconnect to external domains': {
      state: familyState(
        'preconnect_external_domain',
        applied.preconnect_external_domain,
        false,
        beacon
      ),
      'domains hinted': applied.preconnect_external_domain
    },
    'Priority Elements beacon': {
      detected: beacon.present,
      'configured device':
        beacon.isMobile === null ? 'unknown' : beacon.isMobile ? 'mobile' : 'desktop',
      'enabled features': enabledFeatures
    }
  };
}
