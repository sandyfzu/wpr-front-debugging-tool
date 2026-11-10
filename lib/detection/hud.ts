/**
 * The feature HUD facet: the one registry every surface that lists WP Rocket
 * features renders from — the panel's Detections cards, the on-page strip and
 * the support report. Each row binds a detection row to its verified full
 * name (`./labels`), its plugin-native compact wording, its group and its
 * position (registry order is the render order everywhere), plus the count
 * and honest-unknown copy that only that row owns.
 *
 * The readings composed here never re-derive a state: they read the
 * page-analysis report (`describeDetections`, whose family composition is the
 * single owner of "collecting / not enabled") and only add the evidence
 * source and the "why" a debugging human needs for an unsure state.
 *
 * Compact wordings are the plugin's own strings (its support-data option
 * names, settings section titles and Priority Elements notices) — never an
 * acronym the plugin does not print.
 */

import type {
  BuilderFact,
  DnsPrefetchDetection,
  FeatureEvidenceSource,
  FeatureMetaRow,
  MobileCacheVariant,
  SimulationFact,
  WprDetections
} from '../wp-rocket/types';
import type { FeatureState, PageAnalysisReport, PageTargets } from './describe';
import { metaOmissionLeftOpen } from './feature-meta';
import type { FeatureLabel, LABEL_PRIORITY_ELEMENTS_BEACON } from './labels';
import { countLabel, countNoun, formatCount, type CountNoun } from '../../utils/format-count';
import { DOMAIN_NOUN, ELEMENT_NOUN, FONT_NOUN, IMAGE_NOUN, SCRIPT_NOUN } from './count-nouns';
import {
  LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_COMBINE_JAVASCRIPT,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_DNS_PREFETCH,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_MOBILE_CACHE,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS,
  LABEL_PRELOAD_LINKS,
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_CDN,
  LABEL_SELF_HOST_GOOGLE_FONTS,
  SHORT_LABEL_DEFER_JS,
  SHORT_LABEL_DELAY_JS
} from './labels';

/**
 * The feature groups, in render order. The first four headings are the
 * plugin's settings section titles (the ids are this module's own);
 * `features` holds the Priority Elements family — the four beacon-measured
 * optimizations, grouped by how they work rather than by settings page
 * (Preload fonts is an Image & Media › Fonts field; the other three have no
 * settings field at all) — then the mobile cache split (no settings section
 * shows it either).
 */
export type HudGroupId = 'file-optimization' | 'media' | 'preload' | 'cdn' | 'features';

/** One group's heading, in render order. */
export const HUD_GROUPS: readonly { readonly id: HudGroupId; readonly heading: string }[] = [
  { id: 'file-optimization', heading: 'JavaScript & CSS' },
  { id: 'media', heading: 'Image & Media' },
  { id: 'preload', heading: 'Preload' },
  { id: 'cdn', heading: 'Content Delivery' },
  { id: 'features', heading: 'Features' }
];

/** The full names a HUD row can carry (the identity and beacon rows are not features). */
export type HudLabel = Exclude<FeatureLabel, typeof LABEL_PRIORITY_ELEMENTS_BEACON>;

/** One feature's HUD facet. */
export interface HudFeature {
  /** The detection row this feature reads. */
  readonly row: FeatureMetaRow;
  /** The verified full name (card name, tooltip head, report row). */
  readonly label: HudLabel;
  /** The plugin's own compact wording (the strip chip). */
  readonly shortLabel: string;
  /** The group the feature renders under (strip heading; registry order within it). */
  readonly group: HudGroupId;
  /** The count's noun (both count forms) when the engine measures one, else null. */
  readonly unit: CountNoun | null;
  /**
   * The row's own footprint count from the report (set exactly when `unit`
   * is); the function returns null where the count is no evidence for the
   * verdict.
   */
  readonly count: ((report: PageAnalysisReport) => number | null) | null;
  /**
   * Why an undecided reading (no meta declaration and no footprint) is
   * unknown rather than "not applied" — set only where the footprint cannot
   * prove absence (no footprint at all, or a knowingly partial one).
   */
  readonly undecided: string | null;
  /**
   * The undecided why when the row's meta omission guard left it open
   * ({@link metaOmissionLeftOpen}: the meta is present but omits the token by
   * rule). Optional: only a guarded row carries one.
   */
  readonly omittedWhy?: string;
  /**
   * The applied verdict's own line, for a row whose applied state carries
   * more than a count (lower-case start, like every state line). Optional —
   * unlike the fields above — so the rows on the generic "applied on this
   * page" line ship no per-row key in the size-capped on-page bundle.
   */
  readonly appliedLine?: (detections: WprDetections) => string;
  /**
   * The row's page targets from the report, for a row whose count cannot
   * show them (`targets` in the engine): the declared-only line then fires
   * only on `false` — never on `null` (unknown) nor `true`. Optional for
   * the on-page bundle's size.
   */
  readonly targets?: (report: PageAnalysisReport) => PageTargets;
  /**
   * What the page lacks when WP Rocket declares the feature with nothing to
   * act on (lower-case start) — set only on the rows whose token the plugin
   * writes without a rewrite. A meta-declared reading with no page targets
   * ({@link HudFeature.targets}), else whose count is 0 or that has no count
   * at all, then reads the declared-only line ("declared on this render,
   * but …") instead of "applied on this page". Optional for the on-page
   * bundle's size.
   */
  readonly declaredWithout?: string;
  /**
   * The neutral declared line's note, in place of {@link declaredWithout}
   * for a row whose page can never hold per-element proof ("declared on
   * this render; …" — no fault implied). Optional for the bundle's size.
   */
  readonly declaredNote?: string;
}

/** The undecided copy's shared lead: what left the row without a verdict. */
const UNDECIDED_LEAD = 'no generator meta declaration decided it';
/** The undecided copy's shared conclusion. */
const UNDECIDED_TAIL = ', so its state is unknown.';

/** Self-host Google Fonts' missing footprint, in its undecided and declared-only lines. */
const NO_FONT_LINK = 'no self-hosted font link was found';

/**
 * An undecided row's why: no meta decided it, then why the page cannot.
 *
 * @param reason Why the page's own markup cannot decide the row (lower-case start).
 */
function undecidedWhy(reason: string): string {
  return `${UNDECIDED_LEAD}, and ${reason}${UNDECIDED_TAIL}`;
}

/**
 * The registry, in render order (groups first, then the plugin's own order
 * inside each settings page). One row per feature detection row — pinned
 * exhaustive by its test.
 */
export const HUD_FEATURES: readonly HudFeature[] = [
  {
    row: 'remove_unused_css',
    label: LABEL_REMOVE_UNUSED_CSS,
    shortLabel: 'Remove Unused CSS',
    group: 'file-optimization',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'delay_js',
    label: LABEL_DELAY_JAVASCRIPT_EXECUTION,
    shortLabel: SHORT_LABEL_DELAY_JS,
    group: 'file-optimization',
    unit: SCRIPT_NOUN,
    count: (report) => report[LABEL_DELAY_JAVASCRIPT_EXECUTION]['delayed scripts'],
    undecided: null,
    declaredWithout: 'no script on this page is delayed'
  },
  {
    row: 'defer_all_js',
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    shortLabel: SHORT_LABEL_DEFER_JS,
    group: 'file-optimization',
    unit: SCRIPT_NOUN,
    count: (report) => report[LABEL_LOAD_JAVASCRIPT_DEFERRED]['deferred scripts'],
    undecided: null,
    declaredWithout: 'no external script on this page is deferred by WP Rocket'
  },
  {
    row: 'async_css',
    label: LABEL_LOAD_CSS_ASYNCHRONOUSLY,
    shortLabel: 'Load CSS asynchronously',
    group: 'file-optimization',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'minify_css',
    label: LABEL_MINIFY_CSS,
    shortLabel: 'Minify CSS',
    group: 'file-optimization',
    unit: null,
    count: null,
    targets: (report) => report[LABEL_MINIFY_CSS]['page targets'],
    undecided: null,
    declaredWithout: 'no stylesheet on this page is minified'
  },
  {
    row: 'minify_js',
    label: LABEL_MINIFY_JAVASCRIPT,
    shortLabel: 'Minify JS',
    group: 'file-optimization',
    unit: null,
    count: null,
    targets: (report) => report[LABEL_MINIFY_JAVASCRIPT]['page targets'],
    undecided: null,
    declaredWithout: 'no script on this page is minified'
  },
  {
    row: 'minify_concatenate_js',
    label: LABEL_COMBINE_JAVASCRIPT,
    shortLabel: 'Combine JS',
    group: 'file-optimization',
    unit: null,
    count: null,
    // The bundle's digest file name is no attribution: only the meta decides.
    undecided: undecidedWhy("a combined bundle's file name does not prove it on its own")
  },
  {
    row: 'lazyload',
    label: LABEL_IMAGE_LAZYLOAD,
    shortLabel: 'Lazyload Images',
    group: 'media',
    unit: IMAGE_NOUN,
    count: (report) => report[LABEL_IMAGE_LAZYLOAD]['lazy-loaded images'],
    // The count reads images only: backgrounds and native lazy images hide in it.
    targets: (report) => report[LABEL_IMAGE_LAZYLOAD]['page targets'],
    undecided: null,
    declaredWithout: 'no image on this page is lazy-loaded'
  },
  {
    row: 'lazyload_iframes',
    label: LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
    shortLabel: 'Lazyload Iframes',
    group: 'media',
    unit: null,
    count: null,
    targets: (report) => report[LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD]['page targets'],
    undecided: null,
    declaredWithout: 'no iframe or video on this page is lazy-loaded'
  },
  {
    row: 'lazyload_css_bg_img',
    label: LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
    shortLabel: 'Lazyload CSS Background Images',
    group: 'media',
    unit: null,
    count: null,
    targets: (report) => report[LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD]['page targets'],
    undecided: null,
    declaredWithout: 'no CSS background image on this page is lazy-loaded'
  },
  {
    row: 'image_dimensions',
    label: LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
    shortLabel: 'Image Dimensions',
    group: 'media',
    unit: null,
    count: null,
    // Ordinary width/height attributes are not attribution: only the meta decides.
    undecided: undecidedWhy('this feature leaves no other footprint')
  },
  {
    row: 'self_hosted_fonts',
    label: LABEL_SELF_HOST_GOOGLE_FONTS,
    shortLabel: 'Self-host Google Fonts',
    group: 'media',
    unit: null,
    count: null,
    targets: (report) => report[LABEL_SELF_HOST_GOOGLE_FONTS]['page targets'],
    // The footprint check reads the attributed link and the fonts cache path
    // only; fonts self-hosted through other markup leave no proof of absence.
    undecided: `${UNDECIDED_LEAD} and ${NO_FONT_LINK}; fonts self-hosted through other markup are not detected${UNDECIDED_TAIL}`,
    declaredWithout: `${NO_FONT_LINK} on this page`
  },
  {
    row: 'preload_links',
    label: LABEL_PRELOAD_LINKS,
    shortLabel: 'Preload Links',
    group: 'preload',
    unit: null,
    count: null,
    undecided: null,
    // No per-page target: the runtime prefetches on hover or touch.
    declaredNote: 'it prefetches links on hover or touch, so the page holds no per-link proof'
  },
  {
    row: 'dns_prefetch',
    label: LABEL_DNS_PREFETCH,
    shortLabel: 'DNS prefetch',
    group: 'preload',
    unit: DOMAIN_NOUN,
    // The hints are unattributed (core prints the same): a count only once declared.
    count: (report) =>
      report[LABEL_DNS_PREFETCH].state === 'applied'
        ? report[LABEL_DNS_PREFETCH]['domains hinted']
        : null,
    // WordPress core prints the same plain hint for every external host it enqueues.
    undecided: undecidedWhy('a plain dns-prefetch hint does not name WP Rocket'),
    omittedWhy: `with the CDN on, WP Rocket omits the declaration for a single domain${UNDECIDED_TAIL}`,
    appliedLine: (detections) =>
      `applied on this page: ${dnsPrefetchHintText(detections.dns_prefetch)}. ${DNS_PREFETCH_LIMIT}`,
    declaredWithout: 'no dns-prefetch hint on this page names another host'
  },
  {
    row: 'rocket_cdn',
    label: LABEL_CDN,
    shortLabel: 'CDN',
    group: 'cdn',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'rocket_above_the_fold_optimization',
    label: LABEL_OPTIMIZE_CRITICAL_IMAGES,
    shortLabel: 'Critical Images',
    group: 'features',
    unit: IMAGE_NOUN,
    count: (report) => report[LABEL_OPTIMIZE_CRITICAL_IMAGES]['preloaded images'],
    undecided: null,
    declaredWithout: 'no critical image on this page is preloaded'
  },
  {
    row: 'automatic_lazy_rendering',
    label: LABEL_AUTOMATIC_LAZY_RENDERING,
    shortLabel: 'Automatic Lazy Rendering',
    group: 'features',
    unit: ELEMENT_NOUN,
    count: (report) => report[LABEL_AUTOMATIC_LAZY_RENDERING]['converted elements'],
    undecided: null
  },
  {
    row: 'auto_preload_fonts',
    label: LABEL_PRELOAD_FONTS,
    shortLabel: 'Preload Fonts',
    group: 'features',
    unit: FONT_NOUN,
    count: (report) => report[LABEL_PRELOAD_FONTS]['preloaded fonts'],
    undecided: null,
    declaredWithout: 'no font on this page is preloaded'
  },
  {
    row: 'preconnect_external_domains',
    label: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
    shortLabel: 'Preconnect to External Domains',
    group: 'features',
    unit: DOMAIN_NOUN,
    count: (report) => report[LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]['domains hinted'],
    undecided: null,
    declaredWithout: 'no external domain on this page is preconnected'
  },
  {
    row: 'mobile_cache',
    label: LABEL_MOBILE_CACHE,
    shortLabel: 'Mobile cache',
    group: 'features',
    unit: null,
    count: null,
    // The plugin's device token follows the option alone: no page markup.
    undecided: undecidedWhy('the cache split leaves no footprint on the page'),
    appliedLine: (detections) =>
      mobileCacheAppliedLine(
        detections.mobile_cache.variant,
        detections.priority_elements_beacon.isMobile
      )
  }
];

/** The registry keyed by detection row (built once). */
const HUD_BY_ROW: ReadonlyMap<string, HudFeature> = new Map(
  HUD_FEATURES.map((feature) => [feature.row, feature])
);

/**
 * The HUD row of a detection row, or undefined for non-feature rows (the
 * plugin identity row, the beacon, a future row the registry has not learnt).
 *
 * @param row Any detection row id.
 */
export function hudFeatureOf(row: string): HudFeature | undefined {
  return HUD_BY_ROW.get(row);
}

/**
 * The grouped render model: only groups owning at least one row, in group
 * order, rows in registry order — pure, so no consumer re-derives grouping.
 *
 * @returns Each non-empty group's id, heading and features.
 */
export function hudGroupedFeatures(): Array<{
  readonly id: HudGroupId;
  readonly heading: string;
  readonly features: readonly HudFeature[];
}> {
  return HUD_GROUPS.map((group) => ({
    id: group.id,
    heading: group.heading,
    features: HUD_FEATURES.filter((feature) => feature.group === group.id)
  })).filter((group) => group.features.length > 0);
}

/**
 * The verdict a surface renders: the report's composed state, plus `unknown`
 * for an undecided row whose footprint cannot prove absence (only on a page
 * WP Rocket handled).
 */
export type HudVerdict = FeatureState | 'unknown';

/** One feature's whole reading for one page (what every surface renders). */
export interface HudReading {
  readonly verdict: HudVerdict;
  /** The evidence count (null when the feature has no unit). */
  readonly count: number | null;
  /** The evidence class that decided the row, or null when nothing did. */
  readonly source: FeatureEvidenceSource | null;
  /** The amber "why" for an unsure verdict (collecting / unknown), else null. */
  readonly why: string | null;
  /**
   * The row's own applied line ({@link HudFeature.appliedLine}), present only
   * on an applied verdict of a row that has one.
   */
  readonly appliedLine?: string;
  /**
   * The declared-only line ({@link declaredOnlyLine}): WP Rocket's meta
   * declared the feature, but the page holds nothing it acted on (or, for a
   * row that never leaves per-element proof, the neutral declared line).
   * Replaces the applied line; the verdict stays applied.
   */
  readonly declaredOnly?: string;
  /**
   * The Exclusion Builder's effect on this feature in this tab (the marker
   * the rewrite left in the displayed document) — a modifier on top of the
   * verdict, never part of it. Present only when the document states one.
   */
  readonly builder?: BuilderFact;
  /**
   * Whether the extension simulated this feature in this tab (`simulated`:
   * the background vouched for the page's marker, so the verdict is not
   * served) or the page's marker went unverified (verdict as served) — a
   * modifier on top of the verdict. Present only when the document states one.
   */
  readonly simulation?: SimulationFact;
}

/** A builder fact that turns its feature off in this tab (feature-wide, or Defer for the page). */
export type BuilderOffFact = Extract<BuilderFact, { readonly off: unknown }>;

/**
 * Whether a builder fact turns its feature off in this tab (`off` feature-wide
 * or page-off) rather than excluding rows — the one rule every surface that
 * counts, colours or words the modifier branches on. An absent fact turns
 * nothing off.
 *
 * @param fact The row's builder fact, if the document states one.
 * @returns True for `off`, false for `excluded` or no fact.
 */
export function builderTurnsOff(fact?: BuilderFact): fact is BuilderOffFact {
  return fact !== undefined && 'off' in fact;
}

/** What the Exclusion Builder did to a feature, as its modifier badge reads it. */
export type BuilderBadgeKind = 'off' | 'excluded';

/**
 * The modifier badge's kind for a builder fact: turned off (feature-wide or
 * for the page) or rows excluded — every surface's badge icon follows it, so
 * no badge states its meaning by colour alone.
 *
 * @param fact The feature's builder fact.
 */
export function builderBadgeKind(fact: BuilderFact): BuilderBadgeKind {
  return builderTurnsOff(fact) ? 'off' : 'excluded';
}

/** The collecting state's explanation (the family is enabled, nothing applied yet). */
export const COLLECTING_WHY = 'enabled, not yet applied on this page.';

/**
 * Read one feature off the report and its detection row.
 *
 * @param feature The HUD row.
 * @param report The page-analysis report (the state's single composer).
 * @param detections The engine rows (the evidence source lives there).
 * @returns The verdict, count, source and why.
 */
export function readHudFeature(
  feature: HudFeature,
  report: PageAnalysisReport,
  detections: WprDetections
): HudReading {
  const state = report[feature.label].state;
  const source = detections[feature.row].source ?? null;
  const simulation = simulationFactOf(detections, feature.row);
  // Unknown needs a page WP Rocket handled: on a plugin-absent page every
  // feature is honestly not applied. A verified simulation is no unknown
  // either: the extension only simulates a feature the page was served without.
  const unknown =
    detections.wpr.present &&
    state === 'not applied' &&
    source === null &&
    feature.undecided !== null &&
    simulation !== 'simulated';
  const verdict: HudVerdict = unknown ? 'unknown' : state;
  const builder = builderFactOf(detections, feature.row);
  const count = feature.count === null ? null : feature.count(report);
  // A builder fact explains its own emptied counts: no declared-only line then.
  const declaredOnly =
    verdict === 'applied' && source === 'meta' && builder === null
      ? declaredOnlyLine(feature, report, count)
      : null;
  const appliedLine =
    verdict === 'applied' && declaredOnly === null && feature.appliedLine !== undefined
      ? feature.appliedLine(detections)
      : null;
  return {
    verdict,
    count,
    source,
    why: unknown
      ? undecidedWhyOf(feature, detections)
      : verdict === 'collecting'
        ? COLLECTING_WHY
        : null,
    ...(declaredOnly === null ? {} : { declaredOnly }),
    ...(appliedLine === null ? {} : { appliedLine }),
    ...(builder === null ? {} : { builder }),
    ...(simulation === null ? {} : { simulation })
  };
}

/**
 * A meta-declared row's declared-only line, when the page holds nothing the
 * feature acted on: its page targets are false where it reads them, else
 * its count is 0 or it has no count concept at all. Unknown targets or a
 * count the row could not read (null) never claim emptiness.
 *
 * @param feature The HUD row.
 * @param report The page-analysis report.
 * @param count The reading's count.
 * @returns e.g. "declared on this render, but no script on this page is delayed.", or null.
 */
function declaredOnlyLine(
  feature: HudFeature,
  report: PageAnalysisReport,
  count: number | null
): string | null {
  const tail =
    feature.declaredWithout === undefined
      ? feature.declaredNote === undefined
        ? undefined
        : `; ${feature.declaredNote}`
      : `, but ${feature.declaredWithout}`;
  if (tail === undefined) return null;
  const empty =
    feature.targets === undefined
      ? feature.count === null || count === 0
      : feature.targets(report) === false;
  return empty ? `declared on this render${tail}.` : null;
}

/**
 * An unknown row's why: the omission guard's own why when the guard left it
 * open, else the row's undecided copy.
 *
 * @param feature The HUD row (undecided, so its copy is set).
 * @param detections The engine rows.
 */
function undecidedWhyOf(feature: HudFeature, detections: WprDetections): string | null {
  return feature.omittedWhy !== undefined && metaOmissionLeftOpen(detections, feature.row)
    ? feature.omittedWhy
    : feature.undecided;
}

/**
 * A row's simulation fact, or null (only the simulated features' rows can
 * carry one).
 *
 * @param detections The engine rows.
 * @param row The detection row.
 */
function simulationFactOf(detections: WprDetections, row: FeatureMetaRow): SimulationFact | null {
  const entry = detections[row];
  return 'simulation' in entry && entry.simulation !== undefined ? entry.simulation : null;
}

/**
 * A row's Exclusion Builder fact, or null (only the builder's four rows can
 * carry one; every other row never does).
 *
 * @param detections The engine rows.
 * @param row The detection row.
 */
function builderFactOf(detections: WprDetections, row: FeatureMetaRow): BuilderFact | null {
  const entry = detections[row];
  return 'builder' in entry && entry.builder !== undefined ? entry.builder : null;
}

/**
 * The verdict's one-line explanation (tooltip/report wording, lower-case
 * start so it reads after "<name> — ").
 *
 * @param feature The HUD row (its unit and undecided copy).
 * @param reading The feature's reading.
 */
export function hudStateLine(feature: HudFeature, reading: HudReading): string {
  const served = servedStateLine(feature, reading);
  if (reading.builder === undefined) return served;
  const sentence = builderModifierCopy(feature, reading.builder).sentence;
  if (!builderTurnsOff(reading.builder)) return `${served} ${sentence}`;
  // Turned off in this tab: the served line's counts describe the rewritten
  // page ("applied on this page: 0 …"), so the modifier replaces it — after
  // saying WP Rocket served the feature only when the verdict proves it did.
  const modifier = lowerFirst(sentence);
  return reading.verdict === 'applied' ? `${BUILDER_SERVED_LEAD}; ${modifier}` : modifier;
}

/**
 * The verdict's own line, as WP Rocket served the page (no builder modifier).
 *
 * @param feature The HUD row.
 * @param reading The feature's reading.
 */
function servedStateLine(feature: HudFeature, reading: HudReading): string {
  switch (reading.verdict) {
    case 'applied':
      if (reading.declaredOnly !== undefined) return reading.declaredOnly;
      if (reading.appliedLine !== undefined) return reading.appliedLine;
      return reading.count !== null && feature.unit !== null
        ? `applied on this page: ${counted(reading.count, feature.unit)}.`
        : 'applied on this page.';
    case 'collecting':
      return COLLECTING_WHY;
    case 'unknown':
      return reading.why ?? feature.undecided ?? 'its state is unknown.';
    case 'not enabled':
      return "not enabled in the site's current configuration.";
    case 'not applied':
      // A meta refutation is the plugin's own statement for this render; only
      // an absent footprint can mean a page served before the plugin's work.
      if (reading.source === 'meta') {
        return "WP Rocket's generator meta does not declare it on this page.";
      }
      return "nothing matched on this page (the page may predate the plugin's work).";
  }
}

/**
 * The DNS prefetch row's proof limit: the plugin's hints are plain core
 * `dns-prefetch` links, which core also prints for every external enqueued
 * host, and CDN CNAMEs join the plugin's own list — none can be told apart,
 * and a declared list may be core's or the CDN's hosts alone.
 */
export const DNS_PREFETCH_LIMIT =
  "WP Rocket declared DNS prefetch; the hosts may include, or be only, WordPress core's own hints and CDN hosts.";

/**
 * The plain hints a DNS prefetch row observed, as every surface words them
 * ("3 domains hinted"; a cut list reads as a floor, "500+ domains hinted").
 *
 * @param row The DNS prefetch row.
 */
export function dnsPrefetchHintText(row: DnsPrefetchDetection): string {
  return `${countLabel(row.domains.length, DOMAIN_NOUN, row.truncated === true)} hinted`;
}

/**
 * The mobile cache row's proof limit: the declaration proves the option that
 * splits the cache, while writing mobile files at all takes a second option
 * no page shows; and the declared device is not the file served (WP Rocket's
 * mobile detection counts tablets as mobile, its default tablet setting
 * serves them the desktop file).
 */
export const MOBILE_CACHE_LIMIT =
  "Declared on this render; separate mobile files also need WP Rocket's mobile cache option, which the page doesn't show. Tablets count as mobile here but get the desktop file under WP Rocket's default tablet setting.";

/** The device a mobile cache declaration names, as every surface words it. */
const MOBILE_CACHE_RENDER_TEXT: Readonly<Record<MobileCacheVariant | 'both', string>> = {
  mobile: 'Rendered for mobile',
  desktop: 'Rendered for desktop',
  both: 'Both devices declared'
};

/**
 * Which device a declared mobile cache render was generated for, in one
 * phrase, plus the beacon config's device whenever it does not match (shown
 * beside the declaration, never resolved against it). The beacon's
 * `is_mobile` also needs WP Rocket's mobile cache option and WordPress's own
 * mobile check, so "not mobile" beside a mobile render may mean either
 * disagrees — never that the device was a desktop.
 *
 * @param variant The row's declared device (null: both declared).
 * @param beaconIsMobile The Priority Elements row's `isMobile` (null: no usable config).
 * @returns e.g. "Rendered for mobile" or "Rendered for mobile · beacon config: not mobile".
 */
export function mobileCacheRenderText(
  variant: MobileCacheVariant | null,
  beaconIsMobile: boolean | null
): string {
  const text = MOBILE_CACHE_RENDER_TEXT[variant ?? 'both'];
  if (beaconIsMobile === null || variant === (beaconIsMobile ? 'mobile' : 'desktop')) return text;
  return `${text}${LIST_JOINER}beacon config: ${beaconIsMobile ? 'mobile' : 'not mobile'}`;
}

/**
 * The mobile cache row's applied state line: the render's device, then the
 * proof limit.
 *
 * @param variant The row's declared device.
 * @param beaconIsMobile The Priority Elements row's `isMobile`.
 */
function mobileCacheAppliedLine(
  variant: MobileCacheVariant | null,
  beaconIsMobile: boolean | null
): string {
  return `applied on this page: ${lowerFirst(mobileCacheRenderText(variant, beaconIsMobile))}. ${MOBILE_CACHE_LIMIT}`;
}

/** One evidence source's on-screen renderings (chip text, tooltip/accessible text). */
export interface SourceCopy {
  readonly chip: string;
  readonly tooltip: string;
}

/** The source chip copy — single declaring site for the cards and the strip. */
export const SOURCE_COPY: Readonly<Record<FeatureEvidenceSource, SourceCopy>> = {
  meta: { chip: 'Meta', tooltip: "Decided by WP Rocket's generator meta tag on this page." },
  footprint: { chip: 'Footprint', tooltip: 'Decided by markup WP Rocket left on this page.' }
};

/**
 * The support report's Source cell per evidence class — kept apart from
 * {@link SOURCE_COPY} so the on-page strip's bundle never carries it.
 */
export const SOURCE_REPORT_TEXT: Readonly<Record<FeatureEvidenceSource, string>> = {
  meta: 'Generator meta',
  footprint: 'Page footprint'
};

/** The state line's lead for a feature WP Rocket served that the builder turned off. */
export const BUILDER_SERVED_LEAD = 'served by WP Rocket';

/**
 * The inline list joiner every surface shares between short phrases (the
 * tab-level hints, the summary's reason suffix, the report line). Text form;
 * the panel draws its glyph as a clipped gutter dot, never spoken.
 */
export const LIST_JOINER = ' · ';

/**
 * The joiner's glyph as a CSS `content` value with empty alt text: surfaces
 * that draw it as a gutter dot set it as a custom property, so the dot is
 * painted but never reaches the accessibility tree.
 */
export const LIST_JOINER_CONTENT = `'${LIST_JOINER.trim()}' / ''`;

/** The strip's tab-level line title: the page shown is the builder's rewrite. */
export const BUILDER_TAB_LINE_TITLE = 'Exclusion Builder rewrote this page';

/**
 * The summary's reason suffix: how many served features the Exclusion
 * Builder turned off in this tab ({@link builderTurnsOff}) — appended to
 * "N of M optimizations active" so the gap between served and active reads
 * as the builder's doing. Excluded rows never count (the feature still runs).
 *
 * @param count The served features turned off in this tab.
 * @returns e.g. "2 off in this tab" ("1 off in this tab" for one), or null for none.
 */
export function builderOffSummary(count: number): string | null {
  return count > 0 ? `${formatCount(count)} off in this tab` : null;
}

/** One builder fact's on-screen renderings, beside {@link SOURCE_COPY}. */
export interface BuilderModifierCopy {
  /** The chip/badge text (short). */
  readonly chip: string;
  /** The full sentence: tooltip, card and report wording. */
  readonly sentence: string;
  /** The strip tab-level line's hint for this feature (names it). */
  readonly hint: string;
}

/**
 * The modifier copy of one builder fact — the single declaring site the
 * panel cards, the strip chips and tab-level line and the support report
 * render from. Never claims WP Rocket served the feature (the verdict says
 * that); an excluded count names its unit.
 *
 * @param feature The HUD row (its compact name and unit).
 * @param fact The fact the document's builder marker states.
 */
export function builderModifierCopy(feature: HudFeature, fact: BuilderFact): BuilderModifierCopy {
  if (!builderTurnsOff(fact)) {
    const phrase = counted(fact.excluded, feature.unit);
    return {
      chip: `${String(fact.excluded)} excluded`,
      sentence: `${phrase} excluded by the Exclusion Builder.`,
      hint: `${feature.shortLabel}: ${String(fact.excluded)} excluded`
    };
  }
  return fact.off === 'feature'
    ? {
        chip: 'Disabled in this tab',
        sentence: 'Disabled in this tab by the Exclusion Builder.',
        hint: `${feature.shortLabel} off`
      }
    : {
        chip: 'Off on this page',
        sentence: 'Off in this tab: an Exclusion Builder row stops WP Rocket deferring.',
        hint: `${feature.shortLabel} off on this page`
      };
}

/** One simulation fact's row renderings (no tab hint: see {@link simulationTabHint}). */
export type SimulationModifierCopy = Pick<BuilderModifierCopy, 'chip' | 'sentence'>;

/**
 * The modifier copy of one simulation fact — the single declaring site the
 * cards, the strip and the support report render from, beside
 * {@link builderModifierCopy}. Never claims WP Rocket served the feature.
 *
 * @param fact The row's simulation fact.
 */
export function simulationModifierCopy(fact: SimulationFact): SimulationModifierCopy {
  return fact === 'simulated'
    ? {
        chip: 'Simulated in this tab',
        sentence:
          "Simulated in this tab by the extension — not the site's configuration; its own WP Rocket exclusions aren't included."
      }
    : {
        chip: 'Simulation not verified',
        sentence:
          "This page claims a simulation the extension can't confirm, so it's read as served."
      };
}

/**
 * The strip tab-level line's hint for a verified simulation (an unverified
 * marker never joins that line: nothing the extension can vouch for).
 *
 * @param feature The HUD row (its compact name).
 * @returns e.g. "Delay JS simulated".
 */
export function simulationTabHint(feature: HudFeature): string {
  return `${feature.shortLabel} simulated`;
}

/**
 * The summary's simulation suffix phrases, each appended like
 * {@link builderOffSummary}: how many features the extension simulated in
 * this tab, then whether any marker went unverified.
 *
 * @param simulated The features with a verified simulation.
 * @param unverified The features whose marker went unverified.
 * @returns e.g. ["1 simulated in this tab"]; empty for neither.
 */
export function simulationSummaryParts(simulated: number, unverified: number): string[] {
  return [
    ...(simulated > 0 ? [`${formatCount(simulated)} simulated in this tab`] : []),
    ...(unverified > 0 ? ['simulation not verified'] : [])
  ];
}

/**
 * The report's Optimizations line simulation suffix: the
 * {@link simulationSummaryParts} joined as text.
 *
 * @param simulated The features with a verified simulation.
 * @param unverified The features whose marker went unverified.
 * @returns e.g. "1 simulated in this tab", or null for neither.
 */
export function simulationSummary(simulated: number, unverified: number): string | null {
  const parts = simulationSummaryParts(simulated, unverified);
  return parts.length === 0 ? null : parts.join(LIST_JOINER);
}

/** The strip's tab-level line: the title and one hint per feature the builder changed. */
export interface BuilderTabLine {
  readonly title: string;
  /** Hints in registry order (never empty). */
  readonly hints: readonly string[];
  /** The line as assistive tech hears it: commas where the eye sees the dot. */
  readonly spoken: string;
}

/** The tab-level line's title/hints separator. */
const TAB_LINE_DASH = ' — ';

/** The joiner assistive tech hears where the eye sees {@link LIST_JOINER}. */
const SPOKEN_JOINER = ', ';

/** The closed pill's glyph kinds: a builder effect, or a verified simulation. */
export type PageChangeKind = BuilderBadgeKind | 'simulated';

/**
 * One in-tab change the displayed document states for a feature: a builder
 * fact, or a verified simulation (an unverified marker changed nothing the
 * extension can vouch for, so it is no tab-level change).
 */
interface TabChange {
  readonly kind: PageChangeKind;
  readonly hint: string;
}

/**
 * The page's in-tab changes, in HUD order (per feature: the simulation, then
 * the builder fact on top of it): the single read both the card's tab-level
 * line and the closed pill's glyph derive from, so they are present
 * together by construction.
 *
 * @param detections The engine rows.
 * @returns One entry per change the document states.
 */
function tabChanges(detections: WprDetections): TabChange[] {
  return HUD_FEATURES.flatMap((feature): TabChange[] => {
    const simulation = simulationFactOf(detections, feature.row);
    const fact = builderFactOf(detections, feature.row);
    const changes: TabChange[] = [];
    if (simulation === 'simulated') {
      changes.push({ kind: 'simulated', hint: simulationTabHint(feature) });
    }
    if (fact !== null) {
      changes.push({ kind: builderBadgeKind(fact), hint: builderModifierCopy(feature, fact).hint });
    }
    return changes;
  });
}

/**
 * The tab-level line for a page, from the same facts and copy as the
 * per-feature modifiers (the Exclusion Builder's session both rewrites rows
 * and runs the simulation); null when the document states neither (a
 * rewrite that only removed a served marker changed no feature: no line).
 *
 * @param detections The engine rows.
 */
export function builderTabLine(detections: WprDetections): BuilderTabLine | null {
  const hints = tabChanges(detections).map((change) => change.hint);
  if (hints.length === 0) return null;
  const lead = `${BUILDER_TAB_LINE_TITLE}${TAB_LINE_DASH}`;
  return {
    title: BUILDER_TAB_LINE_TITLE,
    hints,
    spoken: `${lead}${hints.join(SPOKEN_JOINER)}`
  };
}

/**
 * The closed strip pill's builder hint as assistive tech hears it: appended
 * once to the pill's own name. Its glyph beside the version is never spoken.
 */
export const BUILDER_PILL_HINT_SPOKEN = ', rewritten by the Exclusion Builder';

/**
 * The page's leading in-tab change, drawn as the closed pill's one glyph:
 * `simulated` when the extension runs a feature WP Rocket did not serve
 * (the page runs code the site never sent, so it outranks the rest), else
 * `off` when any feature is turned off in this tab (it changes what runs,
 * so it outranks exclusions), else `excluded` — each fact's own badge kind.
 * Read from the same changes as {@link builderTabLine}.
 *
 * @param detections The engine rows.
 * @returns The glyph kind, or null when the document states no change.
 */
export function builderPageKind(detections: WprDetections): PageChangeKind | null {
  const kinds = tabChanges(detections).map((change) => change.kind);
  if (kinds.length === 0) return null;
  if (kinds.includes('simulated')) return 'simulated';
  return kinds.includes('off') ? 'off' : 'excluded';
}

/**
 * A count with its noun, singular for one (the shared `countNoun` rule);
 * the plain figure when the feature has no noun. Ungrouped digits, as the
 * strip renders the figure.
 *
 * @param count A non-negative count.
 * @param noun The feature's count noun, or null.
 */
function counted(count: number, noun: CountNoun | null): string {
  return noun === null ? String(count) : `${String(count)} ${countNoun(count, noun)}`;
}

/**
 * Lower-case a sentence's first character (it then reads after a lead).
 *
 * @param text The sentence.
 */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}
