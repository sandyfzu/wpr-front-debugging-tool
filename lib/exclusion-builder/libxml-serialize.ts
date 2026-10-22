/**
 * A pure re-serializer of one opening tag the way libxml 2.9's HTML parser
 * + `saveHTML` (PHP `DOMDocument`) round-trips it — the text WP Rocket's
 * lazy-render pass matches rows against. Measured against the real library
 * (PHP 8.1 / libxml 2.9.13): tag and attribute names lowercased; one space
 * between attributes, a self-closing `/` dropped; the first of duplicate
 * attributes kept; a value-less attribute bare, `a=` → `a=""`; the 13 HTML 4
 * boolean attributes always bare; values entity-decoded (numeric references,
 * `;` optional, and the 253 libxml names, `;` required), then `&`/`<`/`>`
 * re-encoded; double quotes, except a value holding `"` but no `'` (single
 * quotes) and one holding both (`"` with `&quot;`); `href`/`src`/`action`
 * (and `name` on `<a>`) URI-escaped after leading blanks are dropped.
 *
 * Fails closed: anything the measurements do not pin — control characters,
 * names libxml drops, invalid references, `&{`, stray markup between
 * attributes, a non-ASCII tag on a page with an unknown charset — returns
 * `null` (the serialization is unknown), never a guess.
 */
import { libxmlEntityCodePoint } from './libxml-entities';
import { parseTagAt, type ScannedTag } from './html-scan';
import { findAttribute } from './tag-edit';

/**
 * How libxml decoded the page's bytes: UTF-8 (a UTF-8 `<meta>` charset seen
 * before any non-ASCII byte), Latin-1 (no charset declared, or non-ASCII
 * bytes before the declaration — every UTF-8 byte becomes one character), or
 * a declared charset this module does not model.
 */
export type LibxmlCharset = 'utf-8' | 'latin-1' | 'unknown';

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

/** Attribute names libxml keeps as written (lowercased); it drops or truncates others. */
const ATTRIBUTE_NAME = /^[a-z_:][-a-z0-9_:.]*$/;

/** Tag names this module serializes. */
const TAG_NAME = /^[a-z][a-z0-9]*$/;

/** Any character outside ASCII (one UTF-16 code unit at a time). */
const NON_ASCII = /[\u0080-\uffff]/;

/** The blanks libxml separates attributes with (form feed excluded above). */
const BLANKS = /^[ \t\n\r]*$/;

/** What may precede the closing `>`: blanks and one optional self-closing `/`. */
const TAG_TAIL = /^[ \t\n\r]*\/?$/;

/** A numeric character reference at a given offset (`;` optional). */
const NUMERIC_REFERENCE = /&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/y;

/** A named character reference at a given offset (`;` required). */
const NAMED_REFERENCE = /&([A-Za-z0-9]+);/y;

/** URI characters libxml leaves unescaped: unreserved marks + its own list. */
const URI_KEPT = /[A-Za-z0-9\-_.!~*'()@/:=?;#%&,+<>]/;

/** A UTF-8 charset label from a `<meta>`'s `content` attribute. */
const CONTENT_CHARSET = /charset\s*=\s*["']?([^\s;"']+)/i;

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
 * The text libxml reads from UTF-8 bytes decoded as Latin-1: every byte of
 * each non-ASCII character becomes its own character (`é` → `Ã©`).
 *
 * @param text Decoded page text.
 */
export function utf8AsLatin1(text: string): string {
  if (!NON_ASCII.test(text)) return text;
  let out = '';
  for (const byte of new TextEncoder().encode(text)) out += String.fromCharCode(byte);
  return out;
}

/**
 * The charset label one `<meta>` declares, or `null`: its `charset`
 * attribute, or `http-equiv="Content-Type"` with a `charset=` in `content`.
 *
 * @param tagText The meta tag's text.
 */
function metaCharsetLabel(tagText: string): string | null {
  const tag = parseTagAt(tagText, 0);
  const charset = findAttribute(tag, 'charset')?.value;
  if (charset !== undefined && charset !== null) return charset.trim().toLowerCase();
  const httpEquiv = findAttribute(tag, 'http-equiv')?.value?.trim().toLowerCase();
  if (httpEquiv !== 'content-type') return null;
  const content = findAttribute(tag, 'content')?.value ?? '';
  return CONTENT_CHARSET.exec(content)?.[1]?.toLowerCase() ?? null;
}

/**
 * How libxml decodes a page (measured): the first `<meta>` declaring a
 * charset decides, unless a non-ASCII character comes before it (libxml
 * then stays on Latin-1); no declaration means Latin-1; a leading BOM means
 * UTF-8.
 *
 * @param html The page text.
 * @param tags The page's opening tags (`scanTags` / `scanTokens` output).
 */
export function libxmlDocumentCharset(html: string, tags: readonly ScannedTag[]): LibxmlCharset {
  if (html.startsWith('﻿')) return 'utf-8';
  for (const tag of tags) {
    if (tag.name !== 'meta') continue;
    const label = metaCharsetLabel(html.slice(tag.start, tag.openingEnd));
    if (label === null) continue;
    if (NON_ASCII.test(html.slice(0, tag.start))) return 'latin-1';
    return label === 'utf-8' || label === 'utf8' ? 'utf-8' : 'unknown';
  }
  return 'latin-1';
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
 * Re-encode a decoded value: `&`, `<`, `>` become references.
 *
 * @param value The decoded value.
 * @returns The encoded value, or `null` for `&{` (libxml keeps some `&{…}`
 *   spans raw — not modelled).
 */
function encodeValue(value: string): string | null {
  if (value.includes('&{')) return null;
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
 * One opening tag as libxml re-serializes it (no end tag — WP Rocket cuts
 * the serialized element at its first `>`).
 *
 * @param tagText The opening tag's source text (`<` through `>`).
 * @param charset How the page's bytes were decoded ({@link libxmlDocumentCharset}).
 * @returns The serialized opening tag, or `null` when it cannot be
 *   reproduced with certainty.
 */
export function libxmlOpeningTag(tagText: string, charset: LibxmlCharset): string | null {
  if (!tagText.endsWith('>') || hasUnsupportedControl(tagText)) return null;
  if (charset === 'unknown' && NON_ASCII.test(tagText)) return null;
  const text = charset === 'latin-1' ? utf8AsLatin1(tagText) : tagText;
  const tag = parseTagAt(text, 0);
  if (tag.openingEnd !== text.length || !TAG_NAME.test(tag.name)) return null;
  let out = `<${tag.name}`;
  let cursor = 1 + tag.name.length;
  const seen = new Set<string>();
  for (const attribute of tag.attrs) {
    if (!BLANKS.test(text.slice(cursor, attribute.attrStart))) return null;
    cursor = attribute.attrEnd;
    if (!ATTRIBUTE_NAME.test(attribute.name)) return null;
    if (seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    out += ` ${attribute.name}`;
    if (attribute.value === null || BOOLEAN_ATTRIBUTES.has(attribute.name)) continue;
    const decoded = decodeValue(attribute.value);
    const encoded = decoded === null ? null : encodeValue(decoded);
    if (encoded === null) return null;
    const isUri =
      URI_ATTRIBUTES.has(attribute.name) || (attribute.name === 'name' && tag.name === 'a');
    out += `=${quoteValue(isUri ? escapeUri(encoded) : encoded)}`;
  }
  // The tail must hold the real `>` — an unclosed quote swallows it.
  if (cursor >= text.length || !TAG_TAIL.test(text.slice(cursor, -1))) return null;
  return `${out}>`;
}
