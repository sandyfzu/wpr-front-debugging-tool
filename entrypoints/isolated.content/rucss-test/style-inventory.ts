/**
 * The page-style inventory (top frame): the elements a RUCSS test strips,
 * read as they are now, in document order — bounded to
 * {@link PAGE_STYLE_LIMITS}. Read-only: nothing on the page changes, and
 * only a short preview of each inline style's CSS leaves the page.
 */
import {
  PAGE_STYLE_LIMITS,
  type PageStyleEntry,
  type PageStylesReply
} from '../../../lib/messaging/page-styles';
import { RUCSS_STRIP_SELECTOR } from '../../../lib/rucss-tester/run-plan';
import { clipToUnits } from '../../../utils/cap-text';

/** How much of an inline style's CSS the preview reads before collapsing whitespace. */
const PREVIEW_SOURCE_CHARS = PAGE_STYLE_LIMITS.previewChars * 4;

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
 * @param element A `style` or `link[rel="stylesheet"]` element.
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
 * List the page's styles now.
 *
 * @param doc The page's document.
 * @returns The bounded inventory (`total` counts every match).
 */
export function collectPageStyles(doc: Document): PageStylesReply {
  const elements = doc.querySelectorAll(RUCSS_STRIP_SELECTOR);
  const styles: PageStyleEntry[] = [];
  for (const element of elements) {
    if (styles.length === PAGE_STYLE_LIMITS.count) break;
    styles.push(describeStyle(element));
  }
  return { styles, total: elements.length };
}
