/**
 * The capture's raw-text repair. The hub snapshots the live document with
 * `XMLSerializer`, whose XML text serialization escapes `&`, `<` and `>` in
 * every text node (nothing else: a no-break space or a quote stays as is),
 * and the pass re-parses that string as `text/html`, where the text of raw
 * text elements (`script`, `style`, …) is never decoded. Left alone, every
 * inline script and style in the parsed snapshot would read `a &gt; b`
 * instead of the page's `a > b`. Attribute values and ordinary text round
 * trip already (the HTML parser decodes them), as does SVG/MathML content
 * (foreign content decodes its text), so only HTML-namespace raw-text
 * elements are restored.
 */

/** The HTML namespace (a `style` inside `<svg>` is not a raw-text element). */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** The elements whose text the HTML parser keeps raw (WHATWG "raw text" + obsolete ones). */
const RAW_TEXT_SELECTOR = 'script,style,xmp,iframe,noembed,noframes,plaintext';

/** The three escapes XML text serialization writes. */
const XML_TEXT_ESCAPE = /&(?:amp|lt|gt);/g;

/** Each escape's character. */
const UNESCAPED: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

/**
 * Undo XML text escaping in one left-to-right pass — exact, because the
 * serializer escaped every `&` first (`&amp;lt;` is the page's `&lt;`).
 *
 * @param text Text read from the re-parsed snapshot.
 * @returns The page's own text (the same string when it holds no `&`).
 */
export function unescapeXmlText(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(XML_TEXT_ESCAPE, (escape) => UNESCAPED[escape] ?? escape);
}

/**
 * Restore the text of every HTML raw-text element of a document parsed from
 * an `XMLSerializer` snapshot, in place. Only elements whose text changes
 * are rewritten; elements keep their identity (lists collected beforehand
 * stay valid).
 *
 * @param document The parsed snapshot (inert: a `DOMParser` document).
 * @returns How many elements were rewritten.
 */
export function restoreRawText(document: Document): number {
  let restored = 0;
  for (const element of document.querySelectorAll(RAW_TEXT_SELECTOR)) {
    if (element.namespaceURI !== HTML_NAMESPACE) continue;
    const text = element.textContent;
    const original = unescapeXmlText(text);
    if (original === text) continue;
    element.textContent = original;
    restored += 1;
  }
  return restored;
}
