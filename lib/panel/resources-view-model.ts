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

/**
 * The JavaScript page's pattern: the reference-surface chips, then the file
 * states and the local exclusion, then the type chips.
 */
export const JS_PAGE_RESOURCES: ResourcePageDefinition<JsScriptResource, JsFilterId> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    stateFilter(jsScriptState('delayed')),
    negatedFilter('non-delayed', 'Non-delayed', 'delayed'),
    stateFilter(jsScriptState('deferred')),
    negatedFilter('non-deferred', 'Non-deferred', 'deferred'),
    stateFilter(jsScriptState('minified')),
    stateFilter(jsScriptState('combined')),
    stateFilter(jsScriptState('excluded')),
    { id: 'inline', label: 'Inline', predicate: (row) => row.type === 'inline' },
    { id: 'external', label: 'External', predicate: (row) => row.type === 'external' }
  ],
  searchField: (row) => row.content
};

/** The Lazyload page's chip ids, in render order. */
export type LazyloadFilterId = 'all' | 'lazyloaded' | 'non-lazyloaded' | 'excluded';

/** The Lazyloaded state (its negation is the Non-lazyloaded filter). */
const LAZYLOADED = lazyloadImageState('lazyloaded');

/** The Lazyload page's pattern: every image, Lazyloaded and its negation, then the local exclusion. */
export const LAZYLOAD_PAGE_RESOURCES: ResourcePageDefinition<
  LazyloadImageResource,
  LazyloadFilterId
> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    stateFilter(LAZYLOADED),
    { id: 'non-lazyloaded', label: 'Non-lazyloaded', predicate: (row) => !LAZYLOADED.holds(row) },
    stateFilter(lazyloadImageState('excluded'))
  ],
  searchField: (row) => row.src
};

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
    { id: 'wp-rocket', label: 'WP Rocket', predicate: (row) => row.attribution.by === 'wp-rocket' },
    {
      id: 'unattributed',
      label: 'Unattributed',
      predicate: (row) => row.attribution.by === 'page'
    },
    kindFilter('preload', 'Preload'),
    preloadAsFilter('images', 'Images', 'image'),
    preloadAsFilter('fonts', 'Fonts', 'font'),
    kindFilter('modulepreload', 'Module preload'),
    kindFilter('preconnect', 'Preconnect'),
    kindFilter('dns-prefetch', 'DNS prefetch')
  ],
  searchField: (row) => row.href
};

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
  const queryText = query.toLowerCase();
  if (queryText === '') return filtered;
  return filtered.filter((row) => definition.searchField(row).toLowerCase().includes(queryText));
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
