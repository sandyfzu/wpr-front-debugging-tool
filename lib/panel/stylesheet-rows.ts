/**
 * The Stylesheets page's rows: the classification of the page's stylesheet
 * inventory (with the one Critical placement rule) into the row shape
 * `./style-states` declares, and the page's filter pattern — the shared
 * resource-list pattern (`./resources-view-model`) over those rows. Imported
 * by the lazily loaded page only.
 */
import type { PageStylesheetsReply } from '../messaging/page-stylesheets';
import { CRITICAL_CSS_STYLE_ID } from '../wp-rocket/constants';
import { stateFilter, type ResourcePageDefinition } from './resources-view-model';
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

/** The Stylesheets page's chip ids, in render order. */
export type CssFilterId = 'all' | CssStateId | 'inline' | 'external';

/** The Stylesheets page's pattern: every style state (chip order), then the type chips. */
export const CSS_PAGE_RESOURCES: ResourcePageDefinition<CssStyleResource, CssFilterId> = {
  filters: [
    { id: 'all', label: 'Show all', predicate: () => true },
    stateFilter(cssStyleState('critical')),
    stateFilter(cssStyleState('rucss')),
    stateFilter(cssStyleState('lazy-bg')),
    stateFilter(cssStyleState('async')),
    stateFilter(cssStyleState('minified')),
    stateFilter(cssStyleState('font')),
    { id: 'inline', label: 'Inline', predicate: (row) => row.type === 'inline' },
    { id: 'external', label: 'External', predicate: (row) => row.type === 'external' }
  ],
  searchField: (row) => row.content
};

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
  reply: PageStylesheetsReply,
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
      critical: isLiveCriticalStyle(entry, facts),
      rocketAsync: entry.rocketAsync,
      hostedFont: entry.hostedFont
    };
  });
  const cut = reply.total > reply.styles.length;
  if (!facts.criticalStyle || cut || rows.some((row) => row.critical)) return rows;
  return [CRITICAL_SNAPSHOT_ROW, ...rows];
}
