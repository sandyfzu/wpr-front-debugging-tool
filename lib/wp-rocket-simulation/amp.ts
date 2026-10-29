/**
 * AMP documents: WP Rocket never delays scripts on an AMP endpoint, so
 * simulating Delay JS there is the identity. An AMP document declares
 * itself on its root `<html>` element — the one declaring site of those
 * attributes, read on served text here and on the live document by the
 * overlay.
 */
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';

/** The root-element attributes that make a document AMP (`<html amp>`, `<html ⚡>`). */
export const AMP_HTML_ATTRIBUTES: readonly string[] = ['amp', '⚡'];

/**
 * Whether a served document is AMP: its first `<html>` opening tag carries
 * one of {@link AMP_HTML_ATTRIBUTES} (any value).
 *
 * @param html The served document.
 * @param tags Its opening tags, when already scanned (`scanTags(html)`).
 */
export function isAmpDocument(html: string, tags?: readonly ScannedTag[]): boolean {
  if (!/<html/i.test(html)) return false;
  const root = (tags ?? scanTags(html)).find((tag) => tag.name === 'html');
  return root?.attrs.some((attr) => AMP_HTML_ATTRIBUTES.includes(attr.name)) ?? false;
}
