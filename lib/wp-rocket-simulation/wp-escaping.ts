/**
 * WordPress's escaping functions LazyLoad's image pass calls, ported from
 * WordPress 7.1 (`formatting.php`, `kses.php`) for a UTF-8 site with the
 * default protocol list and no filters: `esc_url` (display context),
 * `esc_attr` and `wp_strip_all_tags`. All their decisions are on ASCII
 * characters, so running over UTF-16 code units is running over the UTF-8
 * bytes (non-ASCII characters are kept as they are).
 */
import { stripTags } from '../exclusion-builder/php/strip-tags';
import { phpTrim } from '../exclusion-builder/php/trim';
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { CHARACTER_REFERENCE, isHtml401EntityName, isKsesEntityName } from './php-entities';
import { asciiCaselessAt } from './pcre-text';
import { PCRE_SPACE_CHARS } from '../exclusion-builder/pcre/byte-set';

/** `wp_allowed_protocols()` with no `kses_allowed_protocols` filter (WordPress's default list). */
export const WP_ALLOWED_PROTOCOLS: readonly string[] = [
  'http',
  'https',
  'ftp',
  'ftps',
  'mailto',
  'news',
  'irc',
  'irc6',
  'ircs',
  'gopher',
  'nntp',
  'feed',
  'telnet',
  'mms',
  'rtsp',
  'sms',
  'svn',
  'tel',
  'fax',
  'xmpp',
  'webcal',
  'urn'
];

/** Characters `esc_url` removes: all but `[a-z0-9-~+_.?#=!&;,/:%@$|*'()[\]]` (any case) and non-ASCII. */
const URL_UNSAFE = /[^A-Za-z0-9\-~+_.?#=!&;,/:%@$|*'()[\]\u0080-￿]/g;

/** PHP's `ltrim` default set, at the start. */
const PHP_LTRIM = /^[ \t\n\r\0\v]+/;

/**
 * WordPress's `_deep_replace(['%0d','%0a','%0D','%0A'], $url)`: the four
 * texts removed in order, again until none is left.
 *
 * @param url The URL.
 */
function deepStripLineBreaks(url: string): string {
  let out = url;
  for (;;) {
    const next = ['%0d', '%0a', '%0D', '%0A'].reduce(
      (text, search) => text.split(search).join(''),
      out
    );
    if (next === out) return out;
    out = next;
  }
}

/**
 * `valid_unicode((int) $code)` (kses): the code points an XML document may
 * hold.
 *
 * @param code The code point.
 */
function validUnicode(code: number): boolean {
  return (
    code === 0x9 ||
    code === 0xa ||
    code === 0xd ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  );
}

/**
 * `wp_kses_normalize_entities($content)` (HTML context): every `&`
 * disarmed to `&amp;`, then the references kses accepts re-armed —
 * decimal ones zero-padded to three digits, hexadecimal ones with a
 * lowercase `x` and no leading zeros, named ones in its allowed list.
 *
 * @param content The text.
 */
export function ksesNormalizeEntities(content: string): string {
  return content
    .split('&')
    .join('&amp;')
    .replace(/&amp;#(0*[1-9][0-9]{0,6});/g, (_whole, digits: string) =>
      validUnicode(Number.parseInt(digits, 10))
        ? `&#${digits.replace(/^0+/, '').padStart(3, '0')};`
        : `&amp;#${digits};`
    )
    .replace(/&amp;#[Xx](0*[1-9A-Fa-f][0-9A-Fa-f]{0,5});/g, (_whole, hex: string) =>
      validUnicode(Number.parseInt(hex, 16)) ? `&#x${hex.replace(/^0+/, '')};` : `&amp;#x${hex};`
    )
    .replace(/&amp;([A-Za-z]{2,8}[0-9]{0,2});/g, (_whole, name: string) =>
      isKsesEntityName(name) ? `&${name};` : `&amp;${name};`
    );
}

/** PCRE's `\s` (no UTF), every occurrence. */
const SPACES = new RegExp(`[${PCRE_SPACE_CHARS}]`, 'g');

/**
 * `wp_kses_no_null($content)`: control characters but tab, LF and CR
 * removed, then every run of backslashes followed by zeros.
 *
 * @param content The text.
 */
function ksesNoNull(content: string): string {
  return content.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/\\+0+/g, '');
}

/**
 * `wp_kses_bad_protocol_once2($scheme)`: the scheme with its numeric
 * references decoded (as single bytes: `chr`), whitespace and nulls
 * removed, lowercased — kept with its `:` when allowed, else dropped.
 * `esc_url` normalized every reference before (at most seven decimal or
 * six hexadecimal digits), so each number converts exactly.
 *
 * @param scheme The text before the first colon.
 */
function schemeOnce(scheme: string): string {
  const byte = (digits: string, radix: number): string =>
    String.fromCharCode(Number.parseInt(digits, radix) % 256);
  const decoded = scheme
    .replace(/&#([0-9]+);/g, (_whole, digits: string) => byte(digits, 10))
    .replace(/&#[Xx]([0-9A-Fa-f]+);/g, (_whole, hex: string) => byte(hex, 16));
  const normalized = asciiLowerCase(ksesNoNull(decoded.replace(SPACES, '')));
  return WP_ALLOWED_PROTOCOLS.includes(normalized) ? `${normalized}:` : '';
}

/** The first colon, or a numeric or named reference to one (kses). */
const COLON = /:|&#0*58;|&#x0*3a;|&colon;/i;

/**
 * `wp_kses_bad_protocol_once($content, …, $count)`: a disallowed scheme
 * before the first colon removed (`feed:` re-checked behind it).
 *
 * @param content The URL.
 * @param count The `feed:` nesting depth (from 1).
 */
function badProtocolOnce(content: string, count: number): string {
  const armed = content.replace(/(&#0*58(?![;0-9])|&#x0*3a(?![;a-f0-9]))/gi, '$1;');
  const colon = COLON.exec(armed);
  if (colon === null) return armed;
  const scheme = armed.slice(0, colon.index);
  if (scheme.includes('/?')) return armed;
  let rest = phpTrim(armed.slice(colon.index + colon[0].length));
  const protocol = schemeOnce(scheme);
  if (protocol === 'feed:') {
    if (count > 2) return '';
    const inner = badProtocolOnce(rest, count + 1);
    // PHP's empty(): '' and '0' end it there.
    if (inner === '' || inner === '0') return inner;
    rest = inner;
  }
  return protocol + rest;
}

/**
 * `wp_kses_bad_protocol($content, wp_allowed_protocols())`.
 *
 * @param content The URL.
 * @returns The URL with disallowed schemes removed, `''` when it keeps changing.
 */
function ksesBadProtocol(content: string): string {
  let current = ksesNoNull(content);
  if (current.startsWith('https://') || current.startsWith('http://')) return current;
  for (let iterations = 0; ;) {
    const previous = current;
    current = badProtocolOnce(current, 1);
    if (previous === current) return current;
    if (++iterations >= 6) return '';
  }
}

/**
 * `esc_url($url)` (display context, default protocols, no `clean_url`
 * filter). `null` when the URL holds `[` or `]` after cleaning (WordPress
 * then re-encodes them through `parse_url`, not ported).
 *
 * @param url The URL.
 */
export function escUrl(url: string): string | null {
  if (url === '') return '';
  let out = url.replace(PHP_LTRIM, '').split(' ').join('%20').replace(URL_UNSAFE, '');
  if (out === '') return '';
  if (!asciiCaselessAt(out, 0, 'mailto:')) out = deepStripLineBreaks(out);
  out = out.split(';//').join('://');
  if (
    !out.includes(':') &&
    out[0] !== '/' &&
    out[0] !== '#' &&
    out[0] !== '?' &&
    !/^[A-Za-z0-9-]+?\.[Pp][Hh][Pp]/.test(out)
  ) {
    out = `http://${out}`;
  }
  out = ksesNormalizeEntities(out).split('&amp;').join('&#038;').split("'").join('&#039;');
  if (out.includes('[') || out.includes(']')) return null;
  if (out[0] === '/') return out;
  const good = ksesBadProtocol(out);
  return asciiLowerCase(good) === asciiLowerCase(out) ? good : '';
}

/**
 * Whether `htmlspecialchars(…, ENT_QUOTES, 'UTF-8', false)` keeps the `&`
 * at `at` as the start of a reference: a numeric one up to U+10FFFF, or a
 * named HTML 4.01 one.
 *
 * @param text The text.
 * @param at A `&` offset.
 */
function keptReferenceAt(text: string, at: number): boolean {
  CHARACTER_REFERENCE.lastIndex = at;
  const found = CHARACTER_REFERENCE.exec(text);
  if (found === null) return false;
  const [, decimal, hex, name] = found;
  if (name !== undefined) return isHtml401EntityName(name);
  const digits = (decimal ?? hex ?? '').replace(/^0+/, '');
  return (
    digits.length <= 7 &&
    Number.parseInt(digits || '0', decimal === undefined ? 16 : 10) <= 0x10ffff
  );
}

/** `htmlspecialchars`' replacements (ENT_QUOTES), `&` aside. */
const SPECIAL: Readonly<Record<string, string>> = {
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
};

/**
 * `esc_attr($text)` on valid UTF-8: unchanged without `&<>"'`; else kses's
 * entity normalization, then `htmlspecialchars` with quotes and without
 * double encoding.
 *
 * @param text The text.
 */
export function escAttr(text: string): string {
  if (!/[&<>"']/.test(text)) return text;
  const normalized = ksesNormalizeEntities(text);
  return normalized.replace(/[&<>"']/g, (char: string, at: number) =>
    char === '&' ? (keptReferenceAt(normalized, at) ? '&' : '&amp;') : (SPECIAL[char] as string)
  );
}

/**
 * The `<script>`/`<style>` elements `wp_strip_all_tags` removes before
 * `strip_tags`: `@<(script|style)[^>]*?>.*?</\1>@si` (the end tag's name
 * matched caseless, no whitespace before its `>`).
 *
 * @param text The text.
 */
function stripScriptAndStyle(text: string): string {
  const lower = asciiLowerCase(text);
  let out = '';
  let copied = 0;
  for (let at = text.indexOf('<'); at !== -1; at = text.indexOf('<', at + 1)) {
    if (at < copied) continue;
    const name = asciiCaselessAt(text, at + 1, 'script')
      ? 'script'
      : asciiCaselessAt(text, at + 1, 'style')
        ? 'style'
        : null;
    if (name === null) continue;
    const gt = text.indexOf('>', at + 1 + name.length);
    if (gt === -1) continue;
    const close = lower.indexOf(`</${name}>`, gt + 1);
    if (close === -1) continue;
    out += text.slice(copied, at);
    copied = close + name.length + 3;
  }
  return out + text.slice(copied);
}

/**
 * `wp_strip_all_tags($text)`: script and style elements removed, then
 * `strip_tags`, then `trim`.
 *
 * @param text The text.
 */
export function wpStripAllTags(text: string): string {
  return phpTrim(stripTags(stripScriptAndStyle(text)));
}
