/**
 * The Stylesheets page's row shape and style states — the one declaring
 * site of what each state means, read by both the row chips and the filter
 * chips (a filter selects exactly the rows that show its chip). Only states WP Rocket's own
 * markup proves get one: the reserved ids of the styles it prints, the
 * stamps on the links it rewrote.
 *
 * Two kinds of input: tag facts carried by each listed style (kind, id, the
 * minify/async/hosted-font stamps, the URL) and page facts the detection
 * pass decided once (the Minify CSS verdict, WP Rocket proven, and whether
 * the critical-path style was on the page at DOMContentLoaded). As on the
 * JavaScript page, the minify stamp alone never attributes a file: it counts
 * only on a page whose Minify CSS verdict holds and where WP Rocket is
 * proven; the minify-cache URL counts under the verdict alone.
 */

import { minifyFootprint } from '../detection/minify-footprint';
import type { PageStylesheetEntry } from '../messaging/page-stylesheets';
import {
  CRITICAL_CSS_STYLE_ID,
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  MINIFY_ATTRIBUTE_VALUE,
  RUCSS_USED_CSS_ID
} from '../wp-rocket/constants';
import type { WprDetections } from '../wp-rocket/types';

/** The page-level verdicts a style's states depend on. */
export interface StylesheetPageFacts {
  /** WP Rocket's Minify CSS ran on the page (meta or footprint verdict). */
  readonly minifyCss: boolean;
  /** WP Rocket is proven on the page by its own evidence. */
  readonly wprProven: boolean;
  /**
   * The critical-path style was on the page at DOMContentLoaded. Read from
   * the detection snapshot: Load CSS asynchronously removes the style once
   * the page's stylesheets have loaded, so a later reading can miss it.
   */
  readonly criticalStyle: boolean;
}

/** One classified style row on the Stylesheets page. */
export interface CssStyleResource {
  /** List position (live rows); the snapshot-only critical row is `CRITICAL_SNAPSHOT_ROW_ID` (`./stylesheet-rows`). */
  readonly id: number;
  /** An inline `<style>` or a stylesheet `<link>`. */
  readonly type: 'inline' | 'external';
  /**
   * `live`: on the page when it was listed; `snapshot`: the critical-path
   * style the DOMContentLoaded capture saw and the page no longer has.
   */
  readonly source: 'live' | 'snapshot';
  /** The element's id (`''` when none). */
  readonly elementId: string;
  /** The element's class attribute (`''` when none). */
  readonly className: string;
  /** A link's resolved URL (`''` for inline styles and a link without one). */
  readonly href: string;
  /** The element's media attribute (`''` when none). */
  readonly media: string;
  /** The start of an inline style's CSS (`''` for links). */
  readonly preview: string;
  /** An inline style's CSS length in characters (0 for links and the snapshot row). */
  readonly chars: number;
  /** The searched field: a link's URL, an inline style's identity and CSS preview. */
  readonly content: string;
  /** Minify CSS served this file (see {@link isStylesheetMinified}). */
  readonly minified: boolean;
  /** The critical-path style (see {@link isLiveCriticalStyle}; always on the snapshot row). */
  readonly critical: boolean;
  /** The link carries Load CSS asynchronously's stamp. */
  readonly rocketAsync: boolean;
  /** The link carries Self-host Google Fonts' attribute. */
  readonly hostedFont: boolean;
}

/** No page verdict holds: no style reads Minified or Critical. */
export const NO_STYLESHEET_PAGE_FACTS: StylesheetPageFacts = {
  minifyCss: false,
  wprProven: false,
  criticalStyle: false
};

/**
 * Read the page facts off the detection record.
 *
 * @param detections The page's detection record.
 * @returns The three verdicts the style states read.
 */
export function stylesheetPageFacts(detections: WprDetections): StylesheetPageFacts {
  return {
    minifyCss: detections.minify_css.present,
    wprProven: detections.wpr.present,
    criticalStyle: detections.async_css.criticalStyle
  };
}

/**
 * Whether two fact sets agree (the page memoizes on it: an unchanged verdict
 * set never re-classifies the rows).
 *
 * @param a One fact set.
 * @param b The other.
 * @returns True when all three verdicts are equal.
 */
export function sameStylesheetPageFacts(a: StylesheetPageFacts, b: StylesheetPageFacts): boolean {
  return (
    a.minifyCss === b.minifyCss &&
    a.wprProven === b.wprProven &&
    a.criticalStyle === b.criticalStyle
  );
}

/**
 * Whether a listed link reads Minified: Minify CSS ran and the link carries
 * a minify footprint — the cache URL on its own, or the stamp only where WP
 * Rocket is proven (the detection guard's rule, read from its verdict). An
 * inline style or a link without a URL never does.
 *
 * @param entry The listed style.
 * @param facts The page facts.
 */
export function isStylesheetMinified(
  entry: PageStylesheetEntry,
  facts: StylesheetPageFacts
): boolean {
  if (entry.kind !== 'link' || entry.href === '' || !facts.minifyCss) return false;
  const footprint = minifyFootprint(
    entry.href,
    entry.minifyAttribute ? MINIFY_ATTRIBUTE_VALUE : null,
    'css'
  );
  return footprint === 'url' || (footprint === 'attribute' && facts.wprProven);
}

/**
 * Whether a listed style is the critical-path style and reads Critical: the
 * inline style with WP Rocket's id, exactly, while the snapshot saw one — a
 * style injected after DOMContentLoaded proves nothing.
 *
 * @param entry The listed style.
 * @param facts The page facts.
 */
export function isLiveCriticalStyle(
  entry: PageStylesheetEntry,
  facts: StylesheetPageFacts
): boolean {
  return facts.criticalStyle && entry.kind === 'inline' && entry.id === CRITICAL_CSS_STYLE_ID;
}

/** Remove Unused CSS's reserved style id. */
const RUCSS_STYLE_IDS: ReadonlySet<string> = new Set([RUCSS_USED_CSS_ID]);

/**
 * Lazyload for CSS background images' reserved style ids on the live page
 * (its third style sits inside `<noscript>`, text in a scripting page).
 */
const LAZY_BG_STYLE_IDS: ReadonlySet<string> = new Set([
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID
]);

/**
 * Whether an inline style carries one of the given reserved ids (exact case:
 * WP Rocket writes them lower-case).
 *
 * @param row The row.
 * @param ids The reserved ids.
 */
function inlineWithId(row: CssStyleResource, ids: ReadonlySet<string>): boolean {
  return row.type === 'inline' && ids.has(row.elementId);
}

/** The style states, most important first (the chips' order). */
export type CssStateId = 'critical' | 'rucss' | 'lazy-bg' | 'async' | 'minified' | 'font';

/** One style state: its id, its one-word label and the rows it holds on. */
export interface CssStyleState {
  readonly id: CssStateId;
  readonly label: string;
  readonly holds: (row: CssStyleResource) => boolean;
}

/**
 * Every state, most important first: the styles WP Rocket printed itself
 * (critical path, used CSS, background lazyload) lead, then how it loads a
 * link, then the file states.
 */
export const CSS_STYLE_STATES: readonly CssStyleState[] = [
  { id: 'critical', label: 'Critical', holds: (row) => row.critical },
  { id: 'rucss', label: 'RUCSS', holds: (row) => inlineWithId(row, RUCSS_STYLE_IDS) },
  { id: 'lazy-bg', label: 'Lazy BG', holds: (row) => inlineWithId(row, LAZY_BG_STYLE_IDS) },
  { id: 'async', label: 'Async', holds: (row) => row.type === 'external' && row.rocketAsync },
  { id: 'minified', label: 'Minified', holds: (row) => row.minified },
  { id: 'font', label: 'Font', holds: (row) => row.type === 'external' && row.hostedFont }
];

/**
 * One state's row.
 *
 * @param id The state id.
 * @returns The state's table row.
 * @throws {@link Error} When the table has no such id — a wiring bug.
 */
export function cssStyleState(id: CssStateId): CssStyleState {
  const state = CSS_STYLE_STATES.find((row) => row.id === id);
  if (state === undefined) throw new Error(`Unknown style state id: "${id}".`);
  return state;
}
