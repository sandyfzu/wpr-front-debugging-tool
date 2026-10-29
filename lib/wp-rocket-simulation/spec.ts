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
 * The simulated-feature registry, in the order the simulation steps run:
 * Delay JS today (adding a feature is one row here plus its step).
 */
export const SIMULATED_FEATURES = [
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
 * Why a step is `not-applicable`: an AMP document (WP Rocket never delays
 * one); a page beyond exact reproduction — one of WP Rocket's regexes
 * could stop at PCRE's backtrack limit there, which the transform does not
 * reproduce (named by an {@link UnreproducedRegex}); or a page whose served
 * bytes the transform cannot count exactly (`unsupported-charset`: served
 * in a charset other than UTF-8 with non-ASCII text, or in UTF-16 — WP
 * Rocket's patterns and rows run over those bytes).
 */
export const SIMULATION_NOT_APPLICABLE_REASONS = [
  'amp',
  'beyond-exact-reproduction',
  'unsupported-charset'
] as const;

/** One not-applicable reason (see {@link SIMULATION_NOT_APPLICABLE_REASONS}). */
export type SimulationNotApplicableReason = (typeof SIMULATION_NOT_APPLICABLE_REASONS)[number];

/**
 * The WP Rocket regexes whose backtrack-limit failure is not reproduced —
 * and `defer-replacements`: Defer JS's `str_replace` rescans of a page past
 * a bounded amount of work (WP Rocket's own run would take seconds there).
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
  'defer-replacements'
] as const;

/** One unreproduced regex (see {@link UNREPRODUCED_REGEXES}). */
export type UnreproducedRegex = (typeof UNREPRODUCED_REGEXES)[number];

/**
 * What a simulation cannot reproduce on a page, named so the UI can say
 * it. `combined-js`: the page serves WP Rocket's combined JS bundles —
 * with Delay JS on, WP Rocket turns Combine JS off, so the real page would
 * serve those scripts uncombined; the simulation cannot un-combine them.
 */
export const SIMULATION_CAVEATS = ['combined-js'] as const;

/** One simulation caveat (see {@link SIMULATION_CAVEATS}). */
export type SimulationCaveat = (typeof SIMULATION_CAVEATS)[number];

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
