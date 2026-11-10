/**
 * The page-style inventories (top frame), read as the page is now, in
 * document order — bounded to {@link PAGE_STYLE_LIMITS}. One collector, two
 * lists declared side by side so they cannot drift apart:
 * - the RUCSS test's: exactly the elements a test strips;
 * - the Stylesheets page's: every inline style and every link the detection
 *   counts as a stylesheet (async-swapped preloads included), each with the
 *   WP Rocket stamps its tag carries.
 *
 * Read-only: nothing on the page changes, and only a short preview of each
 * inline style's CSS leaves the page.
 */
import { carriesMinifyAttribute } from '../../../lib/detection/minify-footprint';
import {
  carriesAsyncCssAttribute,
  isStylesheetLink
} from '../../../lib/detection/stylesheet-links';
import {
  PAGE_STYLE_LIMITS,
  type PageStyleEntry,
  type PageStylesReply
} from '../../../lib/messaging/page-styles';
import type {
  PageStylesheetEntry,
  PageStylesheetsReply
} from '../../../lib/messaging/page-stylesheets';
import { RUCSS_STRIP_SELECTOR } from '../../../lib/rucss-tester/run-plan';
import { SELF_HOSTED_FONTS_ATTRIBUTE } from '../../../lib/wp-rocket/constants';
import { clipToUnits } from '../../../utils/cap-text';

/** How much of an inline style's CSS the preview reads before collapsing whitespace. */
const PREVIEW_SOURCE_CHARS = PAGE_STYLE_LIMITS.previewChars * 4;

/** Which elements one list reads: a selector, then a per-element keep rule. */
interface StyleListRule {
  readonly selector: string;
  readonly keeps: (element: Element) => boolean;
}

/** The RUCSS test's list: exactly the elements a test strips. */
const STRIPPED_STYLES: StyleListRule = { selector: RUCSS_STRIP_SELECTOR, keeps: () => true };

/**
 * The Stylesheets page's list: every `style`, and the links the detection
 * reads as stylesheets ({@link isStylesheetLink}: exact `rel`, stamped
 * async preloads, never a `<noscript>` fallback) — the same reading the
 * Minify CSS and Load CSS asynchronously rows use.
 */
const PAGE_STYLESHEETS: StyleListRule = {
  selector: 'style,link',
  keeps: (element) => element.localName !== 'link' || isStylesheetLink(element)
};

/**
 * The start of a style's CSS, whitespace collapsed and clipped — read from
 * a bounded prefix, so a multi-megabyte sheet costs no full scan.
 *
 * @param css The style's CSS.
 * @returns The preview.
 */
export function cssPreview(css: string): string {
  const head = css.slice(0, PREVIEW_SOURCE_CHARS).replace(/\s+/g, ' ').trim();
  return clipToUnits(head, PAGE_STYLE_LIMITS.previewChars);
}

/**
 * Describe one style element.
 *
 * @param element A `style` or `link` element.
 * @returns Its entry.
 */
export function describeStyle(element: Element): PageStyleEntry {
  const isLink = element.localName === 'link';
  const href: unknown = isLink ? (element as Partial<HTMLLinkElement>).href : '';
  const css = isLink ? '' : element.textContent;
  return {
    kind: isLink ? 'link' : 'inline',
    id: clipToUnits(element.id, PAGE_STYLE_LIMITS.idChars),
    className: clipToUnits(element.getAttribute('class') ?? '', PAGE_STYLE_LIMITS.classChars),
    href: clipToUnits(typeof href === 'string' ? href : '', PAGE_STYLE_LIMITS.hrefChars),
    media: clipToUnits(element.getAttribute('media') ?? '', PAGE_STYLE_LIMITS.mediaChars),
    preview: cssPreview(css),
    chars: css.length
  };
}

/**
 * Describe one style element with its WP Rocket tag facts. Only links carry
 * them (WP Rocket stamps the links it rewrote); the minify stamp counts only
 * beside a non-empty `href`, as the detection reads it — an empty one would
 * resolve to the page's own address.
 *
 * @param element A `style` or a stylesheet `link` element.
 * @returns Its entry.
 */
export function describeStylesheet(element: Element): PageStylesheetEntry {
  const entry = describeStyle(element);
  if (entry.kind !== 'link') {
    return { ...entry, minifyAttribute: false, rocketAsync: false, hostedFont: false };
  }
  return {
    ...entry,
    minifyAttribute: Boolean(element.getAttribute('href')) && carriesMinifyAttribute(element),
    rocketAsync: carriesAsyncCssAttribute(element),
    hostedFont: element.hasAttribute(SELF_HOSTED_FONTS_ATTRIBUTE)
  };
}

/**
 * Read one list: every kept element counts, the first
 * `PAGE_STYLE_LIMITS.count` are described.
 *
 * @param doc The page's document.
 * @param rule The list's elements.
 * @param describe Builds one entry.
 * @returns The bounded list and the full count.
 */
function collectStyleList<Entry>(
  doc: Document,
  rule: StyleListRule,
  describe: (element: Element) => Entry
): { styles: Entry[]; total: number } {
  const styles: Entry[] = [];
  let total = 0;
  for (const element of doc.querySelectorAll(rule.selector)) {
    if (!rule.keeps(element)) continue;
    total += 1;
    if (styles.length < PAGE_STYLE_LIMITS.count) styles.push(describe(element));
  }
  return { styles, total };
}

/**
 * List the styles a RUCSS test strips, now.
 *
 * @param doc The page's document.
 * @returns The bounded inventory (`total` counts every match).
 */
export function collectPageStyles(doc: Document): PageStylesReply {
  return collectStyleList(doc, STRIPPED_STYLES, describeStyle);
}

/**
 * List the page's stylesheets with their WP Rocket stamps, now.
 *
 * @param doc The page's document.
 * @returns The bounded inventory (`total` counts every match).
 */
export function collectPageStylesheets(doc: Document): PageStylesheetsReply {
  return collectStyleList(doc, PAGE_STYLESHEETS, describeStylesheet);
}
