/**
 * Element, attribute and selector constants of WP Rocket's page footprints —
 * the single declaring site for everything both the detection engine and the
 * test-only reference engine (the parity baseline) read on a served page, plus
 * the trivial extractors over that vocabulary. Every string is pinned by the
 * literal assertions in `constants.test.ts`; consumers import from here instead
 * of re-typed copies so the vocabulary can never drift between surfaces.
 */

/** Attribute WP Rocket uses on delayed scripts to carry the original `src`. */
export const DELAY_JS_SRC = 'data-rocket-src';

/** Attribute marking resources excluded from local tooling processing. */
export const FDT_EXCLUDED_RESOURCE = 'data-wpr-fdt-excluded';

/** Attribute WP Rocket adds to scripts it defers. */
export const WPR_DEFER_ATTRIBUTE = 'data-rocket-defer';

/** Attribute marking WP Rocket-preloaded subresources on `link` elements. */
export const WPR_PRELOAD_ATTRIBUTE = 'data-rocket-preload';

/** Diagnoser script element ids: pages embed the plugin report as JSON text nodes. */
export const DIAGNOSER_NO_ROCKET_DATA_ID = 'wpr-diagnoser-no-rocket-json-data';
export const DIAGNOSER_ROCKET_DATA_ID = 'wpr-diagnoser-rocket-json-data';

/**
 * Type-attribute value on delayed scripts from WP Rocket versions before 3.20.6.
 */
export const DELAY_JS_TYPE_OLD = 'rocketlazyloadscript';

/**
 * Type-attribute value on delayed scripts from WP Rocket 3.20.6+
 * (the type became MIME-like; see the plugin changelog of that release).
 */
export const DELAY_JS_TYPE_CURRENT = `text/${DELAY_JS_TYPE_OLD}`;

/**
 * Every Delay JS type value, oldest first. Extend when the plugin introduces
 * a new variant (then update both `isDelayJSType` tests and fixtures).
 */
export const DELAY_JS_TYPES = [DELAY_JS_TYPE_OLD, DELAY_JS_TYPE_CURRENT] as const;

/**
 * Whether a `type` attribute value belongs to a WP Rocket delayed script,
 * for pages produced by old or current versions alike.
 *
 * The old value is a literal substring of the current value, so one
 * `includes` covers both without false positives: no real script type
 * contains `rocketlazyloadscript` unless it is one of ours.
 *
 * @param type Raw `type` attribute value or null/undefined.
 */
export function isDelayJSType(type: string | null | undefined): boolean {
  if (!type) return false;
  return type.includes(DELAY_JS_TYPE_OLD);
}

/**
 * CSS attribute selector matching all delayed scripts' type values, valid for
 * `querySelectorAll` (comma-separated selector groups per CSS Selectors §5.1).
 */
export function delayJSScriptSelector(): string {
  return DELAY_JS_TYPES.map((type) => `script[type="${type}"]`).join(', ');
}

/** The inline Delay JS controller announces itself in its source. */
export const DELAY_JS_CONTROLLER = 'RocketLazyLoadScripts';

/** Delay JS version marker inside the controller. */
export const DELAY_JS_VERSION_PATTERN = /this\.v\s*=\s*"([^"]+)"/;

/** The image's pre-lazyload source attribute candidates (match-by-substring). */
export const DATA_SRC = 'data-src';
/** The replacement attribute WP Rocket's lazyload writes back (`src` carries it). */
export const DATA_LAZY_SRC = 'data-lazy-src';
/** …and its srcset variant. */
export const DATA_LAZY_SRCSET = 'data-lazy-srcset';

/** Lazyload script footprint by URL — both served layouts. */
export const LAZYLOAD_SCRIPT_PATTERN =
  /(wp-rocket\/assets\/js\/lazyload\/.*\/lazyload(\.min)?\.js)/;

/** Lazyload options blob tailored per media query (`img` selector). */
export const LAZYLOAD_IMG_OPTIONS_PATTERN = new RegExp(
  `window\\.lazyLoadOptions=(.*)img\\[${DATA_LAZY_SRC}\\]`
);
/** …and for iframes. */
export const LAZYLOAD_IFRAME_OPTIONS_PATTERN = new RegExp(
  `window\\.lazyLoadOptions=(.*)iframe\\[${DATA_LAZY_SRC}\\]`
);
/** YouTube thumbnail replacement helper (iframe preview images). */
export const LAZYLOAD_YOUTUBE_PATTERN =
  /function lazyLoadThumb\((.*)function lazyLoadYoutubeIframe\(\)/;

/**
 * Reasons an image is excluded from lazyload detection, in historic list order.
 *
 * Semantics are match-by-substring against the image's serialized HTML, so
 * entries intentionally mix attribute names (`data-src`), class-value anchors
 * (`class="ls-l`) and value fragments (`fullurl`); consumers of this list
 * (including the devtools sidebar pane expression) must keep matching exactly
 * like that — do not "clean up" an entry without comparing against real pages.
 */
export const LAZYLOAD_EXCLUSIONS_LIST = [
  DATA_SRC,
  'data-no-lazy',
  'data-lazy-original',
  DATA_LAZY_SRC,
  'data-lazysrc',
  'data-lazyload',
  'data-bgposition',
  'data-envira-src',
  'fullurl',
  'lazy-slider-img',
  'data-srcset',
  'class="ls-l',
  'class="ls-bg',
  'soliloquy-image',
  'loading="eager"',
  'swatch-img',
  'data-height-percentage',
  'data-large_image',
  'avia-bg-style-fixed',
  'data-skip-lazy',
  'skip-lazy',
  'class="skip-lazy"',
  'image-compare__',
  FDT_EXCLUDED_RESOURCE
] as const;

/** Remove Unused CSS: an inline `style` element with the reserved id. */
export const RUCSS_STYLE_SELECTOR = 'style#wpr-usedcss';

/** The inline Load-CSS-asynchronously fallback script calls this function. */
export const CPCSS_MARK = 'wprRemoveCPCSS';

/**
 * The served minify-cache directory shape — `cache/min/<site-id>/` — the atom
 * every minified-URL pattern composes, so the footprint cannot drift between
 * the detection patterns and the exclusion-path recovery helper.
 */
export const MINIFY_CACHE_DIR_SOURCE = 'cache\\/min\\/\\d+\\/';
/**
 * Served minified-asset URL footprint (`cache/min/<n>/<hash>….<ext>`) — one
 * base, one derived pattern per extension, so the fragment cannot drift.
 */
const MINIFIED_CACHE_URL_SOURCE = `(.*)${MINIFY_CACHE_DIR_SOURCE}[a-zA-Z0-9_](.*).`;
/** Minify CSS: stylesheet URLs under the minify cache. */
export const MINIFY_CSS_URL_PATTERN = new RegExp(`${MINIFIED_CACHE_URL_SOURCE}css(.*)`);
/** Minify JS: script URLs under the minify cache. */
export const MINIFY_JS_URL_PATTERN = new RegExp(`${MINIFIED_CACHE_URL_SOURCE}js(.*)`);

/** Preload links: the options blob script WP Rocket prints for the feature. */
export const PRELOAD_LINKS_SCRIPT_ID = 'rocket-preload-links-js-extra';

/** RocketCDN: the domain anchor a `dns-prefetch` hint points at. */
export const ROCKET_CDN_DOMAIN = '.rocketcdn.me';

/** Lazyload for CSS background images: the reserved container elements. */
export const LAZYLOAD_BG_CONTAINER_ID = 'wpr-lazyload-bg-container';
export const LAZYLOAD_BG_EXCLUSION_ID = 'wpr-lazyload-bg-exclusion';

/**
 * Automatic Lazy Rendering: attribute stamping the elements the feature
 * converted (present only on a page whose applied row was used).
 */
export const LAZY_RENDER_ATTRIBUTE = 'data-wpr-lazyrender';
/** …and the inline style id the feature adds when ≥ 1 element was converted. */
export const LAZY_RENDER_INLINE_CSS_ID = 'rocket-lazyrender-inline-css';
/**
 * Attribute carrying the render hash the plugin stamps on every render while
 * Lazy Rendering is enabled and strips once applied (or bypassed) — the
 * collecting-phase evidence for that feature.
 */
export const LOCATION_HASH_ATTRIBUTE = 'data-rocket-location-hash';

/** Prefetch-variant attribution attribute on the dns-prefetch hints the plugin emits. */
export const ROCKET_PREFETCH_ATTRIBUTE = 'data-rocket-prefetch';
/** Preconnect-variant attribution attribute (the filter variant's crossorigin hints). */
export const ROCKET_PRECONNECT_ATTRIBUTE = 'data-rocket-preconnect';

/** The measurement beacon script's marker attribute value. */
export const BEACON_DATA_NAME = 'wpr-wpr-beacon';

/**
 * Beacon script URL fallback: the assets path, min-agnostic — catches builds
 * whose tags were mutated by other optimizers and the SCRIPT_DEBUG variant
 * that drops the `.min` suffix. (Same match-by-substring shape as
 * `LAZYLOAD_SCRIPT_PATTERN`.)
 */
export const BEACON_SRC_PATTERN = /(wp-rocket\/assets\/js\/wpr-beacon(\.min)?\.js)/;

/**
 * The inline config script that precedes the beacon tag; everything after the
 * match (trailing `;`/whitespace tolerated) is the config JSON.
 */
export const BEACON_CONFIG_PATTERN = /^\s*var\s+rocket_beacon_data\s*=/;

/** Trailing semicolons/whitespace tolerated after the inline config's JSON. */
export const BEACON_CONFIG_TRAILING_NOISE = /[\s;]+$/;

/**
 * The beacon config's per-feature enablement keys, plugin-verified: a present
 * boolean key = that feature's context was allowed at injection time; an
 * absent key (or an explicit `false`) = disabled/blocked. The preconnect key
 * is singular — the plugin's own spelling.
 */
export const BEACON_STATUS_KEYS = [
  'atf',
  'lrc',
  'preload_fonts',
  'preconnect_external_domain'
] as const;

/**
 * The beacon config's array-payload fields (the plugin's own field names,
 * kept verbatim — they are the support value a config viewer renders).
 */
export const BEACON_CONFIG_LIST_FIELDS = [
  'preconnect_external_domain_elements',
  'preconnect_external_domain_exclusions',
  'preload_fonts_exclusions',
  'processed_extensions',
  'external_font_exclusions'
] as const;

/**
 * Size caps for parsing the inline beacon config (untrusted page data):
 * every violation degrades the whole config (the beacon tag stays the row's
 * evidence). Generous — real configs sit orders of magnitude below.
 */
export const BEACON_CONFIG_LIMITS = {
  /** The config JSON/literal text before parsing (bounds the parse itself). */
  text: 65_536,
  /** The comma-joined `elements` selector string. */
  elements: 4096,
  /** Each array-payload field: item count and per-item length. */
  lists: { count: 500, chars: 4096 },
  /** The `status` map: key count, and per-value length for preserved strings. */
  status: { keys: 32, chars: 4096 }
} as const;

/** A WP Rocket feature-support comment's data (`wpr_oci`, …) after trimming. */
export const FEATURE_COMMENT_PATTERN = /^\s*wpr_[a-z0-9_]+\s*$/;

/** Optimize critical images' feature comment (corroboration only — see below). */
export const OPTIMIZE_CRITICAL_IMAGES_COMMENT = 'wpr_oci';

/** Generator meta declaring the active optimization plugins. */
export const GENERATOR_META_SELECTOR = 'meta[name="generator"]';

/**
 * The feature-declaration attribute on that generator meta: since 3.17.2 the
 * plugin lists its active features as whitespace-separated tokens (`wpr_cdn
 * wpr_delay_js …`) on the same tag that names it. Its presence is the
 * meta-authoritative evidence class for feature verdicts; its absence (tag
 * with or without the attribute) leaves footprint evidence in charge.
 */
export const WPR_FEATURES_ATTRIBUTE = 'data-wpr-features';

/**
 * Selector for the generator meta that carries {@link WPR_FEATURES_ATTRIBUTE},
 * derived from its parts so the generator prefix can never drift from
 * {@link GENERATOR_META_SELECTOR}.
 */
export const WPR_FEATURES_META_SELECTOR = `${GENERATOR_META_SELECTOR}[${WPR_FEATURES_ATTRIBUTE}]`;

/** WP Rocket's name as it formats the generator content (`WP Rocket`, `WP-Rocket`…). */
export const WPR_NAME_PATTERN = /wp\s*-?\s*rocket/i;

/** Version match: the name, split across optional separators, then the digits. */
export const WPR_VERSION_PATTERN = new RegExp(
  `${WPR_NAME_PATTERN.source}[/\\s:;v=]*\\s*([0-9]+(?:\\.[0-9]+){0,3})`,
  'i'
);

/**
 * WP Rocket version from a generator meta content, or null. Accepts
 * `WP Rocket 3.12`, `WP-Rocket 3.12.1.1`, `wp/rocket:3.20`… —
 * generously as WP Rocket itself formats the content variously.
 *
 * @param metaContent The generator meta's raw content.
 */
export function extractWprVersion(metaContent: string): string | null {
  return metaContent.match(WPR_VERSION_PATTERN)?.[1] ?? null;
}

/** WordPress core's name in a generator meta content (`WordPress 6.8.1`). */
export const WORDPRESS_NAME_PATTERN = /wordpress/i;

/**
 * Version match after the WordPress name: one leading digit required, then
 * digits/dots greedy, then any word tail. (The audit round's robustness
 * deviation: the parity pattern captured a bare `.` from a crafted
 * `WordPress .` — rendering a dot as a "version" reads as data; abstention
 * is the honest answer, so the digit requirement replaces raw parity here.)
 */
export const WORDPRESS_VERSION_PATTERN = new RegExp(
  `${WORDPRESS_NAME_PATTERN.source}\\s*(\\d[\\d.]*\\w*)`,
  'i'
);

/**
 * WordPress version from a generator meta content, or null.
 *
 * @param metaContent The generator meta's raw content.
 */
export function extractWordPressVersion(metaContent: string): string | null {
  return metaContent.match(WORDPRESS_VERSION_PATTERN)?.[1] ?? null;
}

/** Slug of the cache marker comment WP Rocket writes. */
export const CACHE_COMMENT_MARKER = 'This website is like a Rocket';

/** Debug marker that marks a served cached page. */
export const CACHE_DEBUG_MARKER = 'Debug: cached';

/** Timestamp suffix of the debug marker (`cached@<seconds>`). */
export const CACHE_TIMESTAMP_PATTERN = /cached@(.*)/;

/** One platform distinguishable by response headers. */
export interface KnownPlatformHeader {
  headerName: string;
  value?: string;
}

/**
 * Platforms detected from main-frame response headers. A row matches when
 * every declared header is present (and equal to the expected value, when set).
 */
export const KNOWN_PLATFORMS: ReadonlyMap<string, readonly KnownPlatformHeader[]> = new Map([
  [
    'WP Engine',
    [
      {
        headerName: 'X-Powered-By',
        value: 'WP Engine'
      }
    ]
  ],
  ['Kinsta', [{ headerName: 'X-Kinsta-Cache' }]],
  [
    'Hostinger',
    [
      {
        headerName: 'Platform',
        value: 'hostinger'
      }
    ]
  ]
]);

/** Identifier the main world substitutes for cross-origin "Script error." messages. */
export const UNDEFINED_REFERENCE_EXTERNAL_ERROR = '__EXTERNAL_ORIGIN_ERROR__';

/** Hourly KC-DB refresh alarm name (background owns firing, storage owns data). */
export const ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB = 'update-known-conflicts-db';

/** Context menu ids created by the background; click handlers must match exactly. */
export const CONTEXT_MENU_IDS = {
  wprSideBySide: 'wprSideBySide',
  psiSideBySide: 'psiSideBySide',
  updateKnownConflictsDB: 'updateKnownConflictsDB',
  exclusionBuilderPage: 'exclusionBuilderPage',
  /** Toggles the on-page detection widget for the clicked page's origin. */
  toggleDetectionWidget: 'toggleDetectionWidget'
} as const;

/**
 * The exclusion builder's packaged page path — the tab both its openers
 * (the background's context-menu entry and the panel's palette action)
 * resolve; a second caller re-typing it would be the re-typed-value defect.
 */
export const EXCLUSION_BUILDER_PAGE = 'exclusion-builder.html';

/**
 * URL patterns the header capture listeners and content-script declarations
 * run on: every main frame over http(s). Also fed into the manifest's
 * `host_permissions` — single-sourced here so the list can never drift
 * between the manifest and the runtime listeners.
 */
export const URL_PATTERNS = ['https://*/*', 'http://*/*'] as const;
