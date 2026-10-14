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
 * Optimize critical images (Priority Elements family; the plugin's filter
 * identifier as the registry key — KB: "Optimize critical images").
 */
export interface OptimizeCriticalImagesDetection {
  present: boolean;
  /**
   * The `<!-- wpr_oci -->` feature comment survived on the page. Corroboration
   * only: the plugin strips these comments when the meta generator runs (and
   * always under white-label or for logged-in users), so a `false` proves
   * nothing; `fetchpriority="high"` alone also proves nothing — it is a
   * standard attribute third parties set.
   */
  lcpComment: boolean;
  /**
   * Resolved URLs of `data-rocket-preload` image links, document order.
   * Present ⇔ non-empty (the applied evidence; an empty list means not
   * applied, with or without the beacon).
   */
  preloadedImages?: string[];
}

/**
 * Automatic Lazy Rendering (Priority Elements family; registry key = the
 * plugin's real feature-comment id, KB: "Automatic Lazy Rendering").
 *
 * Evidence-pure: `present` requires applied markup; the collecting phase
 * (feature enabled, not yet applied) surfaces through `locationHashes` > 0
 * with `present: false` — the view model composes "collecting" with the
 * beacon row's status map.
 */
export interface AutomaticLazyRenderingDetection {
  /** ≥ 1 element stamped `data-wpr-lazyrender`. */
  present: boolean;
  /** Count of stamped elements. */
  lazyRenderElements: number;
  /**
   * The feature's inline `content-visibility` style is present — corroborates
   * `present` (the plugin adds it iff ≥ 1 element was converted) but a page
   * may carry it in any combination.
   */
  inlineCssPresent: boolean;
  /** Render hashes still on the page (0 once applied or bypassed). */
  locationHashes: number;
}

/**
 * Preload fonts (Priority Elements family; registry key = the plugin option
 * `auto_preload_fonts`, KB: "Preload fonts").
 *
 * The attribution attribute (`data-rocket-preload`) is what separates the
 * automatic feature from pre-3.19 manual font preloads and third-party font
 * preloads — same markup, no attribute.
 */
export interface AutoPreloadFontsDetection {
  present: boolean;
  /** Resolved hrefs of attributed font preloads, document order. Present ⇔ non-empty. */
  fonts: string[];
}

/**
 * Preconnect to external domains (Priority Elements family; registry key = the
 * plugin's feature-comment id, KB: "Preconnect to external domains").
 */
export interface PreconnectExternalDomainsDetection {
  present: boolean;
  /**
   * Attributed hint hrefs (both variants), first-occurrence order — a bare
   * dns-prefetch hint (e.g. the RocketCDN one) asserts nothing here; the
   * attribution attributes are the whole claim. Present ⇔ non-empty.
   */
  domains: string[];
  /** Count of the `data-rocket-preconnect` (crossorigin) variant links. */
  preconnectCount: number;
}

/**
 * Per-feature enablement from the inline beacon config's `status` map: a
 * present boolean key = that feature's context was allowed at injection time;
 * an absent key = disabled (option/filter/helper). Keys are the plugin's own
 * identifiers, kept verbatim; future releases' keys stay readable through the
 * index signature. Note the plugin's asymmetry (verified in source): the
 * fonts controller omits its key when disallowed while the others set theirs
 * to `false` — both states mean "not enabled here".
 */
export interface BeaconFeatureStatus {
  /** Optimize critical images. */
  atf?: boolean;
  /** Automatic Lazy Rendering. */
  lrc?: boolean;
  /** Preload fonts. */
  preload_fonts?: boolean;
  /** Preconnect to external domains (singular key, plugin-verified). */
  preconnect_external_domain?: boolean;
  [key: string]: unknown;
}

/**
 * The Priority Elements measurement beacon (the family all four features
 * above share): `<script data-name="wpr-wpr-beacon" …>` plus its inline
 * config (`var rocket_beacon_data = {…}`). The plugin injects the pair iff
 * ≥ 1 enabled feature still lacks its applied row for this URL+device, so
 * presence proves "collecting / not yet applied for at least one feature" —
 * never an error state, and never any single feature's verdict. Once every
 * enabled feature is applied the beacon is gone from the cached page; a
 * pending state can also persist legitimately (ineligible viewports, headless
 * visits, no pre-warmup).
 */
export interface PriorityElementsBeaconDetection {
  present: boolean;
  /**
   * Per-feature enablement from the inline config — null when the config is
   * absent, unparsable or hostile (the beacon tag alone is still evidence).
   */
  status: BeaconFeatureStatus | null;
  /** Visiting device the config was generated for; null when not declared/usable. */
  isMobile: boolean | null;
  /**
   * Comma-joined selector list the beacon was told to process (config field
   * `elements`, kept verbatim — it is a single string in the plugin's output).
   */
  elements?: string;
  /** Config payload lists (plugin field names kept verbatim): support value. */
  preconnect_external_domain_elements?: string[];
  preconnect_external_domain_exclusions?: string[];
  preload_fonts_exclusions?: string[];
  processed_extensions?: string[];
  external_font_exclusions?: string[];
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
  rocket_above_the_fold_optimization: OptimizeCriticalImagesDetection;
  automatic_lazy_rendering: AutomaticLazyRenderingDetection;
  auto_preload_fonts: AutoPreloadFontsDetection;
  preconnect_external_domains: PreconnectExternalDomainsDetection;
  priority_elements_beacon: PriorityElementsBeaconDetection;
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

/**
 * WP Rocket-managed cookie names captured off the page, values redacted at
 * the read: what debugging needs is which cookies exist (`wprocket`,
 * `fallback`), never what they carry — values may hold auth tokens and are
 * not even materialized by the capture (see `lib/wp-rocket/cookies`).
 */
export interface PageCookies {
  /** Unique cookie names, first-occurrence order. */
  names: string[];
  /** Wall-clock ms when the capture read `document.cookie`. */
  capturedAt: number;
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
  /**
   * The page's cookie names (values redacted at capture). Additive: payloads
   * captured before this field existed omit it, and consumers treat its
   * absence as graceful omission — never as a broken payload.
   */
  cookies?: PageCookies;
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

/**
 * The narrowed search event as Chrome carries it (action + query on
 * `performSearch`): the pure event-mapping's output, before any relay tab
 * scope exists — the relay attaches `tabId` at send time.
 */
export type PanelSearchEventPayload =
  | { action: typeof PANEL_SEARCH_ACTIONS.performSearch; query: string }
  | {
      action: Exclude<keyof typeof PANEL_SEARCH_ACTIONS, typeof PANEL_SEARCH_ACTIONS.performSearch>;
    };

/**
 * DevTools search action relayed to the panel (`panelSearch` message). The
 * payload carries `tabId` — the relaying devtools page's inspected tab —
 * because an extension send has no runtime sender tab to scope with, so this
 * field is the panel's only way to drop actions relayed by another DevTools
 * window (the protocol header's one documented tabId-payload exception).
 */
export type PanelSearchAction =
  | {
      action: typeof PANEL_SEARCH_ACTIONS.performSearch;
      query: string;
      /** The relaying devtools page's inspected tab id (the delivery's scope). */
      tabId: number;
    }
  | {
      action: Exclude<keyof typeof PANEL_SEARCH_ACTIONS, typeof PANEL_SEARCH_ACTIONS.performSearch>;
      /** The relaying devtools page's inspected tab id (the delivery's scope). */
      tabId: number;
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
