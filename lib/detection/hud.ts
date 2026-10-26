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
  FeatureEvidenceSource,
  FeatureMetaRow,
  WprDetections
} from '../wp-rocket/types';
import type { FeatureState, PageAnalysisReport } from './describe';
import type { FeatureLabel, LABEL_PRIORITY_ELEMENTS_BEACON } from './labels';
import { countNoun, formatCount, type CountNoun } from '../../utils/format-count';
import { DOMAIN_NOUN, ELEMENT_NOUN, FONT_NOUN, IMAGE_NOUN, SCRIPT_NOUN } from './count-nouns';
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
  /** The count's noun (both count forms) when the engine measures one, else null. */
  readonly unit: CountNoun | null;
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
    unit: SCRIPT_NOUN,
    count: (report) => report[LABEL_DELAY_JAVASCRIPT_EXECUTION]['delayed scripts'],
    undecided: null
  },
  {
    row: 'defer_all_js',
    label: LABEL_LOAD_JAVASCRIPT_DEFERRED,
    shortLabel: 'Defer JS',
    group: 'file-optimization',
    unit: SCRIPT_NOUN,
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
    unit: IMAGE_NOUN,
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
    unit: IMAGE_NOUN,
    count: (report) => report[LABEL_OPTIMIZE_CRITICAL_IMAGES]['preloaded images'],
    undecided: null
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
    undecided: null
  },
  {
    row: 'preconnect_external_domains',
    label: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
    shortLabel: 'Preconnect to External Domains',
    group: 'features',
    unit: DOMAIN_NOUN,
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
  /**
   * The Exclusion Builder's effect on this feature in this tab (the marker
   * the rewrite left in the displayed document) — a modifier on top of the
   * verdict, never part of it. Present only when the document states one.
   */
  readonly builder?: BuilderFact;
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
  // Unknown needs a page WP Rocket handled: on a plugin-absent page every
  // feature is honestly not applied.
  const unknown =
    detections.wpr.present &&
    state === 'not applied' &&
    source === null &&
    feature.undecided !== null;
  const verdict: HudVerdict = unknown ? 'unknown' : state;
  const builder = builderFactOf(detections, feature.row);
  return {
    verdict,
    count: feature.count === null ? null : feature.count(report),
    source,
    why: unknown ? feature.undecided : verdict === 'collecting' ? COLLECTING_WHY : null,
    ...(builder === null ? {} : { builder })
  };
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
      return reading.count !== null && feature.unit !== null
        ? `applied on this page: ${counted(reading.count, feature.unit)}.`
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

/**
 * The tab-level line for a page, from the same facts and copy as the
 * per-feature modifier; null when the document states no builder fact (a
 * rewrite that only removed a served marker changed no feature: no line).
 *
 * @param detections The engine rows.
 */
export function builderTabLine(detections: WprDetections): BuilderTabLine | null {
  const hints = HUD_FEATURES.flatMap((feature) => {
    const fact = builderFactOf(detections, feature.row);
    return fact === null ? [] : [builderModifierCopy(feature, fact).hint];
  });
  if (hints.length === 0) return null;
  const lead = `${BUILDER_TAB_LINE_TITLE}${TAB_LINE_DASH}`;
  return {
    title: BUILDER_TAB_LINE_TITLE,
    hints,
    spoken: `${lead}${hints.join(SPOKEN_JOINER)}`
  };
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
