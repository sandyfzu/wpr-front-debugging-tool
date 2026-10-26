/**
 * The string tag scanner: tokenizes a document's opening tags straight off
 * the served HTML — the engine's candidate source. No DOMParser (this runs
 * where no parser exists and must stay cheap), no entity decoding (rows
 * match the raw served text; decode/encode is the session backends' job),
 * comments and declarations skipped per the tokenizer's comment states,
 * raw-text element regions (`script`, `style`, `textarea`, `title`) closed
 * only by their exact case-insensitive end tag (WHATWG §13.2.5.14) —
 * running to EOF when no end tag exists. A caller that must see the markup
 * exactly as a browser does (scripting on) asks for the `browser` model,
 * which adds every other raw-text element (see {@link RawTextModel}).
 *
 * One linear pass; every span is an offset into the string scanned, so
 * rewrites stay patch-based and inputs are never mutated. The same parser
 * serves whole documents (`scanTags`) and single tag texts (the tag editor
 * re-parsing after each edit).
 */

/** One parsed attribute; spans are offsets into the string that was parsed. */
export interface ScannedAttribute {
  /** Lowercased attribute name. */
  readonly name: string;
  /** Raw value text, or `null` when the attribute has no `=value` part. */
  readonly value: string | null;
  /** Span of the whole attribute (name through closing quote). */
  readonly attrStart: number;
  readonly attrEnd: number;
  /** Span of the inner value (between the quotes), when the value exists. */
  readonly valueStart: number | null;
  readonly valueEnd: number | null;
  /** The quote style: `"`, `'`, or `''` for an unquoted value. */
  readonly quote: '"' | "'" | '';
}

/** One opening tag; spans are offsets into the string that was scanned. */
export interface ScannedTag {
  /** Lowercased tag name. */
  readonly name: string;
  /** Offset of the `<`. */
  readonly start: number;
  /** Offset just past the opening tag's `>`. */
  readonly openingEnd: number;
  /** The opening tag's attributes, in document order. */
  readonly attrs: readonly ScannedAttribute[];
  /**
   * Offset past the raw-text end tag for `script`/`style`/`textarea`/`title`
   * (or past the end of input when the end tag is missing); equals
   * `openingEnd` for every other tag. The whole element region is
   * `[start, end)`.
   */
  readonly end: number;
  /**
   * Offset where a raw-text element's content ends — the end tag's `<`, or
   * the end of input when the end tag is missing; equals `openingEnd` for
   * every other tag (their content is not raw text). The content text is
   * `[openingEnd, contentEnd)`.
   */
  readonly contentEnd: number;
  /** Whether the opening tag was spelled self-closing (`/>`). */
  readonly selfClosing: boolean;
}

/** HTML whitespace, per the tokenizer's definition. */
const HTML_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

/**
 * Which raw-text elements a scan honors. `engine` — the four the transforms
 * have always read WP Rocket's markup with (their behavior, and the WP Rocket
 * parity table, are pinned to it). `browser` — every element whose content
 * a browser's parser reads as text with scripting on (the WHATWG tree
 * construction's "in head" / "in body" rules: also `xmp`, `iframe`,
 * `noembed`, `noframes`, `noscript`, and `plaintext`, which never ends): for edits that must land where the
 * browser will parse markup, never inside text.
 */
export type RawTextModel = 'engine' | 'browser';

/** The `engine` model's raw-text elements. */
const ENGINE_RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

/** Elements whose content is raw text per model — their region runs to the end tag. */
const RAW_TEXT_TAGS: Readonly<Record<RawTextModel, ReadonlySet<string>>> = {
  engine: ENGINE_RAW_TEXT_TAGS,
  browser: new Set([
    ...ENGINE_RAW_TEXT_TAGS,
    'xmp',
    'iframe',
    'noembed',
    'noframes',
    'noscript',
    'plaintext'
  ])
};

/** The raw-text element no end tag closes: its text runs to the end of input. */
const UNCLOSABLE_RAW_TEXT_TAG = 'plaintext';

/**
 * End-tag matchers for the raw-text elements, one compiled per tag name and
 * hoisted to module scope (never per call). A region closes only on its
 * exact case-insensitive name followed by whitespace, `/` or `>` —
 * WHATWG §13.2.5.14's appropriate-end-tag check, so `</scripty>` stays
 * script text while `</script x>` (an end tag with junk attributes) closes.
 */
const RAW_TEXT_END_TAG = new Map(
  [...RAW_TEXT_TAGS.browser]
    .filter((name) => name !== UNCLOSABLE_RAW_TEXT_TAG)
    .map((name) => [name, new RegExp(`</${name}[\\t\\n\\f\\r />]`, 'gi')])
);

/** The standard HTML void elements — serialized without an end tag. */
export const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

/** A tag opens only when an ASCII letter follows the `<`. */
const TAG_NAME_START = /[a-zA-Z]/;

/**
 * Whether the character at `index` is HTML whitespace.
 *
 * @param text The string scanned.
 * @param index The offset to test (out of range → `false`).
 */
function isWhitespaceAt(text: string, index: number): boolean {
  const char = text[index];
  return char !== undefined && HTML_WHITESPACE.has(char);
}

/**
 * Skip one comment region: from the `<` of `<!--` to past its closer, per
 * the tokenizer's comment states. `-->` ends the comment; `--!>` ends it
 * the same way (an incorrectly closed comment); the empty-comment spellings
 * `<!-->` and `<!--->` close immediately. Anything after the closer is
 * markup again; an unclosed comment runs to the end of input.
 *
 * @returns The offset just past the closer, or the end of input.
 */
function skipComment(html: string, start: number): number {
  if (html.startsWith('<!-->', start)) return start + 5;
  if (html.startsWith('<!--->', start)) return start + 6;
  // The first of the two closers wins — they cannot overlap into ambiguity.
  const close = html.indexOf('-->', start + 4);
  const bang = html.indexOf('--!>', start + 4);
  if (close === -1) return bang === -1 ? html.length : bang + 4;
  if (bang === -1) return close + 3;
  return Math.min(close + 3, bang + 4);
}

/**
 * Skip to past the next `>` — declarations (`<!DOCTYPE …>`), processing
 * instructions and closing tags all end at the first one.
 *
 * @returns The offset just past `>`, or the end of input.
 */
function skipToTagEnd(text: string, from: number): number {
  const gt = text.indexOf('>', from);
  return gt === -1 ? text.length : gt + 1;
}

/** One tag parsed out of a string that starts at its `<`. */
export interface ParsedTag {
  readonly name: string;
  readonly attrs: readonly ScannedAttribute[];
  /** Offset just past the opening tag's `>` (or the end of input). */
  readonly openingEnd: number;
  readonly selfClosing: boolean;
}

/**
 * Parse the tag whose text starts at `start` (the `<`) — the shared reader
 * for whole documents and single tag texts: the tag editor re-parses a
 * tag's own text after each edit, so sequential edits never fight over
 * spans. Mirrors the HTML tokenizer's
 * attribute states — quoted values may contain anything but their own quote
 * (an unclosed quote consumes the rest of the input, as the tokenizer
 * does); unquoted values end at whitespace or `>` and, per the spec, keep a
 * `/` as part of the value; a `/` immediately before `>` marks the tag
 * self-closing; malformed soup (`=x`, stray `/`) is consumed without ever
 * stalling the loop.
 *
 * @param text The string scanned (a whole document or one tag's text).
 * @param start Offset of the `<`.
 */
export function parseTagAt(text: string, start: number): ParsedTag {
  const length = text.length;
  // Tag name: the run of non-whitespace, non-`/`, non-`>` characters.
  let pos = start + 1;
  while (pos < length && !isWhitespaceAt(text, pos) && text[pos] !== '/' && text[pos] !== '>') {
    pos++;
  }
  const name = text.slice(start + 1, pos).toLowerCase();
  const attrs: ScannedAttribute[] = [];
  const selfClosing = false;
  // Attributes: parse one per iteration; every branch advances `pos`.
  for (;;) {
    while (pos < length && isWhitespaceAt(text, pos)) pos++;
    if (pos >= length) return { name, attrs, openingEnd: length, selfClosing };
    const char = text[pos];
    if (char === '>') return { name, attrs, openingEnd: pos + 1, selfClosing };
    if (char === '/') {
      // Self-closing only when the slash sits right before `>`; a stray
      // slash elsewhere is a parse error — consume it and move on.
      if (text[pos + 1] === '>') return { name, attrs, openingEnd: pos + 2, selfClosing: true };
      pos++;
      continue;
    }
    // Attribute name: until whitespace, `/`, `>` or `=`; an immediate `=`
    // (malformed, e.g. `<div =x>`) is consumed into the name so the loop
    // always advances — no stall guard is needed below.
    const nameStart = pos;
    while (
      pos < length &&
      !isWhitespaceAt(text, pos) &&
      text[pos] !== '/' &&
      text[pos] !== '>' &&
      (text[pos] !== '=' || pos === nameStart)
    ) {
      pos++;
    }
    const attrName = text.slice(nameStart, pos).toLowerCase();
    // Optional `=value`.
    let valuePos = pos;
    while (valuePos < length && isWhitespaceAt(text, valuePos)) valuePos++;
    if (text[valuePos] !== '=') {
      attrs.push({
        name: attrName,
        value: null,
        attrStart: nameStart,
        attrEnd: pos,
        valueStart: null,
        valueEnd: null,
        quote: ''
      });
      continue;
    }
    valuePos++;
    while (valuePos < length && isWhitespaceAt(text, valuePos)) valuePos++;
    const quote = text[valuePos];
    if (quote === '"' || quote === "'") {
      const valueStart = valuePos + 1;
      const close = text.indexOf(quote, valueStart);
      if (close === -1) {
        // Unclosed quote: the value consumes the rest of the input.
        attrs.push({
          name: attrName,
          value: text.slice(valueStart),
          attrStart: nameStart,
          attrEnd: length,
          valueStart,
          valueEnd: length,
          quote
        });
        return { name, attrs, openingEnd: length, selfClosing };
      }
      attrs.push({
        name: attrName,
        value: text.slice(valueStart, close),
        attrStart: nameStart,
        attrEnd: close + 1,
        valueStart,
        valueEnd: close,
        quote
      });
      pos = close + 1;
    } else {
      // Unquoted: until whitespace or `>` — a `/` is part of the value.
      const valueStart = valuePos;
      while (valuePos < length && !isWhitespaceAt(text, valuePos) && text[valuePos] !== '>')
        valuePos++;
      attrs.push({
        name: attrName,
        value: text.slice(valueStart, valuePos),
        attrStart: nameStart,
        attrEnd: valuePos,
        valueStart,
        valueEnd: valuePos,
        quote: ''
      });
      pos = valuePos;
    }
  }
}

/**
 * Find where a raw-text element's content and region end: the region closes
 * only when the exact case-insensitive tag name's end tag starts here and
 * is followed by whitespace, `/` or `>` (WHATWG §13.2.5.14) — the element's
 * text then runs through that end tag's `>`; when no such end tag exists,
 * everything to the end of input is element text.
 *
 * @param tagName The raw-text element's (lowercased) name.
 * @param text The string scanned.
 * @param from Offset just past the opening tag.
 * @returns `contentEnd`: the end tag's `<` (or the end of input), and
 *   `end`: just past the end tag's `>` (or the end of input).
 */
function rawTextEnd(
  tagName: string,
  text: string,
  from: number
): { readonly contentEnd: number; readonly end: number } {
  const pattern = RAW_TEXT_END_TAG.get(tagName);
  if (pattern === undefined) return { contentEnd: text.length, end: text.length };
  pattern.lastIndex = from;
  const match = pattern.exec(text);
  if (match === null) return { contentEnd: text.length, end: text.length };
  return { contentEnd: match.index, end: skipToTagEnd(text, match.index) };
}

/** One closing tag (`</name …>`); spans are offsets into the string scanned. */
export interface ScannedEndTag {
  /** Lowercased tag name. */
  readonly name: string;
  /** Offset of the `<`. */
  readonly start: number;
  /** Offset just past the `>` (or the end of input). */
  readonly end: number;
}

/** One markup token: an opening tag, or a closing tag (`kind: 'end'`). */
export type ScannedToken = ScannedTag | (ScannedEndTag & { readonly kind: 'end' });

/**
 * Whether a token is a closing tag.
 *
 * @param token A token from {@link scanTokens}.
 */
export function isEndTag(token: ScannedToken): token is ScannedEndTag & { readonly kind: 'end' } {
  return 'kind' in token;
}

/**
 * Parse the closing tag whose `</` starts at `lt`: its name runs from the
 * letter after `</` to whitespace, `/` or `>`; the tag ends at the next `>`.
 *
 * @param html The string scanned.
 * @param lt Offset of the `<`.
 */
function parseEndTagAt(html: string, lt: number): ScannedEndTag {
  let pos = lt + 2;
  while (pos < html.length && !isWhitespaceAt(html, pos) && html[pos] !== '/' && html[pos] !== '>')
    pos++;
  return { name: html.slice(lt + 2, pos).toLowerCase(), start: lt, end: skipToTagEnd(html, pos) };
}

/**
 * Scan a document's opening tags in one linear pass — the engine's only
 * look at the markup. Comments, doctypes, processing instructions and
 * closing tags produce no tokens; a `<` that opens no tag is text.
 *
 * @param html The served HTML (already decoded by the caller — this
 *   function never decodes or re-encodes anything).
 * @returns Every opening tag in document order.
 */
export function scanTags(html: string): readonly ScannedTag[] {
  return scanMarkup(html, false, 'engine') as readonly ScannedTag[];
}

/**
 * {@link scanTags} plus the closing tags, in document order — for callers
 * that rebuild the element tree. A closing tag counts only when a letter
 * follows its `</` (anything else is a bogus comment, as in the tokenizer);
 * raw-text elements' own end tags stay inside their region and emit none.
 *
 * @param html The served HTML (decoded text).
 * @param model Which raw-text elements to honor (default `engine`).
 * @returns Every opening and closing tag in document order.
 */
export function scanTokens(html: string, model: RawTextModel = 'engine'): readonly ScannedToken[] {
  return scanMarkup(html, true, model);
}

/**
 * The shared scan loop of {@link scanTags} and {@link scanTokens}.
 *
 * @param html The string scanned.
 * @param withEndTags Whether closing tags become tokens.
 * @param model Which raw-text elements to honor.
 */
function scanMarkup(
  html: string,
  withEndTags: boolean,
  model: RawTextModel
): readonly ScannedToken[] {
  const rawTextTags = RAW_TEXT_TAGS[model];
  const tags: ScannedToken[] = [];
  const length = html.length;
  let pos = 0;
  while (pos < length) {
    const lt = html.indexOf('<', pos);
    if (lt === -1) break;
    pos = lt;
    const next = html.charAt(lt + 1);
    if (html.startsWith('<!--', lt)) {
      pos = skipComment(html, lt);
      continue;
    }
    if (withEndTags && next === '/' && TAG_NAME_START.test(html.charAt(lt + 2))) {
      const endTag = parseEndTagAt(html, lt);
      tags.push({ kind: 'end', ...endTag });
      pos = endTag.end;
      continue;
    }
    if (next === '!' || next === '?' || next === '/') {
      pos = skipToTagEnd(html, lt + 2);
      continue;
    }
    if (!TAG_NAME_START.test(next)) {
      pos++;
      continue;
    }
    const parsed = parseTagAt(html, lt);
    const rawText = rawTextTags.has(parsed.name)
      ? rawTextEnd(parsed.name, html, parsed.openingEnd)
      : null;
    tags.push({
      name: parsed.name,
      start: lt,
      openingEnd: parsed.openingEnd,
      attrs: parsed.attrs,
      end: rawText?.end ?? parsed.openingEnd,
      contentEnd: rawText?.contentEnd ?? parsed.openingEnd,
      selfClosing: parsed.selfClosing
    });
    pos = rawText?.end ?? parsed.openingEnd;
  }
  return tags;
}
