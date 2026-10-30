/**
 * The WP Rocket simulation vocabulary — the one declaring site of what can
 * be simulated and of every closed value a simulation reports: the
 * simulated-feature registry, the step states and their reasons, the
 * limits it names (caveats, CSP), where its exclusion list came from, and
 * why its packaged runtime could be unavailable. The transforms, the
 * session contracts (`lib/messaging/exclusion-simulation`) and the UI map
 * over these lists, never re-type them.
 *
 * A leaf module (type-only imports): every bundle that guards a simulation
 * contract imports it without pulling any transform code.
 */
import type { ExclusionFeatureId } from '../exclusion-builder/set';

/** One WP Rocket feature the extension can simulate on a page served without it. */
export interface SimulatedFeatureSpec {
  /**
   * The feature's id — the exclusion builder's own id for the same WP
   * Rocket feature, so a simulation and its exclusion lane name one thing.
   */
  readonly id: ExclusionFeatureId;
}

/**
 * The simulated-feature registry, in the order the simulation steps run —
 * WP Rocket's own buffer order: LazyLoad (images), then Defer JS, then
 * Delay JS, each on the previous one's output (adding a feature is one row
 * here plus its step).
 */
export const SIMULATED_FEATURES = [
  { id: 'lazyload' },
  { id: 'defer_all_js' },
  { id: 'delay_js' }
] as const satisfies readonly SimulatedFeatureSpec[];

/** One simulated feature's id (see {@link SIMULATED_FEATURES}). */
export type SimulatedFeatureId = (typeof SIMULATED_FEATURES)[number]['id'];

/**
 * What a session asks to simulate on each of its documents (absent = no
 * simulation): the features, each once, in registry order or not — the
 * steps run in registry order whatever this order.
 */
export interface SimulateSpec {
  readonly features: readonly SimulatedFeatureId[];
}

/**
 * The pipeline stage that is a feature's simulation step (vs its
 * exclusion step, which names no stage) — on worker step announcements
 * and on an `over-budget` outcome.
 */
export type SimulationStage = 'simulate';

/**
 * A simulation step's outcome on one document:
 *
 * - `simulated` — the step ran: the page is what WP Rocket would serve.
 * - `already-served` — WP Rocket already applies the feature on this page:
 *   identity (exclusions apply to its real output).
 * - `csp-blocked` — the page's Content Security Policy blocks the inline
 *   runtime, as it would block WP Rocket's: identity.
 * - `not-applicable` — identity, for a {@link SimulationNotApplicableReason}.
 */
export const SIMULATION_STATES = [
  'simulated',
  'already-served',
  'csp-blocked',
  'not-applicable'
] as const;

/** One step outcome (see {@link SIMULATION_STATES}). */
export type SimulationState = (typeof SIMULATION_STATES)[number];

/**
 * Why LazyLoad's head and footer texts have no place on a page (see
 * `lazyload-hook-texts`): no `</head>`, no `</body>`, or every `</body>`
 * before the first `</head>`.
 */
export const LAZYLOAD_PLACEMENT_REFUSALS = [
  'no-head-end',
  'no-body-end',
  'body-end-before-head-end'
] as const;

/** Why a page's LazyLoad texts were not placed. */
export type LazyloadPlacementRefusal = (typeof LAZYLOAD_PLACEMENT_REFUSALS)[number];

/**
 * Why a step is `not-applicable`: an AMP document (WP Rocket never delays,
 * defers or lazy loads on one); a WordPress preview (`preview`: the page
 * URL sets the `preview` query variable), a search page (`search`: it
 * names the `s` query variable) or a page-builder editor
 * (`page-builder-editor`: `fl_builder`, `et_fb` or `ct_builder`), where WP
 * Rocket never lazy loads; a page LazyLoad's texts cannot be placed on (a
 * {@link LazyloadPlacementRefusal}); LazyLoad when the extension's packaged
 * copy of its runtime — the file the simulated page requests — is unusable
 * (`runtime-unavailable`; the other features still simulate); Defer JS on a page WP Rocket already delays
 * (`delay-js-served`: WP Rocket defers before it delays, and the served
 * page no longer holds the scripts as Defer JS would read them); a page
 * beyond exact reproduction — one of WP Rocket's regexes
 * could stop at PCRE's backtrack limit there, which the transform does not
 * reproduce (named by an {@link UnreproducedRegex}); or a page whose served
 * bytes the transform cannot count exactly (`unsupported-charset`: served
 * in a charset other than UTF-8 with non-ASCII text, or in UTF-16 — WP
 * Rocket's patterns and rows run over those bytes).
 */
export const SIMULATION_NOT_APPLICABLE_REASONS = [
  'amp',
  'preview',
  'search',
  'page-builder-editor',
  ...LAZYLOAD_PLACEMENT_REFUSALS,
  'runtime-unavailable',
  'delay-js-served',
  'beyond-exact-reproduction',
  'unsupported-charset'
] as const;

/** One not-applicable reason (see {@link SIMULATION_NOT_APPLICABLE_REASONS}). */
export type SimulationNotApplicableReason = (typeof SIMULATION_NOT_APPLICABLE_REASONS)[number];

/**
 * What LazyLoad's image pass cannot reproduce on a page, by the step that
 * could diverge from WP Rocket: a regex PCRE's backtrack limit could stop
 * (`lazyload-hidden-blocks`, `-pictures`, `-images`,
 * `-picture-image`: the per-picture image replacement), the per-picture
 * pattern's size too near PCRE's compiled-size cap
 * (`lazyload-picture-pattern-size`), an attribute regex on a tag too long
 * to bound (`lazyload-tag-length`), a dimension past 2^53
 * (`lazyload-dimension`), a URL `esc_url` handles through unported code
 * (`lazyload-url`), a named character reference outside the ported table
 * (`lazyload-entities`), or the `str_replace` replay past its work bound
 * (`lazyload-replacements`).
 */
export const LAZYLOAD_UNREPRODUCED = [
  'lazyload-hidden-blocks',
  'lazyload-pictures',
  'lazyload-images',
  'lazyload-picture-image',
  'lazyload-picture-pattern-size',
  'lazyload-tag-length',
  'lazyload-dimension',
  'lazyload-url',
  'lazyload-entities',
  'lazyload-replacements'
] as const;

/** One LazyLoad step beyond exact reproduction (see {@link LAZYLOAD_UNREPRODUCED}). */
export type LazyloadUnreproduced = (typeof LAZYLOAD_UNREPRODUCED)[number];

/**
 * The WP Rocket regexes whose backtrack-limit failure is not reproduced —
 * and `defer-replacements`: Defer JS's `str_replace` rescans of a page past
 * a bounded amount of work (WP Rocket's own run would take seconds there);
 * `defer-inline-exclusions`: Defer JS's inline exclusion pattern, whose
 * size is too near PCRE's compiled-size cap to tell whether it compiles;
 * `defer-file-exclusions`: Defer JS's file exclusion pattern joined with
 * the stored rows, whose pre-check verdict the list alone does not tell;
 * LazyLoad's own steps ({@link LAZYLOAD_UNREPRODUCED}); and
 * `lazyload-injected-scripts`: the Defer JS or Delay JS list in use would
 * defer, wrap or delay a script LazyLoad prints (its options script or
 * runtime tag), which WP Rocket's own lists never do — LazyLoad is then
 * not simulated rather than shown broken; `lazyload-runtime-url`: the
 * runtime tag's URL is longer than a report carries (the page and its
 * report could not name the same file).
 */
export const UNREPRODUCED_REGEXES = [
  'ie-conditionals',
  'ie-conditional-script',
  'xmp-mask',
  'svg-mask',
  'meta-charset',
  'html-comments',
  'defer-script-src',
  'defer-inline-scripts',
  'defer-replacements',
  'defer-inline-exclusions',
  'defer-file-exclusions',
  ...LAZYLOAD_UNREPRODUCED,
  'lazyload-injected-scripts',
  'lazyload-runtime-url'
] as const;

/** One unreproduced regex (see {@link UNREPRODUCED_REGEXES}). */
export type UnreproducedRegex = (typeof UNREPRODUCED_REGEXES)[number];

/**
 * What a Delay JS simulation cannot reproduce on a page, named so the UI
 * can say it. `combined-js`: the page serves WP Rocket's combined JS
 * bundles — with Delay JS on, WP Rocket turns Combine JS off, so the real
 * page would serve those scripts uncombined; the simulation cannot
 * un-combine them.
 */
export const DELAY_JS_CAVEATS = ['combined-js'] as const;

/**
 * What a LazyLoad simulation states about its page, beside WP Rocket's
 * exact output. Found on the page: `core-lazy-loading` — WordPress core
 * wrote `loading="lazy"` or `sizes="auto, …"` on images, which it would
 * not with LazyLoad on (their noscript copies and lazy carriers keep it);
 * `image-smilies` — a `wp-smiley` image, which WP Rocket's own smiley
 * filter would print differently; `foreign-lazy-markup` — another
 * plugin's lazy markup (`data-lazy-src`), lazy loaded again as WP Rocket
 * would. On every simulated page: `hook-text-placement` — where the theme
 * prints `wp_head`/`wp_footer` output is theme state; `runtime-url` — the
 * runtime's URL (plugin folder, content URL, CDN) is server state, taken
 * from page evidence; `above-the-fold-exclusions` — WP Rocket's
 * above-the-fold and LCP images (per-URL server data) are not excluded;
 * `site-filters` — a site's `rocket_lazyload_*` filters and options, and
 * the server state that turns LazyLoad off for a request (the
 * `DONOTLAZYLOAD`/`DONOTCACHEPAGE`/`DONOTROCKETOPTIMIZE` constants other
 * plugins define on pages they keep out of the cache), are not known.
 */
export const LAZYLOAD_CAVEATS = [
  'core-lazy-loading',
  'image-smilies',
  'foreign-lazy-markup',
  'hook-text-placement',
  'runtime-url',
  'above-the-fold-exclusions',
  'site-filters'
] as const;

/** One LazyLoad caveat (see {@link LAZYLOAD_CAVEATS}). */
export type LazyloadCaveat = (typeof LAZYLOAD_CAVEATS)[number];

/** The LazyLoad caveats every simulated page carries (the others are found on the page). */
export const LAZYLOAD_PAGE_INDEPENDENT_CAVEATS = [
  'hook-text-placement',
  'runtime-url',
  'above-the-fold-exclusions',
  'site-filters'
] as const satisfies readonly LazyloadCaveat[];

/** Every caveat a simulation can name (see {@link DELAY_JS_CAVEATS}, {@link LAZYLOAD_CAVEATS}). */
export const SIMULATION_CAVEATS = [...DELAY_JS_CAVEATS, ...LAZYLOAD_CAVEATS] as const;

/** One simulation caveat (see {@link SIMULATION_CAVEATS}). */
export type SimulationCaveat = (typeof SIMULATION_CAVEATS)[number];

/** The closed values one simulated feature's report can carry (see {@link SIMULATION_REPORT_VOCABULARY}). */
export interface SimulationReportVocabulary {
  /** The states it reaches. */
  readonly states: readonly SimulationState[];
  /** Its not-applicable reasons. */
  readonly reasons: readonly SimulationNotApplicableReason[];
  /** The regexes it can name as beyond exact reproduction. */
  readonly regexes: readonly UnreproducedRegex[];
  /** The caveats it can name. */
  readonly caveats: readonly SimulationCaveat[];
}

/**
 * Whether a regex id is LazyLoad's own (its steps, or its injected-scripts refusal).
 *
 * @param regex An unreproduced regex id.
 */
function isLazyloadRegex(regex: UnreproducedRegex): boolean {
  return regex.startsWith('lazyload-');
}

/** The reasons only LazyLoad reaches (preview, search, builders, placement, its runtime file). */
const LAZYLOAD_ONLY_REASONS: readonly SimulationNotApplicableReason[] = [
  'preview',
  'search',
  'page-builder-editor',
  ...LAZYLOAD_PLACEMENT_REFUSALS,
  'runtime-unavailable'
];

/** The regexes of the buffer's IE conditional extraction (every feature runs inside it). */
const IE_REGEXES: readonly UnreproducedRegex[] = ['ie-conditionals', 'ie-conditional-script'];

/**
 * Per feature, what its report can say — a report naming another
 * feature's value is malformed. Defer JS injects no runtime, so it is
 * never `csp-blocked`, and never names Delay JS's masks or its meta move;
 * `delay-js-served` is Defer JS's alone. Delay JS can name Defer JS's
 * regexes: with both on, Defer JS's passes run inside its buffer. LazyLoad
 * names its own steps and the buffer's IE extraction only (the later
 * features continue its buffer); its runtime's CSP is not evaluated, so it
 * is never `csp-blocked`; preview, search, builder, placement and
 * runtime-file reasons are its alone.
 */
export const SIMULATION_REPORT_VOCABULARY = {
  lazyload: {
    states: SIMULATION_STATES.filter((state) => state !== 'csp-blocked'),
    reasons: SIMULATION_NOT_APPLICABLE_REASONS.filter((reason) => reason !== 'delay-js-served'),
    regexes: UNREPRODUCED_REGEXES.filter(
      (regex) => isLazyloadRegex(regex) || IE_REGEXES.includes(regex)
    ),
    caveats: LAZYLOAD_CAVEATS
  },
  defer_all_js: {
    states: SIMULATION_STATES.filter((state) => state !== 'csp-blocked'),
    reasons: SIMULATION_NOT_APPLICABLE_REASONS.filter(
      (reason) => !LAZYLOAD_ONLY_REASONS.includes(reason)
    ),
    regexes: UNREPRODUCED_REGEXES.filter(
      (regex) =>
        !isLazyloadRegex(regex) &&
        regex !== 'xmp-mask' &&
        regex !== 'svg-mask' &&
        regex !== 'meta-charset'
    ),
    caveats: []
  },
  delay_js: {
    states: SIMULATION_STATES,
    reasons: SIMULATION_NOT_APPLICABLE_REASONS.filter(
      (reason) => reason !== 'delay-js-served' && !LAZYLOAD_ONLY_REASONS.includes(reason)
    ),
    regexes: UNREPRODUCED_REGEXES.filter((regex) => !isLazyloadRegex(regex)),
    caveats: DELAY_JS_CAVEATS
  }
} as const satisfies Record<SimulatedFeatureId, SimulationReportVocabulary>;

/**
 * Where LazyLoad's runtime URL came from (see `lazyload-assets-url`),
 * strongest evidence first: WP Rocket's beacon tag (exact), another
 * plugin's asset, a theme's asset, WordPress's default folders.
 */
export const LAZYLOAD_ASSETS_URL_SOURCES = [
  'beacon',
  'plugin-asset',
  'theme-asset',
  'default'
] as const;

/** Where the assets URL came from. */
export type LazyloadAssetsUrlSource = (typeof LAZYLOAD_ASSETS_URL_SOURCES)[number];

/** Where LazyLoad's head text went: before `</head>`, or before WP Rocket's generator meta abutting it. */
export const LAZYLOAD_HEAD_PLACEMENTS = ['before-end-tag', 'before-generator-meta'] as const;

/** Where LazyLoad's footer texts went: before `</body>`, or before WP Rocket's beacon block abutting it. */
export const LAZYLOAD_FOOTER_PLACEMENTS = ['before-end-tag', 'before-beacon-block'] as const;

/** End tags chosen among several (the theme's own one is not knowable). */
export const LAZYLOAD_PLACEMENT_FALLBACKS = [
  'first-of-several-head-ends',
  'last-of-several-body-ends'
] as const;

/** An end tag chosen among several. */
export type LazyloadPlacementFallback = (typeof LAZYLOAD_PLACEMENT_FALLBACKS)[number];

/**
 * How the simulated page gets LazyLoad's runtime: `external` — WP Rocket's
 * own tag, its URL answered with the packaged bytes.
 */
export const LAZYLOAD_RUNTIME_DELIVERIES = ['external'] as const;

/** One runtime delivery (see {@link LAZYLOAD_RUNTIME_DELIVERIES}). */
export type LazyloadRuntimeDelivery = (typeof LAZYLOAD_RUNTIME_DELIVERIES)[number];

/**
 * Work of an allowed runtime the page's Content Security Policy blocks, as
 * it would block WP Rocket's: `eval` (no `'unsafe-eval'`: `on…` handlers
 * of delayed elements throw), `inline` (at least one delayed inline script
 * fails), `data` (Chromium only, informational: `data:` loads blocked, the
 * runtime's inline fallback runs them), `inline-after-fallback` (Chromium
 * only: a delayed inline script runs from its `data:` URL, but fails once
 * an earlier page in the tab switched the runtime to its inline fallback —
 * tab state a per-document check cannot see), `trusted-types` (the page
 * requires Trusted Types: every delayed script fails, `eval` too).
 */
export const SIMULATION_CSP_LIMITS = [
  'eval',
  'data',
  'inline',
  'inline-after-fallback',
  'trusted-types'
] as const;

/** One CSP limit (see {@link SIMULATION_CSP_LIMITS}). */
export type SimulationCspLimit = (typeof SIMULATION_CSP_LIMITS)[number];

/**
 * Why a page's Content Security Policy could not be evaluated (reported as
 * "CSP not evaluated" — never as "no CSP"): it exceeds the carried bounds
 * (`oversized`: truncating a policy would change its meaning), or its
 * inputs could not be read as policies (`unreadable`).
 */
export const SIMULATION_CSP_UNAVAILABLE_REASONS = ['oversized', 'unreadable'] as const;

/** One CSP-unavailable reason (see {@link SIMULATION_CSP_UNAVAILABLE_REASONS}). */
export type SimulationCspUnavailableReason = (typeof SIMULATION_CSP_UNAVAILABLE_REASONS)[number];

/** The browser engine whose CSP rules decide a document's limits (they differ per engine). */
export const SIMULATION_CSP_BROWSERS = ['chromium', 'firefox'] as const;

/** One CSP browser engine (see {@link SIMULATION_CSP_BROWSERS}). */
export type SimulationCspBrowser = (typeof SIMULATION_CSP_BROWSERS)[number];

/**
 * Where a simulation's exclusion list came from: the `latest` list fetched
 * from WP Media's endpoint, or the list `bundled` with the simulated WP
 * Rocket version.
 */
export const SIMULATION_LIST_SOURCES = ['latest', 'bundled'] as const;

/** One list source (see {@link SIMULATION_LIST_SOURCES}). */
export type SimulationListSource = (typeof SIMULATION_LIST_SOURCES)[number];

/**
 * Bounds of one exclusion list a simulation runs with (bundled or
 * fetched): at most `rows` rows of 1–`rowChars` characters each. WP
 * Rocket's list held 75 rows of 8–67 characters (2026-10-28); the bounds
 * keep a ≥ 20× margin for its growth while refusing a hostile list.
 */
export const SIMULATION_LIST_LIMITS = { rows: 2_000, rowChars: 1_000 } as const;

/**
 * Why no fetched latest list was usable (the bundled one ran instead):
 * never fetched yet, the network failed or timed out, a non-200 answer,
 * a body over the size cap, not JSON of the expected shape (`malformed`),
 * rows outside the validator's bounds (`invalid`), the kept copy could
 * not be read for this document (`unreadable`: its storage read failed or
 * hung, or it failed re-validation — the network is never asked while a
 * page loads), or the kept copy is too old to trust (`expired`: every
 * refresh since its fetch missed).
 */
export const LATEST_LIST_MISSES = [
  'never-fetched',
  'network-error',
  'timeout',
  'http-error',
  'oversize',
  'malformed',
  'invalid',
  'unreadable',
  'expired'
] as const;

/** One latest-list miss (see {@link LATEST_LIST_MISSES}). */
export type LatestListMiss = (typeof LATEST_LIST_MISSES)[number];

/**
 * Why the packaged simulation data could not give a runtime (the document
 * is then served unchanged — never simulated without one): its file could
 * not be loaded (`asset-unreachable`), is not the expected format
 * (`asset-malformed`), an entry's SHA-256 differs from its pin
 * (`hash-mismatch`), or it holds no entry for the selected WP Rocket
 * version (`version-missing`).
 */
export const SIMULATION_RUNTIME_UNAVAILABLE_CAUSES = [
  'asset-unreachable',
  'asset-malformed',
  'hash-mismatch',
  'version-missing'
] as const;

/** One runtime-unavailable cause (see {@link SIMULATION_RUNTIME_UNAVAILABLE_CAUSES}). */
export type SimulationRuntimeUnavailableCause =
  (typeof SIMULATION_RUNTIME_UNAVAILABLE_CAUSES)[number];

/**
 * A simulation marker id: 128 random bits as 32 lowercase hex digits,
 * drawn by the background per simulated document.
 */
export const SIMULATION_MARKER_ID_PATTERN = /^[0-9a-f]{32}$/;
