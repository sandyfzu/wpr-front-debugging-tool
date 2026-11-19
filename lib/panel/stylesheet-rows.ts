/**
 * The Stylesheets page's rows: the classification of the page's stylesheet
 * inventory (with the one Critical placement rule) into the row shape
 * `./style-states` declares, its searched field and its facets
 * (`./resource-facets`, values shared with `./resources-view-model`).
 * Imported by the lazily loaded page only.
 */
import type { PageStylesheetsReply } from '../messaging/page-stylesheets';
import { CRITICAL_CSS_STYLE_ID } from '../wp-rocket/constants';
import {
  choiceFacet,
  defineFacets,
  toggleFacet,
  type Facet,
  type FacetSet
} from './resource-facets';
import { EXTERNAL_TYPE_VALUE, INLINE_TYPE_VALUE, stateValue } from './resources-view-model';
import { styleIdentity } from './style-identity';
import {
  NO_STYLESHEET_PAGE_FACTS,
  cssStyleState,
  isLiveCriticalStyle,
  isStylesheetMinified,
  type CssStateId,
  type CssStyleResource,
  type StylesheetPageFacts
} from './style-states';

/**
 * The Stylesheets page's searched field: an inline style's CSS start, a link's URL.
 *
 * @param row The row.
 * @returns The searched text.
 */
export function cssStyleSearchField(row: CssStyleResource): string {
  return row.content;
}

/** The Stylesheets page's facet ids, in render order. */
export type CssFacetId = 'type' | 'rocket-css' | 'async' | 'minified' | 'font';

/**
 * A toggle facet over one style state (id, label and predicate the state's own).
 *
 * @param id The state id (also the facet id).
 * @returns The toggle facet.
 */
function stateToggle(id: Extract<CssStateId, CssFacetId>): Facet<CssStyleResource, CssFacetId> {
  const state = cssStyleState(id);
  return toggleFacet(id, state.label, state.holds);
}

/**
 * The Stylesheets page's facets (value ids = the style state ids): Type splits
 * every style in two. The three styles WP Rocket prints itself (Critical,
 * RUCSS, Lazy BG) are inline styles told apart by their reserved id — one
 * row holds at most one — so they are one choice. The link states (Async,
 * Minified, Font) can stack on one link, so each is a toggle.
 */
export const CSS_PAGE_FACETS: FacetSet<CssStyleResource, CssFacetId> = defineFacets<
  CssStyleResource,
  CssFacetId
>([
  choiceFacet('type', 'Type', [INLINE_TYPE_VALUE, EXTERNAL_TYPE_VALUE]),
  choiceFacet('rocket-css', 'WP Rocket CSS', [
    stateValue(cssStyleState('critical')),
    stateValue(cssStyleState('rucss')),
    stateValue(cssStyleState('lazy-bg'))
  ]),
  stateToggle('async'),
  stateToggle('minified'),
  stateToggle('font')
]);

/** The snapshot-only critical row's id (live rows count from 0). */
export const CRITICAL_SNAPSHOT_ROW_ID = -1;

/**
 * The row standing for the critical-path style the DOMContentLoaded capture
 * saw and the live page no longer has (usually Load CSS asynchronously,
 * which removes it once the stylesheets load; a page script or a RUCSS test
 * can remove it too). The snapshot carries no CSS, so the row has none.
 */
const CRITICAL_SNAPSHOT_ROW: CssStyleResource = {
  id: CRITICAL_SNAPSHOT_ROW_ID,
  type: 'inline',
  source: 'snapshot',
  elementId: CRITICAL_CSS_STYLE_ID,
  className: '',
  href: '',
  media: '',
  preview: '',
  chars: 0,
  content: `#${CRITICAL_CSS_STYLE_ID}`,
  minified: false,
  minifyAttribute: false,
  critical: true,
  rocketAsync: false,
  hostedFont: false
};

/**
 * Classify the stylesheet inventory into page rows. The Critical chip sits
 * on exactly one place: the live critical-path style when the page still
 * has it, else — when the snapshot saw one — a leading snapshot row; never
 * both, and nowhere when the snapshot saw none. A cut list never gets the
 * snapshot row: the live style may sit past the cut, and the row count must
 * stay the listed styles' (the summary reads "first N of M").
 *
 * @param reply The page's stylesheet inventory.
 * @param facts The page verdicts the states read (default: none holds).
 * @returns One row per listed style, in document order, after the snapshot row when there is one.
 */
export function buildStylesheetRows(
  reply: Pick<PageStylesheetsReply, 'styles' | 'total'>,
  facts: StylesheetPageFacts = NO_STYLESHEET_PAGE_FACTS
): CssStyleResource[] {
  const rows = reply.styles.map((entry, index): CssStyleResource => {
    const external = entry.kind === 'link';
    return {
      id: index,
      type: external ? 'external' : 'inline',
      source: 'live',
      elementId: entry.id,
      className: entry.className,
      href: entry.href,
      media: entry.media,
      preview: entry.preview,
      chars: entry.chars,
      content: external ? entry.href : `${styleIdentity(entry)} ${entry.preview}`.trim(),
      minified: isStylesheetMinified(entry, facts),
      minifyAttribute: entry.minifyAttribute,
      critical: isLiveCriticalStyle(entry, facts),
      rocketAsync: entry.rocketAsync,
      hostedFont: entry.hostedFont
    };
  });
  const cut = reply.total > reply.styles.length;
  if (!facts.criticalStyle || cut || rows.some((row) => row.critical)) return rows;
  return [CRITICAL_SNAPSHOT_ROW, ...rows];
}
