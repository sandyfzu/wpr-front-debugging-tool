/**
 * The resource-list pages' shared view model — the JavaScript, Stylesheets,
 * Lazyload and Preloaded Resources pages are one facet/search pattern over
 * four row shapes (the Stylesheets page's rows live in `./stylesheet-rows`,
 * imported by its lazily loaded page only, so the panel's start never pays
 * for them). Everything here is pure and data-driven: a page's facets
 * (`./resource-facets`), their values' predicates and its searched field are
 * declared once here, so adding a page or a list is one table, never a new
 * branch in the page.
 */

import type {
  PreloadedResources,
  ResourceHint,
  ResourceHintRel,
  WprDetections
} from '../wp-rocket/types';
import { hintAttribution, hintRank, type HintAttribution } from './hint-attribution';
import { lazyloadImageState } from './lazyload-states';
import {
  choiceFacet,
  defineFacets,
  toggleFacet,
  type FacetSet,
  type FacetValue
} from './resource-facets';
import {
  NO_SCRIPT_PAGE_FACTS,
  jsScriptState,
  scriptMinifyState,
  type JsStateId,
  type ScriptPageFacts
} from './script-states';

/** One classified script row on the JavaScript page. */
export interface JsScriptResource {
  /** Capture position; script identity is derived separately from content and occurrence. */
  readonly id: number;
  readonly type: 'inline' | 'external';
  /** The searched field: the inline source, or the external URL. */
  readonly content: string;
  readonly delayed: boolean;
  readonly deferred: boolean;
  readonly deferredByWPR: boolean;
  readonly fdtExcluded: string | null;
  /** Minify JS served this file (see `scriptMinifyState`). */
  readonly minified: boolean;
  /** This file is a Combine JS bundle (see `scriptMinifyState`). */
  readonly combined: boolean;
  /** The tag carries WP Rocket's minify stamp — a tag fact; `minified` is the page-proven state. */
  readonly minifyAttribute: boolean;
  /** A delayed script's original `type`, `null` when it has none. */
  readonly originalType: string | null;
}

/** One classified image row on the Lazyload page. */
export interface LazyloadImageResource {
  readonly id: number;
  /** The searched field: the image's display URL. */
  readonly src: string;
  readonly lazyloaded: boolean;
  /** Reasons the image escapes lazyload, in the exclusion list's order. */
  readonly excludedReasons: string[];
}

/** One resource-hint row on the Preloaded Resources page. */
export interface PreloadedResource {
  /** The hint's capture position (rows are shown in inventory order, keyed by this). */
  readonly id: number;
  readonly rel: ResourceHintRel;
  /** The `as` type ('' when the hint carries none). */
  readonly as: string;
  /** The searched field: the hinted URL ('' when it has none). */
  readonly href: string;
  readonly attribution: HintAttribution;
}

/** A row with a type: the script and style rows' shared Type dimension. */
interface TypedRow {
  readonly type: 'inline' | 'external';
}

/** The Inline type facet value (shared by the script and style pages). */
export const INLINE_TYPE_VALUE: FacetValue<TypedRow> = {
  id: 'inline',
  label: 'Inline',
  predicate: (row) => row.type === 'inline'
};

/** The External type facet value (shared by the script and style pages). */
export const EXTERNAL_TYPE_VALUE: FacetValue<TypedRow> = {
  id: 'external',
  label: 'External',
  predicate: (row) => row.type === 'external'
};

/**
 * A facet value over one row state: its id, label and predicate are the
 * state's own, so the value keeps exactly the rows showing that state's chip.
 *
 * @param state The state.
 * @returns The facet value.
 */
export function stateValue<Row>(state: {
  readonly id: string;
  readonly label: string;
  readonly holds: (row: Row) => boolean;
}): FacetValue<Row> {
  return { id: state.id, label: state.label, predicate: state.holds };
}

/**
 * A facet value over a script state's negation (the negative states are no
 * row chips; their values keep them reachable).
 *
 * @param id The value id.
 * @param label The value label.
 * @param of The negated state.
 * @returns The facet value.
 */
function negatedValue(id: string, label: string, of: JsStateId): FacetValue<JsScriptResource> {
  const { holds } = jsScriptState(of);
  return { id, label, predicate: (row) => !holds(row) };
}

// The script facet values, each declared once.

/** Delay value: Delay JS delayed the script. */
const DELAYED_SCRIPTS = stateValue(jsScriptState('delayed'));
/** Delay value: every script Delayed leaves out. */
const NON_DELAYED_SCRIPTS = negatedValue('non-delayed', 'Non-delayed', 'delayed');
/** Defer value: an external script with a native `defer` or WP Rocket's defer stamp. */
const DEFERRED_SCRIPTS = stateValue(jsScriptState('deferred'));
/** Defer value: every script Deferred leaves out. */
const NON_DEFERRED_SCRIPTS = negatedValue('non-deferred', 'Non-deferred', 'deferred');
/** File value: a file Minify JS served (never a bundle). */
const MINIFIED_SCRIPTS = stateValue(jsScriptState('minified'));
/** File value: a Combine JS bundle. */
const COMBINED_SCRIPTS = stateValue(jsScriptState('combined'));
/** Excluded toggle: the local exclusion marker kept the script out of Delay/Defer JS. */
const EXCLUDED_SCRIPTS = stateValue(jsScriptState('excluded'));

/**
 * The JavaScript page's searched field: an inline script's code, an external one's URL.
 *
 * @param row The row.
 * @returns The searched text.
 */
export function jsScriptSearchField(row: JsScriptResource): string {
  return row.content;
}

/** The JavaScript page's facet ids, in render order. */
export type JsFacetId = 'delay' | 'defer' | 'type' | 'file' | 'excluded';

/**
 * The JavaScript page's facets: Delay, Defer and
 * Type each split every script in two (a state and its negation; inline or
 * external). File holds the two minify states, exclusive by construction (a
 * bundle never reads Minified), so they are one choice rather than two
 * toggles that could only combine to nothing. Excluded overlaps Delay and
 * Defer (the marker keeps a script out of either), so it is a toggle.
 */
export const JS_PAGE_FACETS: FacetSet<JsScriptResource, JsFacetId> = defineFacets<
  JsScriptResource,
  JsFacetId
>([
  choiceFacet('delay', 'Delay', [DELAYED_SCRIPTS, NON_DELAYED_SCRIPTS]),
  choiceFacet('defer', 'Defer', [DEFERRED_SCRIPTS, NON_DEFERRED_SCRIPTS]),
  choiceFacet('type', 'Type', [INLINE_TYPE_VALUE, EXTERNAL_TYPE_VALUE]),
  choiceFacet('file', 'File', [MINIFIED_SCRIPTS, COMBINED_SCRIPTS]),
  toggleFacet('excluded', EXCLUDED_SCRIPTS.label, EXCLUDED_SCRIPTS.predicate)
]);

// The image facet values, each declared once.

/** Lazyload value: WP Rocket's lazyload took the image. */
const LAZYLOADED_IMAGES = stateValue(lazyloadImageState('lazyloaded'));
/** Lazyload value: every image Lazyloaded leaves out. */
const NON_LAZYLOADED_IMAGES: FacetValue<LazyloadImageResource> = {
  id: 'non-lazyloaded',
  label: 'Non-lazyloaded',
  predicate: (row) => !LAZYLOADED_IMAGES.predicate(row)
};
/** Excluded toggle: the local exclusion marker kept the image out of lazyload. */
const EXCLUDED_IMAGES = stateValue(lazyloadImageState('excluded'));

/**
 * The Lazyload page's searched field: the image's display URL.
 *
 * @param row The row.
 * @returns The searched text.
 */
export function lazyloadImageSearchField(row: LazyloadImageResource): string {
  return row.src;
}

/** The Lazyload page's facet ids, in render order. */
export type LazyloadFacetId = 'lazyload' | 'excluded';

/**
 * The Lazyload page's facets: Lazyload splits every image in two; Excluded
 * is a subset of Non-lazyloaded (the marker counts only on an image that is
 * not lazyloaded), so it is a toggle — on alone it keeps exactly the rows its chip marks.
 */
export const LAZYLOAD_PAGE_FACETS: FacetSet<LazyloadImageResource, LazyloadFacetId> = defineFacets<
  LazyloadImageResource,
  LazyloadFacetId
>([
  choiceFacet('lazyload', 'Lazyload', [LAZYLOADED_IMAGES, NON_LAZYLOADED_IMAGES]),
  toggleFacet('excluded', EXCLUDED_IMAGES.label, EXCLUDED_IMAGES.predicate)
]);

/** Each hint kind's words (its facet value label and its detail's kind label). */
export const RESOURCE_HINT_KIND_LABELS: Readonly<Record<ResourceHintRel, string>> = {
  preload: 'Preload',
  modulepreload: 'Module preload',
  preconnect: 'Preconnect',
  'dns-prefetch': 'DNS prefetch'
};

/**
 * A facet value over one hint kind, labeled by {@link RESOURCE_HINT_KIND_LABELS}.
 *
 * @param id The value id (the kind's own `rel` token).
 * @returns The facet value.
 */
function hintKindValue(id: ResourceHintRel): FacetValue<PreloadedResource> {
  return { id, label: RESOURCE_HINT_KIND_LABELS[id], predicate: (row) => row.rel === id };
}

/**
 * A facet value over one preload `as` type (the hint kind the type matters for).
 *
 * @param id The value id.
 * @param label The value label.
 * @param as The `as` type.
 * @returns The facet value.
 */
function preloadAsValue(id: string, label: string, as: string): FacetValue<PreloadedResource> {
  return { id, label, predicate: (row) => row.rel === 'preload' && row.as === as };
}

// The hint facet values, each declared once.

/** Source value: a hint attributed to WP Rocket. */
const WP_ROCKET_HINTS: FacetValue<PreloadedResource> = {
  id: 'wp-rocket',
  label: 'WP Rocket',
  predicate: (row) => row.attribution.by === 'wp-rocket'
};
/** Source value: a hint not attributed to WP Rocket. */
const UNATTRIBUTED_HINTS: FacetValue<PreloadedResource> = {
  id: 'unattributed',
  label: 'Unattributed',
  predicate: (row) => row.attribution.by === 'page'
};
/** Hint value: `rel=preload`. */
const PRELOAD_HINTS = hintKindValue('preload');
/** Preload type value: a preload `as=image`. */
const IMAGE_PRELOADS = preloadAsValue('images', 'Images', 'image');
/** Preload type value: a preload `as=font`. */
const FONT_PRELOADS = preloadAsValue('fonts', 'Fonts', 'font');
/** Hint value: `rel=modulepreload`. */
const MODULEPRELOAD_HINTS = hintKindValue('modulepreload');
/** Hint value: `rel=preconnect`. */
const PRECONNECT_HINTS = hintKindValue('preconnect');
/** Hint value: `rel=dns-prefetch`. */
const DNS_PREFETCH_HINTS = hintKindValue('dns-prefetch');

/**
 * The Preloaded Resources page's searched field: the hinted URL ('' when it has none).
 *
 * @param row The row.
 * @returns The searched text.
 */
export function preloadedHintSearchField(row: PreloadedResource): string {
  return row.href;
}

/** The Preloaded Resources page's facet ids, in render order. */
export type PreloadedFacetId = 'source' | 'hint' | 'preload-type';

/**
 * The Preloaded Resources page's facets: attribution and hint kind each
 * split every hint (one attribution, one `rel` per row). Images and Fonts
 * are preloads (a subset of the Preload kind), so they get their own choice
 * whose values keep the preload condition.
 */
export const PRELOADED_PAGE_FACETS: FacetSet<PreloadedResource, PreloadedFacetId> = defineFacets<
  PreloadedResource,
  PreloadedFacetId
>([
  choiceFacet('source', 'Source', [WP_ROCKET_HINTS, UNATTRIBUTED_HINTS]),
  choiceFacet('hint', 'Hint', [
    PRELOAD_HINTS,
    MODULEPRELOAD_HINTS,
    PRECONNECT_HINTS,
    DNS_PREFETCH_HINTS
  ]),
  choiceFacet('preload-type', 'Preload type', [IMAGE_PRELOADS, FONT_PRELOADS])
]);

/**
 * Classify the Delay JS script inventory into page rows. The searched
 * content is the inline source text for inline scripts and the URL for
 * external ones; a record whose content/src is absent reads as an empty
 * searched field (empty attributes and empty scripts are legitimate engine
 * output; an empty string can never match a non-empty query).
 *
 * @param delayJs The Delay JS row and its script inventory.
 * @param facts The page verdicts the minify states read (default: none
 *   holds, so no row reads Minified or Combined).
 * @returns One row per record, in document order.
 */
export function buildScriptRows(
  delayJs: WprDetections['delay_js'],
  facts: ScriptPageFacts = NO_SCRIPT_PAGE_FACTS
): JsScriptResource[] {
  return delayJs.scripts.map((script, index): JsScriptResource => {
    const { minified, combined } = scriptMinifyState(script, facts);
    return {
      id: index,
      type: script.inline ? 'inline' : 'external',
      content: (script.inline ? script.content : script.src) ?? '',
      delayed: script.delayed,
      deferred: script.deferred,
      deferredByWPR: script.deferredByWPR,
      fdtExcluded: script.fdtExcluded,
      minified,
      combined,
      minifyAttribute: script.minifyAttribute,
      // The detection records the original type on delayed scripts only.
      originalType: script.delayed ? (script.originalType ?? null) : null
    };
  });
}

/**
 * Classify the lazyload scan's image list into page rows. The exclusion
 * reasons list is copied (the row stays independent of the payload it came
 * from).
 */
export function buildLazyloadRows(lazyload: WprDetections['lazyload']): LazyloadImageResource[] {
  return lazyload.images.map((image, index): LazyloadImageResource => ({
    id: index,
    src: image.src,
    lazyloaded: image.lazyloadDetected,
    excludedReasons: [...image.excludedReasonsFound]
  }));
}

/**
 * The report's hints: its inventory, or — on a payload captured before the
 * inventory existed — its WP Rocket preloads read as stamped preload hints
 * (the marker is the plugin's preload stamp; their `as` type normalized as
 * the inventory writes it).
 *
 * @param report The payload's preloaded-resources report.
 */
export function reportHints(report: PreloadedResources): readonly ResourceHint[] {
  if (report.hints !== undefined) return report.hints;
  return (report.resources ?? []).map((resource): ResourceHint => ({
    rel: 'preload',
    href: resource.href,
    as: resource.type.trim().toLowerCase(),
    mark: 'preload'
  }));
}

/**
 * The cut mark of the list {@link reportHints} reads: each list carries its
 * own (the hints `hintsTruncated`, the preload list `truncated`).
 *
 * @param report The payload's preloaded-resources report.
 */
export function reportHintsTruncated(report: PreloadedResources): true | undefined {
  return report.hints === undefined ? report.truncated : report.hintsTruncated;
}

/**
 * Classify the report's hints into page rows, in inventory order (WP
 * Rocket's first, then by kind — {@link hintRank}); a report without a
 * collected list reads as zero rows (the page's honest empty state).
 *
 * @param report The payload's preloaded-resources report.
 * @param detections The page's detection rows (attribution proof).
 * @returns The rows, `id` = the hint's capture position.
 */
export function buildPreloadedRows(
  report: PreloadedResources,
  detections: WprDetections
): PreloadedResource[] {
  const ranked = reportHints(report).map((hint, index) => {
    const attribution = hintAttribution(hint, detections);
    const row: PreloadedResource = {
      id: index,
      rel: hint.rel,
      as: hint.as,
      href: hint.href,
      attribution
    };
    return { row, rank: hintRank(hint, attribution) };
  });
  // Stable: equal ranks keep capture (document) order.
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map(({ row }) => row);
}
