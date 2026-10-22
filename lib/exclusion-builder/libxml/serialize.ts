/**
 * A pure re-serializer of one opening tag the way libxml 2.9's HTML parser
 * + `saveHTML` (PHP `DOMDocument`) round-trips it, cut at its first `>` —
 * the text WP Rocket's lazy-render pass matches rows against. Measured
 * against the real library (PHP 8.1 / libxml 2.9.13):
 *
 * - start tag: attribute names `[A-Za-z_:][-A-Za-z0-9_:.]*`, lowercased; a
 *   name may be followed by `=` and a value (quoted, or unquoted up to a
 *   blank or `>`); anything else is a bogus attribute, skipped up to the next
 *   blank, `>` or `/>` regardless of quotes (`@click="a b"` leaves `b`); the
 *   first `>` outside a value or `/>` ends the tag;
 * - one space between attributes; the first of duplicates kept; a
 *   value-less attribute bare; the 13 HTML 4 boolean attributes always bare;
 * - values: numeric references (`;` optional) and the 253 libxml names (`;`
 *   required) decoded; then `<`, `>`, `&` re-encoded, except a `<!--…-->`
 *   span and an `&{…}` span copied raw; double quotes, unless the value holds
 *   `"` (single quotes) or both quote kinds (`"` with `&quot;`);
 *   `href`/`src`/`action` (and `name` on `<a>`) URI-escaped after leading
 *   blanks are dropped.
 *
 * Fails closed: anything the measurements do not pin — control characters,
 * invalid references, a Latin-1 `&name` running into a non-ASCII byte,
 * characters the page's text mode cannot rebuild, text libxml would leave
 * outside the tag holding markup — returns `null`, never a guess.
 */
import { libxmlEntityCodePoint } from './entities';
import { libxmlCharacters, type LibxmlTextMode } from './charset';

/** HTML 4 boolean attributes libxml always serializes bare. */
const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'checked',
  'compact',
  'declare',
  'defer',
  'disabled',
  'ismap',
  'multiple',
  'nohref',
  'noresize',
  'noshade',
  'nowrap',
  'readonly',
  'selected'
]);

/** Attributes libxml URI-escapes (plus `name` on `<a>`). */
const URI_ATTRIBUTES: ReadonlySet<string> = new Set(['href', 'src', 'action']);

/** Tag names this module serializes (followed by a blank, `/` or `>`). */
const TAG_NAME = /^<([A-Za-z][A-Za-z0-9]*)(?=[ \t\n\r/>])/;

/** An attribute name at a given offset. */
const ATTRIBUTE_NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;

/** libxml's blanks (no form feed). */
const BLANK = /[ \t\n\r]/;

/** A numeric character reference at a given offset (`;` optional). */
const NUMERIC_REFERENCE = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/y;

/** A named character reference at a given offset (`;` required). */
const NAMED_REFERENCE = /&([A-Za-z0-9]+);/y;

/**
 * On a Latin-1 page, an `&` whose name runs into a non-ASCII byte: libxml
 * drops part of that name — not modelled.
 */
const LATIN1_NAME_INTO_BYTE = /&[A-Za-z0-9]*[\u0080-￿]/;

/** URI characters libxml leaves unescaped: unreserved marks + its own list. */
const URI_KEPT = /[A-Za-z0-9\-_.!~*'()@/:=?;#%&,+<>]/;

/** One attribute as libxml's start-tag parser reads it. */
interface LibxmlAttribute {
  /** Lowercased name. */
  readonly name: string;
  /** Raw value text (references not decoded), or `null` without `=`. */
  readonly value: string | null;
}

/** One start tag as libxml's parser reads it. */
interface LibxmlStartTag {
  readonly name: string;
  readonly attributes: readonly LibxmlAttribute[];
  /** Offset just past the `>` that ends it. */
  readonly end: number;
}

/**
 * Whether the text holds a control character libxml removes or truncates a
 * value at (tab, LF and CR are kept).
 *
 * @param text Tag text.
 */
function hasUnsupportedControl(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 && code !== 0x9 && code !== 0xa && code !== 0xd) return true;
  }
  return false;
}

/**
 * Whether libxml accepts a code point as a document character (XML `Char`).
 *
 * @param codePoint The decoded reference.
 */
function isXmlChar(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

/**
 * The offset of the first non-blank character at or after `from`.
 *
 * @param text Tag text.
 * @param from Start offset.
 */
function skipBlanks(text: string, from: number): number {
  let at = from;
  while (at < text.length && BLANK.test(text.charAt(at))) at++;
  return at;
}

/**
 * Read one attribute value starting at `at` (just past `=` and blanks):
 * quoted up to its closing quote, else unquoted up to a blank or `>`.
 *
 * @returns The raw value and the offset past it, or `null` for an unclosed quote.
 */
function readValue(text: string, at: number): { value: string; next: number } | null {
  const quote = text.charAt(at);
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, at + 1);
    return close === -1 ? null : { value: text.slice(at + 1, close), next: close + 1 };
  }
  let next = at;
  while (next < text.length && !BLANK.test(text.charAt(next)) && text.charAt(next) !== '>') next++;
  return { value: text.slice(at, next), next };
}

/**
 * Parse a start tag as libxml's HTML parser does.
 *
 * @param text The tag's characters as libxml reads them.
 * @returns The tag, or `null` when it does not end (no closing `>`) or its
 *   name is not one this module serializes.
 */
function parseLibxmlStartTag(text: string): LibxmlStartTag | null {
  const name = TAG_NAME.exec(text)?.[1]?.toLowerCase();
  if (name === undefined) return null;
  const attributes: LibxmlAttribute[] = [];
  let at = 1 + name.length;
  for (;;) {
    at = skipBlanks(text, at);
    if (at >= text.length) return null;
    if (text.charAt(at) === '>') return { name, attributes, end: at + 1 };
    if (text.startsWith('/>', at)) return { name, attributes, end: at + 2 };
    ATTRIBUTE_NAME.lastIndex = at;
    const attributeName = ATTRIBUTE_NAME.exec(text)?.[0];
    if (attributeName === undefined) {
      // A bogus attribute: skipped up to a blank, `>` or `/>`, quotes ignored.
      while (at < text.length && !BLANK.test(text.charAt(at)) && text.charAt(at) !== '>') {
        if (text.startsWith('/>', at)) break;
        at++;
      }
      continue;
    }
    at += attributeName.length;
    const afterName = skipBlanks(text, at);
    if (text.charAt(afterName) !== '=') {
      attributes.push({ name: attributeName.toLowerCase(), value: null });
      continue;
    }
    const read = readValue(text, skipBlanks(text, afterName + 1));
    if (read === null) return null;
    attributes.push({ name: attributeName.toLowerCase(), value: read.value });
    at = read.next;
  }
}

/**
 * Decode an attribute value's character references as libxml does.
 *
 * @param raw The raw value text.
 * @returns The decoded value, or `null` for a reference libxml rejects.
 */
function decodeValue(raw: string): string | null {
  let out = '';
  let index = 0;
  for (;;) {
    const amp = raw.indexOf('&', index);
    if (amp === -1) return out + raw.slice(index);
    out += raw.slice(index, amp);
    if (raw[amp + 1] === '#') {
      NUMERIC_REFERENCE.lastIndex = amp;
      const numeric = NUMERIC_REFERENCE.exec(raw);
      const codePoint =
        numeric === null
          ? NaN
          : numeric[1] === undefined
            ? Number.parseInt(numeric[2] ?? '', 10)
            : Number.parseInt(numeric[1], 16);
      // libxml empties or truncates the value here — not modelled.
      if (numeric === null || !isXmlChar(codePoint)) return null;
      out += String.fromCodePoint(codePoint);
      index = amp + numeric[0].length;
      continue;
    }
    NAMED_REFERENCE.lastIndex = amp;
    const named = NAMED_REFERENCE.exec(raw);
    const codePoint = named === null ? undefined : libxmlEntityCodePoint(named[1] ?? '');
    if (named !== null && codePoint !== undefined) {
      out += String.fromCodePoint(codePoint);
      index = amp + named[0].length;
      continue;
    }
    // Not a reference libxml knows: the `&` is text.
    out += '&';
    index = amp + 1;
  }
}

/**
 * The end of a span libxml's encoder copies raw from `index`: `<!--` through
 * the next `-->`, or `&{` through the next `}` — `null` when no such span
 * starts there (or it never closes, so the character is encoded).
 *
 * @param value The decoded value.
 * @param index The offset to test.
 */
function rawSpanEnd(value: string, index: number): number | null {
  if (value.startsWith('<!--', index)) {
    const close = value.indexOf('-->', index);
    return close === -1 ? null : close + 3;
  }
  if (value.startsWith('&{', index)) {
    const close = value.indexOf('}', index);
    return close === -1 ? null : close + 1;
  }
  return null;
}

/**
 * Re-encode a decoded value as libxml's HTML attribute encoder does: `<`,
 * `>`, `&` become references, except a `<!--` span through the next `-->`
 * and an `&{` span through the next `}` (server-side-include syntax), which
 * are copied raw.
 *
 * @param value The decoded value.
 */
function encodeValue(value: string): string {
  let out = '';
  let index = 0;
  while (index < value.length) {
    const char = value.charAt(index);
    const rawEnd = rawSpanEnd(value, index);
    if (rawEnd !== null) {
      out += value.slice(index, rawEnd);
      index = rawEnd;
      continue;
    }
    out += char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '&' ? '&amp;' : char;
    index++;
  }
  return out;
}

/**
 * libxml's URI escaping of an encoded value: leading blanks dropped, every
 * other byte outside its kept set written `%XX` (UTF-8 bytes, uppercase hex).
 *
 * @param value The encoded value.
 */
function escapeUri(value: string): string {
  let out = '';
  for (const char of value.replace(/^[ \t\n\r]+/, '')) {
    if (URI_KEPT.test(char)) {
      out += char;
      continue;
    }
    for (const byte of new TextEncoder().encode(char)) {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

/**
 * Quote a value: double quotes, unless it holds `"` — then single quotes,
 * or (holding both quote kinds) double quotes with `"` as `&quot;`.
 *
 * @param value The encoded value.
 */
function quoteValue(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/"/g, '&quot;')}"`;
}

/**
 * One serialized attribute (leading space included).
 *
 * @param attribute The attribute as parsed.
 * @param tagName The element's name.
 * @returns The text, or `null` when its value cannot be reproduced.
 */
function serializeAttribute(attribute: LibxmlAttribute, tagName: string): string | null {
  if (attribute.value === null || BOOLEAN_ATTRIBUTES.has(attribute.name)) {
    return ` ${attribute.name}`;
  }
  const decoded = decodeValue(attribute.value);
  if (decoded === null) return null;
  const encoded = encodeValue(decoded);
  const isUri =
    URI_ATTRIBUTES.has(attribute.name) || (attribute.name === 'name' && tagName === 'a');
  return ` ${attribute.name}=${quoteValue(isUri ? escapeUri(encoded) : encoded)}`;
}

/**
 * One opening tag as libxml re-serializes it, cut at its first `>` as WP
 * Rocket cuts it (a raw `<!--…-->` value ends the cut early).
 *
 * @param tagText The opening tag's source text (`<` through `>`).
 * @param mode How the page's bytes reach libxml (`./charset`).
 * @returns The serialized opening tag, or `null` when it cannot be
 *   reproduced with certainty.
 */
export function libxmlOpeningTag(tagText: string, mode: LibxmlTextMode): string | null {
  if (hasUnsupportedControl(tagText)) return null;
  const text = libxmlCharacters(tagText, mode);
  if (text === null) return null;
  if (mode.startsWith('latin-1') && LATIN1_NAME_INTO_BYTE.test(text)) return null;
  const tag = parseLibxmlStartTag(text);
  // Text past libxml's tag end is element content there: harmless unless it holds markup.
  if (tag === null || text.slice(tag.end).includes('<')) return null;
  let out = `<${tag.name}`;
  const seen = new Set<string>();
  for (const attribute of tag.attributes) {
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    const serialized = serializeAttribute(attribute, tag.name);
    if (serialized === null) return null;
    out += serialized;
  }
  return `${out.split('>')[0] ?? out}>`;
}
