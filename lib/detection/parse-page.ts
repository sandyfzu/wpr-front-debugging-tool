/**
 * Page preparation for the detection engine.
 *
 * Checks share the two element lists (each check reads exactly the
 * attributes it needs from them, but nobody re-queries the document); the
 * parser runs once and nothing else is precomputed — attribute reads stay
 * with the checks that use them, so classification cost matches the
 * reference read pattern minus the repeated document scans.
 */

/** Classified page content shared by every detection check. */
export interface ParsedPage {
  document: Document;
  /** All `script` elements, document order. */
  scripts: HTMLScriptElement[];
  /** All `link` elements, document order. */
  links: HTMLLinkElement[];
}

/**
 * Parse a page's HTML once and collect the element lists every check works
 * from (document order in both).
 *
 * @param html The page's HTML (e.g. the serialized live document).
 * @returns The parsed document plus the two element lists.
 * @throws {@link TypeError} when `html` is not a string — callers bundle
 *   serialized pages, so that is a broken caller, not bad page input.
 */
export function parsePage(html: string): ParsedPage {
  if (typeof html !== 'string') {
    throw new TypeError(`parsePage expects the page HTML string, received ${typeof html}`);
  }
  const document = new DOMParser().parseFromString(html, 'text/html');
  return {
    document,
    scripts: [...document.querySelectorAll('script')],
    links: [...document.querySelectorAll('link')]
  };
}
