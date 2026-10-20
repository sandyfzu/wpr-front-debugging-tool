/**
 * The string tag scanner: tokenizes a document's opening tags straight off
 * the served HTML — the engine's candidate source. No DOMParser (this runs
 * where no parser exists and must stay cheap), no entity decoding (rows
 * match the raw served text; decode/encode is the session backends' job),
 * comments and declarations skipped, raw-text element regions (`script`,
 * `style`, `textarea`, `title`) bounded by their end tags the way the HTML
 * tokenizer bounds them.
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
  /** Whether the opening tag was spelled self-closing (`/>`). */
  readonly selfClosing: boolean;
}

/** HTML whitespace, per the tokenizer's definition. */
const HTML_WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f']);

/** Elements whose content is raw text — their region runs to the end tag. */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

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
 * Skip one comment region: from the `<` of `<!--` to past the first `-->`.
 * Comments do not nest; the first close ends the region.
 *
 * @returns The offset just past `-->`, or the end of input.
 */
function skipComment(html: string, start: number): number {
  const close = html.indexOf('-->', start + 4);
  return close === -1 ? html.length : close + 3;
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
 * Find where a raw-text element's content ends: matched case-insensitively
 * against its end tag, exactly how the HTML tokenizer bounds raw text.
 *
 * @returns The offset just past the end tag's `>`, or the end of input when
 *   the end tag is missing.
 */
function rawTextEnd(tagName: string, text: string, from: number): number {
  const strict = new RegExp(`</${tagName}\\s*>`, 'gi');
  strict.lastIndex = from;
  const strictMatch = strict.exec(text);
  if (strictMatch !== null) {
    return skipToTagEnd(text, strictMatch.index);
  }
  // Tolerate a malformed end tag carrying junk before `>` (`</script x>`):
  // the first `</name` wins, the region closes at the next `>`.
  const loose = new RegExp(`</${tagName}`, 'gi');
  loose.lastIndex = from;
  const looseMatch = loose.exec(text);
  if (looseMatch !== null) {
    return skipToTagEnd(text, looseMatch.index);
  }
  return text.length;
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
  const tags: ScannedTag[] = [];
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
    if (next === '!' || next === '?' || next === '/') {
      pos = skipToTagEnd(html, lt + 2);
      continue;
    }
    if (!TAG_NAME_START.test(next)) {
      pos++;
      continue;
    }
    const parsed = parseTagAt(html, lt);
    const end = RAW_TEXT_TAGS.has(parsed.name)
      ? rawTextEnd(parsed.name, html, parsed.openingEnd)
      : parsed.openingEnd;
    tags.push({
      name: parsed.name,
      start: lt,
      openingEnd: parsed.openingEnd,
      attrs: parsed.attrs,
      end,
      selfClosing: parsed.selfClosing
    });
    pos = end;
  }
  return tags;
}
