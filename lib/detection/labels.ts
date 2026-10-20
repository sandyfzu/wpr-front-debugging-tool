/**
 * The verified WP Rocket label strings, promoted from the page-analysis view
 * model so every surface that names a feature shares one declaring site: the
 * engine's report keys, and consumers reading feature names (the analysis
 * view model, the on-page strip's registry), import these instead of
 * re-typing the strings (a second literal is the re-typed-value defect).
 *
 * Spellings verified against WP Rocket 3.23 (KB + settings UI), the audit's
 * rule: the plugin's own naming is the final authority for feature names.
 */

/** The report's identity row (the plugin itself, the header's subject). */
export const LABEL_WP_ROCKET = 'WP Rocket';

/** The page-analysis feature rows, in the report's declaring order. */
export const LABEL_REMOVE_UNUSED_CSS = 'Remove Unused CSS';
export const LABEL_DELAY_JAVASCRIPT_EXECUTION = 'Delay JavaScript execution';
export const LABEL_LOAD_JAVASCRIPT_DEFERRED = 'Load JavaScript deferred';
export const LABEL_LOAD_CSS_ASYNCHRONOUSLY = 'Load CSS asynchronously';
export const LABEL_IMAGE_LAZYLOAD = 'Image LazyLoad';
export const LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD = 'Iframes and videos LazyLoad';
export const LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD = 'CSS background images LazyLoad';
export const LABEL_SELF_HOST_GOOGLE_FONTS = 'Self-host Google Fonts';
export const LABEL_ADD_MISSING_IMAGE_DIMENSIONS = 'Add missing image dimensions';
export const LABEL_MINIFY_CSS = 'Minify CSS';
export const LABEL_MINIFY_JAVASCRIPT = 'Minify JavaScript';
export const LABEL_PRELOAD_LINKS = 'Preload links';
export const LABEL_ROCKETCDN = 'RocketCDN';

/** The Priority Elements family rows (the beacon's four features + its row). */
export const LABEL_OPTIMIZE_CRITICAL_IMAGES = 'Optimize critical images';
export const LABEL_AUTOMATIC_LAZY_RENDERING = 'Automatic lazy rendering';
export const LABEL_PRELOAD_FONTS = 'Preload fonts';
export const LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS = 'Preconnect to external domains';
export const LABEL_PRIORITY_ELEMENTS_BEACON = 'Priority Elements beacon';

/**
 * Every feature label exactly once — the shape pin the report keys and any
 * feature-name consumer are checked against (drift in either direction
 * fails loudly, never silently ships a renamed feature).
 */
export const FEATURE_LABELS = [
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_SELF_HOST_GOOGLE_FONTS,
  LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_PRELOAD_LINKS,
  LABEL_ROCKETCDN,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_PRELOAD_FONTS,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRIORITY_ELEMENTS_BEACON
] as const;

/**
 * Any row of the page-analysis report except the identity row: the strings
 * a feature-name consumer selects from (the strip excludes the beacon row
 * from its render set by its own contract).
 */
export type FeatureLabel = (typeof FEATURE_LABELS)[number];
