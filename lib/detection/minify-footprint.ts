/**
 * Minify CSS/JS footprints, two arms per tag: the served URL under the
 * minify cache (`cache/min/<n>/…`, WP Rocket's own path) and the
 * `data-minify="1"` stamp WP Rocket writes beside it. The URL arm decides on
 * its own; the attribute arm exists for the pages it misses (a site-moved
 * cache root) but proves nothing alone — any page can write the attribute —
 * so the orchestrator counts it only under its proof guard.
 */

import { MINIFY_ATTRIBUTE, MINIFY_ATTRIBUTE_VALUE } from '../wp-rocket/constants';
import { hasMinifiedCacheUrl, type MinifiedAssetExtension } from '../wp-rocket/minify-cache-url';
import type { WprDetections } from '../wp-rocket/types';
import type { ParsedPage } from './parse-page';
import { servedScriptSrc, servedScriptSrcAttribute } from './served-script-src';
import { isStylesheetLink } from './stylesheet-links';

/** The two rows a minify footprint decides. */
export type MinifyRow = Extract<keyof WprDetections, 'minify_css' | 'minify_js'>;

/** Which arm matched a tag: the cache URL wins over the attribute. */
export type MinifyFootprint = 'url' | 'attribute';

/**
 * The per-tag test: the URL the URL arm reads and the minify attribute the
 * attribute arm may read (`null` when absent or not eligible).
 */
type CandidateVisit = (url: string, attribute: string | null) => boolean;

/**
 * Visits a row's candidate tags, stopping at the first `true`
 * (allocation-free: this runs on every detection pass).
 */
type CandidateWalk = (page: ParsedPage, visit: CandidateVisit) => boolean;

/** Per row: its asset extension and its candidate walk (registry, no branching). */
const MINIFY_ROWS: Readonly<
  Record<MinifyRow, { extension: MinifiedAssetExtension; walk: CandidateWalk }>
> = {
  minify_css: { extension: 'css', walk: someStylesheet },
  minify_js: { extension: 'js', walk: someServedScript }
};

/** The rows in registry order (the guard walks them). */
export const MINIFY_FOOTPRINT_ROWS = Object.keys(MINIFY_ROWS) as readonly MinifyRow[];

/**
 * Whether an element carries WP Rocket's minify stamp, exact value only
 * (`""`, `"0"`, `"true"` are not it; `data-no-minify` is another attribute).
 *
 * @param element Any element.
 */
export function carriesMinifyAttribute(element: Element): boolean {
  return element.getAttribute(MINIFY_ATTRIBUTE) === MINIFY_ATTRIBUTE_VALUE;
}

/**
 * Classify one tag.
 *
 * @param url The tag's URL as the shipped URL arm reads it.
 * @param attributeValue The raw minify attribute, `null` when absent.
 * @param extension The row's asset extension (its minify-cache URL shape).
 * @returns `url` when the URL is a minify-cache URL, else `attribute` on the
 *   exact stamp, else `null`.
 */
export function minifyFootprint(
  url: string,
  attributeValue: string | null,
  extension: MinifiedAssetExtension
): MinifyFootprint | null {
  if (hasMinifiedCacheUrl(url, extension)) return 'url';
  return attributeValue === MINIFY_ATTRIBUTE_VALUE ? 'attribute' : null;
}

/**
 * Stylesheet links ({@link isStylesheetLink}: exact `rel`, async-swapped
 * preloads included, `<noscript>` fallbacks never), by resolved `href`. Any
 * other `<link>` never carries a minify footprint. The attribute
 * is eligible only beside a non-empty `href` (WP Rocket stamps only the link
 * it rewrote to a minified URL); the URL arm keeps its own reading.
 *
 * @param page The parsed page.
 * @param visit The per-tag test.
 */
function someStylesheet(page: ParsedPage, visit: CandidateVisit): boolean {
  return page.links.some(
    (link) =>
      isStylesheetLink(link) &&
      visit(link.href, link.getAttribute('href') ? link.getAttribute(MINIFY_ATTRIBUTE) : null)
  );
}

/**
 * Scripts naming a served URL (the falsy gate: an empty URL would resolve to
 * the document's own), by served URL — a delayed tag's `data-rocket-src`.
 *
 * @param page The parsed page.
 * @param visit The per-tag test.
 */
function someServedScript(page: ParsedPage, visit: CandidateVisit): boolean {
  return page.scripts.some(
    (script) =>
      Boolean(servedScriptSrcAttribute(script)) &&
      visit(servedScriptSrc(script), script.getAttribute(MINIFY_ATTRIBUTE))
  );
}

/**
 * Whether any of the row's tags matches the given arm.
 *
 * @param page The parsed page.
 * @param row The minify row.
 * @param arm The arm to look for (`url`: the row's own verdict; `attribute`:
 *   an attribute-only tag, the guard's input).
 */
export function hasMinifyFootprint(
  page: ParsedPage,
  row: MinifyRow,
  arm: MinifyFootprint
): boolean {
  const { extension, walk } = MINIFY_ROWS[row];
  return walk(page, (url, attribute) => minifyFootprint(url, attribute, extension) === arm);
}
