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

import type { FeatureEvidenceSource, FeatureMetaRow, WprDetections } from '../wp-rocket/types';
import type { FeatureState, PageAnalysisReport } from './describe';
import type { FeatureLabel, LABEL_PRIORITY_ELEMENTS_BEACON } from './labels';
import {
  LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  LABEL_AUTOMATIC_LAZY_RENDERING,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS,
  LABEL_PRELOAD_LINKS,
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_ROCKETCDN,
  LABEL_SELF_HOST_GOOGLE_FONTS
} from './labels';

/**
 * The feature groups, in render order. The first four are the plugin's own
 * settings vocabulary; `features` holds the Priority Elements family — the
 * four beacon-measured optimizations, grouped by how they work rather than
 * by settings page (Preload fonts is a Media › Fonts field; the other three
 * have no settings field at all).
 */
export type HudGroupId = 'file-optimization' | 'media' | 'preload' | 'cdn' | 'features';

/** One group's heading, in render order. */
export const HUD_GROUPS: readonly { readonly id: HudGroupId; readonly heading: string }[] = [
  { id: 'file-optimization', heading: 'File Optimization' },
  { id: 'media', heading: 'Media' },
  { id: 'preload', heading: 'Preload' },
  { id: 'cdn', heading: 'CDN' },
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
  /** The count's unit word when the engine measures one, else null. */
  readonly unit: string | null;
  /** The feature's evidence count from the report, when `unit` is set. */
  readonly count: ((report: PageAnalysisReport) => number) | null;
  /**
   * Why an undecided reading (no meta declaration and no footprint) is
   * unknown rather than "not applied" — set only where the footprint cannot
   * prove absence (no footprint at all, or a knowingly partial one).
   */
  readonly undecided: string | null;
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
    shortLabel: 'Delay JS',
    group: 'file-optimization',
    unit: 'scripts',
    count: (report) => report[LABEL_DELAY_JAVASCRIPT_EXECUTION]['delayed scripts'],
    undecided: null
  },
  {
    row: 'defer_all_js',
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    shortLabel: 'Defer JS',
    group: 'file-optimization',
    unit: 'scripts',
    count: (report) => report[LABEL_LOAD_JAVASCRIPT_DEFERRED]['deferred scripts'],
    undecided: null
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
    undecided: null
  },
  {
    row: 'minify_js',
    label: LABEL_MINIFY_JAVASCRIPT,
    shortLabel: 'Minify JS',
    group: 'file-optimization',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'lazyload',
    label: LABEL_IMAGE_LAZYLOAD,
    shortLabel: 'Lazyload Images',
    group: 'media',
    unit: 'images',
    count: (report) => report[LABEL_IMAGE_LAZYLOAD]['lazy-loaded images'],
    undecided: null
  },
  {
    row: 'lazyload_iframes',
    label: LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
    shortLabel: 'Lazyload Iframes',
    group: 'media',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'lazyload_css_bg_img',
    label: LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
    shortLabel: 'Lazyload CSS Background Images',
    group: 'media',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'image_dimensions',
    label: LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
    shortLabel: 'Image Dimensions',
    group: 'media',
    unit: null,
    count: null,
    // Ordinary width/height attributes are not attribution: only the meta decides.
    undecided:
      'no generator meta declaration decided it, and this feature leaves no other footprint, so its state is unknown.'
  },
  {
    row: 'self_hosted_fonts',
    label: LABEL_SELF_HOST_GOOGLE_FONTS,
    shortLabel: 'Self-host Google Fonts',
    group: 'media',
    unit: null,
    count: null,
    // The footprint check reads the attributed link and the fonts cache path
    // only; fonts self-hosted through other markup leave no proof of absence.
    undecided:
      'no generator meta declaration decided it and no self-hosted font link was found; fonts self-hosted through other markup are not detected, so its state is unknown.'
  },
  {
    row: 'preload_links',
    label: LABEL_PRELOAD_LINKS,
    shortLabel: 'Preload Links',
    group: 'preload',
    unit: null,
    count: null,
    undecided: null
  },
  {
    row: 'rocket_cdn',
    label: LABEL_ROCKETCDN,
    shortLabel: 'RocketCDN',
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
    unit: 'images',
    count: (report) => report[LABEL_OPTIMIZE_CRITICAL_IMAGES]['preloaded images'],
    undecided: null
  },
  {
    row: 'automatic_lazy_rendering',
    label: LABEL_AUTOMATIC_LAZY_RENDERING,
    shortLabel: 'Automatic Lazy Rendering',
    group: 'features',
    unit: 'elements',
    count: (report) => report[LABEL_AUTOMATIC_LAZY_RENDERING]['converted elements'],
    undecided: null
  },
  {
    row: 'auto_preload_fonts',
    label: LABEL_PRELOAD_FONTS,
    shortLabel: 'Preload Fonts',
    group: 'features',
    unit: 'fonts',
    count: (report) => report[LABEL_PRELOAD_FONTS]['preloaded fonts'],
    undecided: null
  },
  {
    row: 'preconnect_external_domains',
    label: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
    shortLabel: 'Preconnect to External Domains',
    group: 'features',
    unit: 'domains',
    count: (report) => report[LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS]['domains hinted'],
    undecided: null
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
  // Unknown needs a page WP Rocket handled: on a plugin-absent page every
  // feature is honestly not applied.
  const unknown =
    detections.wpr.present &&
    state === 'not applied' &&
    source === null &&
    feature.undecided !== null;
  const verdict: HudVerdict = unknown ? 'unknown' : state;
  return {
    verdict,
    count: feature.count === null ? null : feature.count(report),
    source,
    why: unknown ? feature.undecided : verdict === 'collecting' ? COLLECTING_WHY : null
  };
}

/**
 * The verdict's one-line explanation (tooltip/report wording, lower-case
 * start so it reads after "<name> — ").
 *
 * @param feature The HUD row (its unit and undecided copy).
 * @param reading The feature's reading.
 */
export function hudStateLine(feature: HudFeature, reading: HudReading): string {
  switch (reading.verdict) {
    case 'applied':
      return reading.count !== null && feature.unit !== null
        ? `applied on this page: ${String(reading.count)} ${feature.unit}.`
        : 'applied on this page.';
    case 'collecting':
      return COLLECTING_WHY;
    case 'unknown':
      return feature.undecided ?? 'its state is unknown.';
    case 'not enabled':
      return "not enabled in the site's current configuration.";
    case 'not applied':
      // A meta refutation is the plugin's own statement for this render; only
      // an absent footprint can mean a page served before the plugin's work.
      return reading.source === 'meta'
        ? "WP Rocket's generator meta does not declare it on this page."
        : "nothing matched on this page (the page may predate the plugin's work).";
  }
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
