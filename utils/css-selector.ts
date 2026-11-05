/**
 * Whether a CSS selector (list) parses, by the browser's own selector
 * parser: matching it against an empty fragment throws a `SyntaxError` for
 * an invalid selector and touches nothing in the page.
 *
 * @param doc The document whose parser judges (the page's, or a test DOM).
 * @param selector The selector text.
 * @returns `true` when `querySelector` accepts it.
 */
export function isValidSelector(doc: Document, selector: string): boolean {
  try {
    doc.createDocumentFragment().querySelector(selector);
    return true;
  } catch {
    // The parser's verdict: the only thing `querySelector` on an empty fragment throws for.
    return false;
  }
}
