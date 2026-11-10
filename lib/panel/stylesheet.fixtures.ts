/**
 * Test-only fixtures for the style-state and stylesheet-row suites: listed
 * entries with overrides, minify URLs, the all-facts set, and the row and
 * state readers both suites assert through. Imported by tests only — never
 * by shipped code.
 */
import type { PageStylesheetEntry } from '../messaging/page-stylesheets';
import { buildStylesheetRows } from './stylesheet-rows';
import {
  CSS_STYLE_STATES,
  type CssStateId,
  type CssStyleResource,
  type StylesheetPageFacts
} from './style-states';

/** A minified per-file URL (the original path mirrored under the cache). */
export const MINIFIED = 'https://s.test/wp-content/cache/min/1/wp-content/themes/a/style.css?ver=1';
/** A site-moved cache root: the URL arm misses, only the stamp remains. */
export const MOVED = 'https://s.test/wp-content/wpr-files/min/1/wp-content/themes/a/style.css';

/** Every page fact holding. */
export const ALL: StylesheetPageFacts = { minifyCss: true, wprProven: true, criticalStyle: true };

/**
 * A listed link.
 *
 * @param overrides Fields to change.
 * @returns A plain stylesheet link entry with the overrides applied.
 */
export function link(overrides: Partial<PageStylesheetEntry> = {}): PageStylesheetEntry {
  return {
    kind: 'link',
    id: '',
    className: '',
    href: 'https://s.test/plain.css',
    media: '',
    preview: '',
    chars: 0,
    minifyAttribute: false,
    rocketAsync: false,
    hostedFont: false,
    ...overrides
  };
}

/**
 * A listed inline style.
 *
 * @param overrides Fields to change.
 * @returns A 4-character inline style entry with the overrides applied.
 */
export function inline(overrides: Partial<PageStylesheetEntry> = {}): PageStylesheetEntry {
  return link({ kind: 'inline', href: '', preview: '.a{}', chars: 4, ...overrides });
}

/**
 * The state ids a row shows.
 *
 * @param row The row.
 * @returns Its state ids, in chip order.
 */
export function statesOf(row: CssStyleResource): CssStateId[] {
  return CSS_STYLE_STATES.filter((state) => state.holds(row)).map((state) => state.id);
}

/**
 * Rows of an uncut reply listing exactly `styles`.
 *
 * @param styles The listed entries.
 * @param facts The page facts (default: all hold).
 * @returns The classified rows.
 */
export function rows(
  styles: PageStylesheetEntry[],
  facts: StylesheetPageFacts = ALL
): CssStyleResource[] {
  return buildStylesheetRows({ styles, total: styles.length }, facts);
}
