/**
 * Shapes crossing surfaces: detection results, header captures, panel-side
 * lookups. These are contracts — fields are added additively and validated at
 * boundaries (`lib/messaging/validate`); never shrink an established shape.
 */

/**
 * The mark a producer sets on a row it bounded to the boundary's size caps
 * (`lib/messaging/payload-bounds`): the row's lists keep their first entries
 * and its strings are clipped. Additive and optional — absent means complete,
 * and readers that ignore it still read a valid (partial) row.
 */
export interface TruncationMark {
  /** Present (always `true`) only when the producer cut this row to its caps. */
  truncated?: true;
}

/**
 * One response header as the background serves it (`webRequest` shape),
 * already through the redaction rule (`lib/redaction`): a secret-bearing
 * value never leaves the capture. Ordinary rows carry their (URL-reduced)
 * `value`; a withheld row carries `redacted: true` and NO `value`, so a
 * reader unaware of the flag sees a valueless row, never a secret.
 */
export interface PageHeader {
  name: string;
  /** The value, reduced by the rule; absent on valueless and withheld rows. */
  value?: string;
  /** Additive: present (always `true`) only when the capture withheld the value. */
  redacted?: true;
  /**
   * Additive, only beside `redacted`: the cookie a withheld `Set-Cookie`
   * set (caching evidence); its value and attributes are never kept.
   */
  cookieName?: string;
}

/** Page headers of the inspected page's main frame, in capture order. */
export type PageHeaders = readonly PageHeader[];

/**
 * One tab's header capture as the background serves it: the bounded rows,
 * marked when the capture had more rows or longer names/values than the
 * boundary admits.
 */
export interface PageHeaderCapture extends TruncationMark {
  headers: PageHeaders;
}

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
 * Optimize Critical Images (Priority Elements family; the plugin's filter
 * identifier as the registry key — support-data name "Optimize Critical Images").
 */
export interface OptimizeCriticalImagesDetection extends TruncationMark {
  /**
   * The feature verdict. Meta authority can declare it while the served
   * markup carries no preload (the list below is then absent); footprint
   * evidence needs the preloads.
   */
  present: boolean;
  /** The evidence class that decided the verdict, when one did. */
  source?: FeatureEvidenceSource;
  /**
   * The `<!-- wpr_oci -->` feature comment survived on the page. Corroboration
   * only: the plugin strips these comments when the meta generator runs (and
   * always under white-label or for logged-in users), so a `false` proves
   * nothing; `fetchpriority="high"` alone also proves nothing — it is a
   * standard attribute third parties set.
   */
  lcpComment: boolean;
  /**
   * Resolved URLs of `data-rocket-preload` image links, document order — the
   * observed markup, independent of the verdict: a meta-declared feature may
   * carry no preload on a stripped or partial render (the field stays absent),
   * and a meta-refuted render may still show remnant preloads.
   */
  preloadedImages?: string[];
}

/**
 * Automatic Lazy Rendering (Priority Elements family; registry key = the
 * plugin's real feature-comment id, KB: "Automatic Lazy Rendering").
 *
 * `present` is the feature verdict: meta authority can declare the feature
 * even when the served markup is partial, while the counts below stay the
 * observed markup. The collecting phase (feature enabled, not yet applied)
 * surfaces through `locationHashes` > 0 with `present: false` — the view
 * model composes "collecting" with the beacon row's status map.
 */
export interface AutomaticLazyRenderingDetection extends BuilderFactField {
  /** The feature verdict (meta declaration included). */
  present: boolean;
  /** The evidence class that decided the verdict, when one did. */
  source?: FeatureEvidenceSource;
  /** Count of elements stamped `data-wpr-lazyrender` (observed markup). */
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
export interface AutoPreloadFontsDetection extends TruncationMark {
  /** The feature verdict; meta authority can declare it without markup. */
  present: boolean;
  /**
   * Resolved hrefs of attributed font preloads, document order — observed
   * markup, which can be empty under a meta declaration.
   */
  fonts: string[];
  /** The evidence class that decided the verdict, when one did. */
  source?: FeatureEvidenceSource;
}

/**
 * Preconnect to External Domains (Priority Elements family; registry key = the
 * plugin's feature-comment id, admin-bar name "Preconnect to External Domains").
 */
export interface PreconnectExternalDomainsDetection extends TruncationMark {
  /** The feature verdict; meta authority can declare it without markup. */
  present: boolean;
  /** The evidence class that decided the verdict, when one did. */
  source?: FeatureEvidenceSource;
  /**
   * Attributed hint hrefs (both variants), first-occurrence order — a bare
   * dns-prefetch hint (e.g. the RocketCDN one) asserts nothing here; the
   * attribution attributes are the whole claim. Observed markup, which can be
   * empty under a meta declaration.
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
 * The evidence class that decided a feature row's verdict: the generator
 * meta declared (or refuted) the feature, or a page footprint proved it.
 * Only decided rows carry the field — a row with no deciding evidence (no
 * meta declaration and no footprint) stays honest with no `source`.
 */
export type FeatureEvidenceSource = 'meta' | 'footprint';

/**
 * What the Exclusion Builder's rewrite did to one feature on the displayed
 * document, read from the marker the rewrite left in it (never inferred):
 * turned off feature-wide (`off: 'feature'`), turned off for this page by
 * rows that make WP Rocket run it on nothing (`off: 'page'`, Defer JS only),
 * or `excluded` elements (1–9999) restored by its rows. The served verdict
 * (`present`/`source`) stays what WP Rocket served; this is the in-tab
 * modifier on top of it.
 */
export type BuilderFact =
  | { readonly off: 'feature' | 'page' }
  | {
      /** Elements the rows restored (1–9999; the marker clamps larger counts). */
      readonly excluded: number;
    };

/**
 * The detection rows an Exclusion Builder fact can annotate — exactly the
 * builder's features, whose ids are these row keys.
 */
export type BuilderFactRow = 'delay_js' | 'defer_all_js' | 'automatic_lazy_rendering' | 'lazyload';

/**
 * The additive builder field of a {@link BuilderFactRow}: absent unless the
 * document carries a valid builder marker naming the feature.
 */
export interface BuilderFactField {
  /** The builder's effect on this feature in this tab, when the document states one. */
  builder?: BuilderFact;
}

/**
 * Whether the displayed document's simulation of a feature is vouched for:
 * `simulated` — the page carries this extension's simulation marker and
 * the background confirmed it wrote that marker for this tab and origin, so
 * the feature's footprints are the extension's work, not WP Rocket's
 * (verdict not applied, version unknown, inventory kept); `unverified` —
 * the page carries a well-formed marker the background did not confirm
 * (forged, saved copy, another tab's, or no answer), so the verdicts stay
 * as served and only this annotation says so.
 */
export type SimulationFact = 'simulated' | 'unverified';

/**
 * The detection rows a simulation fact can annotate — exactly the
 * simulated features, whose ids are these row keys.
 */
export type SimulationFactRow = 'lazyload' | 'delay_js' | 'defer_all_js';

/**
 * The additive simulation field of a {@link SimulationFactRow}: absent
 * unless the document carries a well-formed simulation marker naming the
 * feature and WP Rocket's generator meta does not declare it.
 */
export interface SimulationFactField {
  /** Whether the feature was simulated in this tab (see {@link SimulationFact}). */
  simulation?: SimulationFact;
}

/**
 * The complete page classification. Structural keys are fixed; extend only
 * additively (new optimizations ship with their own key + validators + tests).
 */
export interface WprDetections {
  wpr: TruncationMark & {
    present: boolean;
    /**
     * The served HTML carries WP Rocket's cache-signature comment. True even
     * without the debug stamp: the plugin handled the page, but this visit's
     * cache state is not proven until `cached` is true.
     */
    cacheMarkerFound: boolean;
    /** The signature includes the cache debug stamp (`Debug: cached…`). */
    cached: boolean;
    version: string | null;
    /** Cache timestamp from the debug comment (seconds since epoch). */
    timeStamp: number | null;
  };
  remove_unused_css: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  delay_js: TruncationMark &
    BuilderFactField &
    SimulationFactField & {
      present: boolean;
      scripts: DelayedScriptRecord[];
      version: string | null;
      delayedScripts: number;
      /** The evidence class that decided the verdict, when one did. */
      source?: FeatureEvidenceSource;
    };
  defer_all_js: TruncationMark &
    BuilderFactField &
    SimulationFactField & {
      /** ≥ 1 script carries `data-rocket-defer` (inline/no-src scripts included). */
      present: boolean;
      /**
       * `data-rocket-src` or `src` of every WP Rocket-deferred script that
       * carries a URL, document order. Inline/no-src attributed scripts prove
       * presence but contribute no URL — `deferredScripts` counts them.
       */
      scripts: string[];
      /** Every attributed script, URL-bearing or not. */
      deferredScripts: number;
      /** The evidence class that decided the verdict, when one did. */
      source?: FeatureEvidenceSource;
    };
  async_css: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  lazyload: TruncationMark &
    BuilderFactField &
    SimulationFactField & {
      present: boolean;
      /** One record per <img> element, document order. */
      images: LazyloadImageRecord[];
      /** The evidence class that decided the verdict, when one did. */
      source?: FeatureEvidenceSource;
    };
  lazyload_iframes: {
    present: boolean;
    /** The iframe-to-preview-image replacement script is present too. */
    replaceImage: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  lazyload_css_bg_img: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  self_hosted_fonts: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  image_dimensions: {
    present: boolean;
    /**
     * The evidence class that decided the verdict, when one did. This row is
     * declaration-only: ordinary `width`/`height` attributes never attribute
     * the feature, so an undeclared page has no footprint to decide it.
     */
    source?: FeatureEvidenceSource;
  };
  minify_css: {
    /**
     * The feature verdict. A meta declaration means the minify stage ran, not
     * necessarily that any stylesheet was rewritten on this render (the
     * plugin appends its comment after the candidate loop).
     */
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  minify_js: {
    /**
     * The feature verdict. A meta declaration means the minify stage ran, not
     * necessarily that any script was rewritten on this render (the plugin
     * appends its comment after the candidate loop).
     */
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  preload_links: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  rocket_cdn: {
    present: boolean;
    /** The evidence class that decided the verdict, when one did. */
    source?: FeatureEvidenceSource;
  };
  rocket_above_the_fold_optimization: OptimizeCriticalImagesDetection;
  automatic_lazy_rendering: AutomaticLazyRenderingDetection;
  auto_preload_fonts: AutoPreloadFontsDetection;
  preconnect_external_domains: PreconnectExternalDomainsDetection;
  priority_elements_beacon: PriorityElementsBeaconDetection;
}

/**
 * Every detection row the generator meta can decide: all feature rows except
 * the plugin's identity row and the shared measurement beacon (neither is a
 * feature token).
 */
export type FeatureMetaRow = Exclude<keyof WprDetections, 'wpr' | 'priority_elements_beacon'>;

/** WP Rocket-preloaded resources collected for the panel page. */
export interface PreloadedResources extends TruncationMark {
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
  /** Unique cookie names, first-occurrence order (over-cap names by their clip). */
  names: string[];
  /**
   * Wall-clock ms when the capture read `document.cookie` — capped at the
   * boundary to the platform's representable-instant range
   * (`MAX_REPRESENTABLE_MS`), never a garbage `Date` downstream.
   */
  capturedAt: number;
}

/** Anything the panel needs about the current page, served by the content script. */
export interface FdtData {
  /** Immutable page capture identity for on-demand complete script copies. */
  scriptSnapshotId?: string;
  allScriptsLoaded: boolean;
  /** Header list or null when nothing was captured for this tab. */
  pageHeaders: PageHeaders | null;
  /**
   * The header list was bounded (rows dropped beyond the cap, or names/values
   * clipped). Additive: present only as `true`, only beside a non-empty list.
   */
  pageHeadersTruncated?: true;
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
  /**
   * The captured URL carried WP Rocket's cache-bypass parameter. Additive and
   * present only as `true`: absence means the URL did not attest a bypass,
   * never that the page was cached.
   */
  bypassAttested?: true;
  /**
   * The WordPress core version the page's generator meta declared. Additive
   * and present only when declared (within the version cap): absence means
   * undeclared or over-cap, never a version.
   */
  wordpressVersion?: string;
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
