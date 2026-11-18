/**
 * The resource-list pages' shared view model — the JavaScript, Stylesheets,
 * Lazyload and Preloaded Resources pages are one filter/search pattern over
 * four row shapes (the Stylesheets page's rows live in `./stylesheet-rows`,
 * imported by its lazily loaded page only, so the panel's start never pays
 * for them). Everything here is pure and data-driven: a page's filter chips,
 * predicates and searched field are one definition table, so adding a page
 * (or a P14 "Runtime states" share) is one row/table, never a new branch in
 * the page.
 *
 * The pages wrap the helpers in `createMemo` graphs — the fine-grained
 * reactivity replaces the per-render cache maps the pattern otherwise needs,
 * and the counts come out of a single items pass (no double iteration).
 */

import type {
  PreloadedResources,
  ResourceHint,
  ResourceHintRel,
  WprDetections
} from '../wp-rocket/types';
import { hintAttribution, hintRank, type HintAttribution } from './hint-attribution';
import { lazyloadImageState } from './lazyload-states';
import { choiceFacet, defineFacets, toggleFacet, type FacetSet } from './resource-facets';
import { searchPredicate } from './row-search';
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

/** One filter chip's data: id, label, and the row predicate it applies. */
export interface ResourceFilterRow<Row, Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly predicate: (row: Row) => boolean;
}

/**
 * One page's resource pattern: its chip rows in render order plus the row
 * field the search box filters over (scripts → content, images → src,
 * hints → href).
 */
export interface ResourcePageDefinition<Row, Id extends string> {
  readonly filters: readonly ResourceFilterRow<Row, Id>[];
  readonly searchField: (row: Row) => string;
}

/** A row with a type: the script and style rows' shared Type dimension. */
interface TypedRow {
  readonly type: 'inline' | 'external';
}

/** The Inline type chip / facet value (shared by the script and style pages). */
export const INLINE_TYPE_FILTER: ResourceFilterRow<TypedRow, 'inline'> = {
  id: 'inline',
  label: 'Inline',
  predicate: (row) => row.type === 'inline'
};

/** The External type chip / facet value (shared by the script and style pages). */
export const EXTERNAL_TYPE_FILTER: ResourceFilterRow<TypedRow, 'external'> = {
  id: 'external',
  label: 'External',
  predicate: (row) => row.type === 'external'
};

/** The JavaScript page's chip ids, in render order. */
export type JsFilterId =
  | 'all'
  | 'delayed'
  | 'non-delayed'
  | 'deferred'
  | 'non-deferred'
  | 'minified'
  | 'combined'
  | 'excluded'
  | 'inline'
  | 'external';

/**
 * A filter chip over one row state: its label and predicate are the state's
 * own, so a filter selects exactly the rows showing that chip.
 *
 * @param state The state (its id is also the chip id).
 */
export function stateFilter<Row, Id extends string>(state: {
  readonly id: Id;
  readonly label: string;
  readonly holds: (row: Row) => boolean;
}): ResourceFilterRow<Row, Id> {
  return { id: state.id, label: state.label, predicate: state.holds };
}

/**
 * A filter chip over a state's negation (the negative states are no row
 * chips; their filters keep them reachable).
 *
 * @param id The chip id.
 * @param label The chip label.
 * @param of The negated state.
 */
function negatedFilter(
  id: JsFilterId,
  label: string,
  of: JsStateId
): ResourceFilterRow<JsScriptResource, JsFilterId> {
  const { holds } = jsScriptState(of);
  return { id, label, predicate: (row) => !holds(row) };
}

// The script chips, each declared once: the chip bar and the facets list the same objects.

/** Delayed chip / Delay value: Delay JS delayed the script. */
const DELAYED_SCRIPTS = stateFilter(jsScriptState('delayed'));
/** Non-delayed chip / Delay value: every script the Delayed chip leaves out. */
const NON_DELAYED_SCRIPTS = negatedFilter('non-delayed', 'Non-delayed', 'delayed');
/** Deferred chip / Defer value: an external script with a native `defer` or WP Rocket's defer stamp. */
const DEFERRED_SCRIPTS = stateFilter(jsScriptState('deferred'));
/** Non-deferred chip / Defer value: every script the Deferred chip leaves out. */
const NON_DEFERRED_SCRIPTS = negatedFilter('non-deferred', 'Non-deferred', 'deferred');
/** Minified chip / File value: a file Minify JS served (never a bundle). */
const MINIFIED_SCRIPTS = stateFilter(jsScriptState('minified'));
/** Combined chip / File value: a Combine JS bundle. */
const COMBINED_SCRIPTS = stateFilter(jsScriptState('combined'));
/** Excluded chip / toggle: the local exclusion marker kept the script out of Delay/Defer JS. */
const EXCLUDED_SCRIPTS = stateFilter(jsScriptState('excluded'));

/**
 * The JavaScript page's pattern: the reference-surface chips, then the file
 * states and the local exclusion, then the type chips.
 */
export const JS_PAGE_RESOURCES: ResourcePageDefinition<JsScriptResource, JsFilterId> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    DELAYED_SCRIPTS,
    NON_DELAYED_SCRIPTS,
    DEFERRED_SCRIPTS,
    NON_DEFERRED_SCRIPTS,
    MINIFIED_SCRIPTS,
    COMBINED_SCRIPTS,
    EXCLUDED_SCRIPTS,
    INLINE_TYPE_FILTER,
    EXTERNAL_TYPE_FILTER
  ],
  searchField: (row) => row.content
};

/** The JavaScript page's facet ids, in render order. */
export type JsFacetId = 'delay' | 'defer' | 'type' | 'file' | 'excluded';

/**
 * The JavaScript page's facets (value ids = the chip ids): Delay, Defer and
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
  choiceFacet('type', 'Type', [INLINE_TYPE_FILTER, EXTERNAL_TYPE_FILTER]),
  choiceFacet('file', 'File', [MINIFIED_SCRIPTS, COMBINED_SCRIPTS]),
  toggleFacet('excluded', EXCLUDED_SCRIPTS.label, EXCLUDED_SCRIPTS.predicate)
]);

/** The Lazyload page's chip ids, in render order. */
export type LazyloadFilterId = 'all' | 'lazyloaded' | 'non-lazyloaded' | 'excluded';

// The image chips, each declared once: the chip bar and the facets list the same objects.

/** Lazyloaded chip / Lazyload value: WP Rocket's lazyload took the image. */
const LAZYLOADED_IMAGES = stateFilter(lazyloadImageState('lazyloaded'));
/** Non-lazyloaded chip / Lazyload value: every image the Lazyloaded chip leaves out. */
const NON_LAZYLOADED_IMAGES: ResourceFilterRow<LazyloadImageResource, LazyloadFilterId> = {
  id: 'non-lazyloaded',
  label: 'Non-lazyloaded',
  predicate: (row) => !LAZYLOADED_IMAGES.predicate(row)
};
/** Excluded chip / toggle: the local exclusion marker kept the image out of lazyload. */
const EXCLUDED_IMAGES = stateFilter(lazyloadImageState('excluded'));

/** The Lazyload page's pattern: every image, Lazyloaded and its negation, then the local exclusion. */
export const LAZYLOAD_PAGE_RESOURCES: ResourcePageDefinition<
  LazyloadImageResource,
  LazyloadFilterId
> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    LAZYLOADED_IMAGES,
    NON_LAZYLOADED_IMAGES,
    EXCLUDED_IMAGES
  ],
  searchField: (row) => row.src
};

/** The Lazyload page's facet ids, in render order. */
export type LazyloadFacetId = 'lazyload' | 'excluded';

/**
 * The Lazyload page's facets: Lazyload splits every image in two; Excluded
 * is a subset of Non-lazyloaded (the marker counts only on an image that is
 * not lazyloaded), so it is a toggle — on alone it is exactly the Excluded chip.
 */
export const LAZYLOAD_PAGE_FACETS: FacetSet<LazyloadImageResource, LazyloadFacetId> = defineFacets<
  LazyloadImageResource,
  LazyloadFacetId
>([
  choiceFacet('lazyload', 'Lazyload', [LAZYLOADED_IMAGES, NON_LAZYLOADED_IMAGES]),
  toggleFacet('excluded', EXCLUDED_IMAGES.label, EXCLUDED_IMAGES.predicate)
]);

/** The Preloaded Resources page's chip ids, in render order. */
export type PreloadedFilterId =
  | 'all'
  | 'wp-rocket'
  | 'unattributed'
  | 'preload'
  | 'images'
  | 'fonts'
  | 'modulepreload'
  | 'preconnect'
  | 'dns-prefetch';

/**
 * A chip over one hint kind.
 *
 * @param id The chip id (the kind's own `rel` token).
 * @param label The chip label.
 */
function kindFilter(
  id: ResourceHintRel,
  label: string
): ResourceFilterRow<PreloadedResource, PreloadedFilterId> {
  return { id, label, predicate: (row) => row.rel === id };
}

/**
 * A chip over one preload `as` type (the hint kind the type matters for).
 *
 * @param id The chip id.
 * @param label The chip label.
 * @param as The `as` type.
 */
function preloadAsFilter(
  id: PreloadedFilterId,
  label: string,
  as: string
): ResourceFilterRow<PreloadedResource, PreloadedFilterId> {
  return { id, label, predicate: (row) => row.rel === 'preload' && row.as === as };
}

// The hint chips, each declared once: the chip bar and the facets list the same objects.

/** WP Rocket chip / Source value: a hint attributed to WP Rocket. */
const WP_ROCKET_HINTS: ResourceFilterRow<PreloadedResource, PreloadedFilterId> = {
  id: 'wp-rocket',
  label: 'WP Rocket',
  predicate: (row) => row.attribution.by === 'wp-rocket'
};
/** Unattributed chip / Source value: a hint not attributed to WP Rocket. */
const UNATTRIBUTED_HINTS: ResourceFilterRow<PreloadedResource, PreloadedFilterId> = {
  id: 'unattributed',
  label: 'Unattributed',
  predicate: (row) => row.attribution.by === 'page'
};
/** Preload chip / Hint value: `rel=preload`. */
const PRELOAD_HINTS = kindFilter('preload', 'Preload');
/** Images chip / Preload type value: a preload `as=image`. */
const IMAGE_PRELOADS = preloadAsFilter('images', 'Images', 'image');
/** Fonts chip / Preload type value: a preload `as=font`. */
const FONT_PRELOADS = preloadAsFilter('fonts', 'Fonts', 'font');
/** Module preload chip / Hint value: `rel=modulepreload`. */
const MODULEPRELOAD_HINTS = kindFilter('modulepreload', 'Module preload');
/** Preconnect chip / Hint value: `rel=preconnect`. */
const PRECONNECT_HINTS = kindFilter('preconnect', 'Preconnect');
/** DNS prefetch chip / Hint value: `rel=dns-prefetch`. */
const DNS_PREFETCH_HINTS = kindFilter('dns-prefetch', 'DNS prefetch');

/**
 * The Preloaded Resources page's pattern: attribution first (WP Rocket's
 * hints vs the unattributed rest), then the hint kinds, preloads with their
 * two common types beside them.
 */
export const PRELOADED_PAGE_RESOURCES: ResourcePageDefinition<
  PreloadedResource,
  PreloadedFilterId
> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    WP_ROCKET_HINTS,
    UNATTRIBUTED_HINTS,
    PRELOAD_HINTS,
    IMAGE_PRELOADS,
    FONT_PRELOADS,
    MODULEPRELOAD_HINTS,
    PRECONNECT_HINTS,
    DNS_PREFETCH_HINTS
  ],
  searchField: (row) => row.href
};

/** The Preloaded Resources page's facet ids, in render order. */
export type PreloadedFacetId = 'source' | 'hint' | 'preload-type';

/**
 * The Preloaded Resources page's facets: attribution and hint kind each
 * split every hint (one attribution, one `rel` per row). Images and Fonts
 * are preloads (a subset of the Preload kind), so they get their own choice
 * whose values keep the preload condition — each alone is exactly its chip.
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

/**
 * Rows under one chip, then the search query applied to that same subset —
 * the chip state composes with the search box (the reference surface
 * discarded the active filter while searching; composing gives the chip +
 * query pair one honest, narrower answer). The query matches the page's
 * searched field case-insensitively and as a substring; an empty query is
 * the filter alone.
 *
 * @param items The page's full row list.
 * @param definition The page's pattern (chips + searched field).
 * @param filterId The chip to apply.
 * @param query The search query ('' = no search phase).
 * @returns The rows to render, in the input's order.
 * @throws {@link Error} if `filterId` is not one of the definition's chip
 *   ids — a page-side wiring bug, never a data condition.
 */
export function filterAndSearch<Row, Id extends string>(
  items: readonly Row[],
  definition: ResourcePageDefinition<Row, Id>,
  filterId: Id,
  query: string
): readonly Row[] {
  const filter = definition.filters.find((row) => row.id === filterId);
  if (filter === undefined) {
    throw new Error(`Unknown filter id: this page's chip set has no id "${filterId}".`);
  }
  const filtered = items.filter(filter.predicate);
  const matches = searchPredicate(definition.searchField, query);
  return matches === null ? filtered : filtered.filter(matches);
}

/**
 * Every chip's count from one pass over the rows: each row answers each
 * chip's predicate exactly once, so a page's summary bar and chip counters
 * read from one pass (the "Show All" chip counts all rows — its predicate
 * is the identity). Pages wrap this in a memo over the same rows memo the
 * list renders from.
 *
 * @param items The page's full row list.
 * @param definition The page's pattern.
 * @returns A count per chip id, including absent chips' zero entries.
 */
export function filterCounts<Row, Id extends string>(
  items: readonly Row[],
  definition: ResourcePageDefinition<Row, Id>
): Readonly<Record<Id, number>> {
  const counts = {} as Record<Id, number>;
  for (const filter of definition.filters) counts[filter.id] = 0;
  for (const item of items) {
    for (const filter of definition.filters) {
      if (filter.predicate(item)) counts[filter.id] += 1;
    }
  }
  return counts;
}
