/**
 * Shapes crossing surfaces: detection results, header captures, panel-side
 * lookups. These are contracts — fields are added additively and validated at
 * boundaries (`lib/messaging/validate`); never shrink an established shape.
 */

/** One response header as captured by the background (`webRequest` shape). */
export interface PageHeader {
  name: string;
  value?: string;
}

/** Page headers of the inspected page's main frame, in capture order. */
export type PageHeaders = readonly PageHeader[];

/** Per-script delayed/deferred classification for Delay JS. */
export interface DelayedScriptRecord {
  /** Inline scripts carry their full text in `content`. */
  inline: boolean;
  /** Deferred scripts whose original URL moved to `data-rocket-src` carry it in `src`. */
  src?: string;
  /** Full inline script text (renders by truncation only downstream). */
  content?: string;
  /** The script is delayed by WP Rocket (its type matches `DELAY_JS_TYPES`). */
  delayed: boolean;
  /** The script carries a native `defer` attribute. */
  deferred: boolean;
  /** The script is deferred by WP Rocket (`data-rocket-defer`). */
  deferredByWPR: boolean;
  /** Value of the local exclusion marker attribute, when present. */
  fdtExcluded: string | null;
}

/** One image classified by the lazyload check. */
export interface LazyloadImageRecord {
  /**
   * Display URL: `data-lazy-src` when the image is lazyloaded, otherwise
   * `data-src`, then the resolved `src`, then ''. ('' because the resolved
   * src property is '' — not undefined — whenever the attribute is absent.)
   */
  src: string;
  /** The image is subject to client-side lazyload (`data-lazy-src`/`-srcset`). */
  lazyloadDetected: boolean;
  /** Reasons the image escapes lazyload, from `LAZYLOAD_EXCLUSIONS_LIST` order. */
  excludedReasonsFound: string[];
}

/**
 * The complete page classification. Structural keys are fixed; extend only
 * additively (new optimizations ship with their own key + validators + tests).
 */
export interface WprDetections {
  wpr: {
    present: boolean;
    cached: boolean;
    version: string | null;
    /** Cache timestamp from the debug comment (seconds since epoch). */
    timeStamp: number | null;
  };
  remove_unused_css: {
    present: boolean;
  };
  delay_js: {
    present: boolean;
    scripts: DelayedScriptRecord[];
    version: string | null;
    delayedScripts: number;
  };
  defer_all_js: {
    present: boolean;
    /** `data-rocket-src` or `src` of every WP Rocket-deferred script, doc order. */
    scripts: string[];
  };
  async_css: {
    present: boolean;
  };
  lazyload: {
    present: boolean;
    /** One record per <img> element, document order. */
    images: LazyloadImageRecord[];
  };
  lazyload_iframes: {
    present: boolean;
    /** The iframe-to-preview-image replacement script is present too. */
    replaceImage: boolean;
  };
  lazyload_css_bg_img: {
    present: boolean;
  };
  minify_css: {
    present: boolean;
  };
  minify_js: {
    present: boolean;
  };
  preload_links: {
    present: boolean;
  };
  rocket_cdn: {
    present: boolean;
  };
  rocket_above_the_fold_optimization: {
    present: boolean;
    /** The beacon script is present (as opposed to preloaded images only). */
    beacon: boolean;
    /** Resolved URLs of `data-rocket-preload` image links, document order. */
    preloadedImages?: string[];
  };
}

/** WP Rocket-preloaded resources collected for the panel page. */
export interface PreloadedResources {
  present: boolean;
  resources?: Array<{
    /** Resolved href (property). */
    href: string;
    /** `as` property value ('' when the attribute is absent). */
    type: string;
  }>;
}

/** Anything the panel needs about the current page, served by the content script. */
export interface FdtData {
  allScriptsLoaded: boolean;
  /** Header list or null when nothing was captured for this tab. */
  pageHeaders: PageHeaders | null;
  undefinedReferencesOnPage: string[];
  wprDetections: WprDetections;
  preloadedResources: PreloadedResources;
  /** Set once the diagnoser report was parsed; null components mean unparsable/absent. */
  diagnoserData: DiagnoserDocData | null;
}

/**
 * DevTools search action ids, single-sourced: senders, the panel and the
 * boundary validator branch on these exact values.
 */
export const PANEL_SEARCH_ACTIONS = {
  performSearch: 'performSearch',
  cancelSearch: 'cancelSearch',
  nextSearchResult: 'nextSearchResult',
  previousSearchResult: 'previousSearchResult'
} as const;

/** DevTools search action relayed to the panel (`panel` message). */
export type PanelSearchAction =
  | { action: typeof PANEL_SEARCH_ACTIONS.performSearch; query: string }
  | {
      action: Exclude<keyof typeof PANEL_SEARCH_ACTIONS, typeof PANEL_SEARCH_ACTIONS.performSearch>;
    };

/**
 * Diagnoser report as parsed from the page. Values come from page JSON and
 * are validated structurally on arrival; fields future plugin releases add
 * stay reachable through the index signatures.
 */
export interface DiagnoserDocData {
  noRocketData: NoRocketData | Record<string, unknown> | null;
  rocketData: RocketData | Record<string, unknown> | null;
}

/** `#wpr-diagnoser-no-rocket-json-data` payload (site + server environment). */
export interface NoRocketData {
  wpr_plugin?: Record<string, unknown>;
  get_rocket_option?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  server_info?: {
    server_load?: unknown;
    web_server?: unknown;
    php_memory_limit?: unknown;
    wp_memory_limit?: unknown;
    wp_max_memory_limit?: unknown;
    [key: string]: unknown;
  };
  constants?: Record<string, unknown>;
  /** RUCSS preload task rows (shape varies by plugin version — narrowed at render). */
  preload_rucss_tasks?: unknown;
  preload_rucss_parameters?: Record<string, unknown>;
  querystrings?: Record<string, unknown>;
  user_agent?: unknown;
  imagify?: Record<string, unknown>;
  wpr_diagnoser_version?: unknown;
  [key: string]: unknown;
}

/** One diagnoser option row: current value plus how the option behaves. */
export interface RocketOptionEntry {
  option_name: string;
  get_rocket_option: Record<string, unknown>;
  filters: Record<string, unknown>;
  [key: string]: unknown;
}

/** `#wpr-diagnoser-rocket-json-data` payload (per-option state of the site). */
export interface RocketData {
  options: Record<string, RocketOptionEntry>;
  post_meta_excluded_options: Record<string, boolean>;
  [key: string]: unknown;
}
