/**
 * The WP Rocket feature names, promoted from the page-analysis view model so
 * every surface that names a feature shares one declaring site: the engine's
 * report keys, the HUD registry (cards, on-page strip, support report), the
 * option map's feature ids and the panel pages import these instead of
 * re-typing the strings (a second literal is the re-typed-value defect).
 *
 * Each name is the plugin's own standalone wording in WP Rocket 3.23.5.1
 * source, in this order of preference: the settings field label, the
 * settings section title, the post-edit metabox field name, the support-data
 * option name, the admin notice. The source of each is noted beside it; the
 * plugin's own naming is the final authority for feature names.
 */

/** The report's identity row (the plugin itself, the header's subject). */
export const LABEL_WP_ROCKET = 'WP Rocket';

// The page-analysis feature rows, in the report's declaring order.

/** Settings field (`Admin/Settings/Page.php`, `remove_unused_css`). */
export const LABEL_REMOVE_UNUSED_CSS = 'Remove Unused CSS';
/** Settings field (`Page.php`, `delay_js`). */
export const LABEL_DELAY_JAVASCRIPT_EXECUTION = 'Delay JavaScript execution';
/** Settings field (`Page.php`, `defer_all_js`). */
export const LABEL_LOAD_JAVASCRIPT_DEFERRED = 'Load JavaScript deferred';
/** Settings field (`Page.php`, `async_css`). */
export const LABEL_LOAD_CSS_ASYNCHRONOUSLY = 'Load CSS asynchronously';
/**
 * Metabox field (`Media/Lazyload/AdminSubscriber.php`): the settings field
 * reads only "Enable for images" under the LazyLoad section.
 */
export const LABEL_IMAGE_LAZYLOAD = 'LazyLoad for images';
/** Metabox field (`Media/Lazyload/AdminSubscriber.php`). */
export const LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD = 'LazyLoad for iframes/videos';
/** Metabox field (`Media/Lazyload/CSS/Admin/Subscriber.php`). */
export const LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD = 'LazyLoad CSS backgrounds';
/** Settings field (`Page.php`, `host_fonts_locally`). */
export const LABEL_SELF_HOST_GOOGLE_FONTS = 'Self-host Google Fonts';
/** Settings field (`Page.php`, `image_dimensions`). */
export const LABEL_ADD_MISSING_IMAGE_DIMENSIONS = 'Add missing image dimensions';
/** Settings field (`Page.php`, `minify_css`). */
export const LABEL_MINIFY_CSS = 'Minify CSS files';
/** Settings field (`Page.php`, `minify_js`). */
export const LABEL_MINIFY_JAVASCRIPT = 'Minify JavaScript files';
/** Settings section title (`Page.php`) and support-data name (`Support/Data.php`). */
export const LABEL_PRELOAD_LINKS = 'Preload Links';
/**
 * Settings field `Enable Content Delivery Network` (`Page.php`, `cdn`) minus its
 * verb: `wpr_cdn` decides the row and every CDN set in WP Rocket emits it, so
 * the name must not single out RocketCDN.
 */
export const LABEL_CDN = 'Content Delivery Network';

/**
 * The settings field that groups Remove Unused CSS and Load CSS
 * asynchronously (`Page.php`): the merged card's name when neither applied.
 * A card heading, not a report row.
 */
export const LABEL_OPTIMIZE_CSS_DELIVERY = 'Optimize CSS delivery';

/** The Priority Elements family rows (the beacon's four features + its row). */
/** Support-data name (`Support/Data.php`; no settings field — always on unless filtered). */
export const LABEL_OPTIMIZE_CRITICAL_IMAGES = 'Optimize Critical Images';
/** Support-data name (`Support/Data.php`; no settings field). */
export const LABEL_AUTOMATIC_LAZY_RENDERING = 'Automatic Lazy Rendering';
/** Settings field (`Page.php`, `auto_preload_fonts`, Image & Media › Fonts). */
export const LABEL_PRELOAD_FONTS = 'Preload fonts';
/**
 * Admin-bar notice (`PerformanceHints/Admin/AdminBar.php`) — the plugin's only
 * name for it (no settings field, no support-data row).
 */
export const LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS = 'Preconnect to External Domains';
/**
 * The shared measurement beacon: the tool's own name (the plugin names no
 * user-facing feature for it; "Priority Elements" is its documentation term).
 */
export const LABEL_PRIORITY_ELEMENTS_BEACON = 'Priority Elements beacon';

/**
 * Compact names where space or a list of several features calls for them
 * (the HUD strip's chips, a simulated page's banner); LazyLoad is the
 * settings section title {@link LABEL_IMAGE_LAZYLOAD}'s field sits under.
 */
export const SHORT_LABEL_DELAY_JS = 'Delay JS';
/** See {@link SHORT_LABEL_DELAY_JS}. */
export const SHORT_LABEL_DEFER_JS = 'Defer JS';
/** See {@link SHORT_LABEL_DELAY_JS}. */
export const SHORT_LABEL_LAZYLOAD = 'LazyLoad';

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
  LABEL_CDN,
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
