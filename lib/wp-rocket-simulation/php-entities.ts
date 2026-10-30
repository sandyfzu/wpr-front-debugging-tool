/**
 * PHP's and WordPress's character-reference handling, as far as LazyLoad's
 * URL processing reaches it (UTF-8 site). One name table serves all three
 * readings below — measured on PHP 8.1 and WordPress 7.1's kses:
 * WordPress's `$allowedentitynames` is exactly the 253 names of
 * `libxmlEntityCodePoint` (HTML 4.01's 252 plus `apos`), and PHP's HTML5
 * table decodes each of them to the same code point except `lang` and
 * `rang` (U+27E8/U+27E9 in HTML5).
 */
import { libxmlEntityCodePoint } from '../exclusion-builder/libxml/entities';

/** The two names whose HTML5 code point differs from the table's. */
const HTML5_REDEFINED = new Set(['lang', 'rang']);

/**
 * `&name;`, `&#digits;` or `&#xhex;` at a `&` (PHP's entity shapes), sticky:
 * set `lastIndex` to the `&` before each `exec`. Groups: decimal, hex, name.
 */
export const CHARACTER_REFERENCE = /&(?:#([0-9]+)|#[xX]([0-9A-Fa-f]+)|([A-Za-z0-9]+));/y;

/**
 * Whether PHP's `html_entity_decode` (HTML5 document type) decodes a
 * numeric reference to this code point (U+000D and non-characters stay
 * literal; measured over every code point).
 *
 * @param codePoint The referenced code point.
 */
function html5NumericAllowed(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0c ||
    (codePoint >= 0x20 && codePoint <= 0x7e) ||
    (codePoint >= 0xa0 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 &&
      codePoint <= 0x10ffff &&
      (codePoint & 0xffff) < 0xfffe &&
      (codePoint < 0xfdd0 || codePoint > 0xfdef))
  );
}

/**
 * A numeric reference's digits as a code point, `Infinity` past
 * U+10FFFF (PHP's `strtol` saturates there and the reference stays).
 *
 * @param digits The digits.
 * @param radix 10 or 16.
 */
function codePointOf(digits: string, radix: number): number {
  const significant = digits.replace(/^0+/, '');
  if (significant.length > 7) return Infinity;
  return significant === '' ? 0 : Number.parseInt(significant, radix);
}

/**
 * `html_entity_decode($text, ENT_QUOTES | ENT_HTML5)` (UTF-8), or `null`
 * when the text holds a named reference outside the ported table (PHP's
 * HTML5 table has 2 231 names, `&AMP;` included): not reproducible.
 *
 * @param text The text.
 */
export function htmlEntityDecodeHtml5(text: string): string | null {
  if (!text.includes('&')) return text;
  let out = '';
  let copied = 0;
  for (let at = text.indexOf('&'); at !== -1; at = text.indexOf('&', at + 1)) {
    if (at < copied) continue;
    CHARACTER_REFERENCE.lastIndex = at;
    const found = CHARACTER_REFERENCE.exec(text);
    if (found === null) continue;
    const [whole, decimal, hex, name] = found;
    let decoded: string | undefined;
    if (name !== undefined) {
      const codePoint = libxmlEntityCodePoint(name);
      if (codePoint === undefined || HTML5_REDEFINED.has(name)) return null;
      decoded = String.fromCodePoint(codePoint);
    } else {
      const codePoint = codePointOf(decimal ?? hex ?? '', decimal === undefined ? 16 : 10);
      if (codePoint !== 0x0d && html5NumericAllowed(codePoint)) {
        decoded = String.fromCodePoint(codePoint);
      }
    }
    if (decoded === undefined) continue;
    out += text.slice(copied, at) + decoded;
    copied = at + whole.length;
  }
  return out + text.slice(copied);
}

/**
 * Whether WordPress's kses keeps `&name;` as a reference (in
 * `$allowedentitynames`; case-sensitive).
 *
 * @param name The reference name.
 */
export function isKsesEntityName(name: string): boolean {
  return libxmlEntityCodePoint(name) !== undefined;
}

/**
 * Whether PHP's `htmlspecialchars` (HTML 4.01 document type, no double
 * encoding) keeps `&name;` as a reference: the HTML 4.01 names (`apos` is
 * not one of them).
 *
 * @param name The reference name.
 */
export function isHtml401EntityName(name: string): boolean {
  return name !== 'apos' && isKsesEntityName(name);
}
