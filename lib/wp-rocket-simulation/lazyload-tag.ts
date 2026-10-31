/**
 * The tag-level rewrites of WP Rocket's LazyLoad image pass (PCRE without
 * UTF: `\s` = PCRE's ASCII set, `i` folds ASCII letters only), each
 * reproduced as a direct scan — these regexes read one tag, and the
 * caller bounds a tag's length before any of them runs:
 *
 * - an image's `src`/`width`/`height` values, its placeholder `src`, its
 *   native `loading` attribute, the `srcset`/`sizes` renames, a removed
 *   `loading="lazy"`, a source's `srcset` rename;
 * - a background candidate's real `style`/`class` attribute (the first
 *   one outside another attribute's quoted value), its `background-image`
 *   declaration, the lazy class added.
 */
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { phpTrim } from '../exclusion-builder/php/trim';
import { asciiCaselessAt, isSpaceAt, skipSpaces } from './pcre-text';

/**
 * The offset right before the next caseless occurrence of `word` starting
 * after `from` (where a regex's leading character sits), or -1 — scanners
 * jump between occurrences instead of testing every offset.
 *
 * @param lower The subject, ASCII-lowercased.
 * @param word The lowercase word.
 * @param from The offset after which the word must start.
 */
function nextLead(lower: string, word: string, from: number): number {
  const at = lower.indexOf(word, from + 1);
  return at === -1 ? -1 : at - 1;
}

/** Whether `text[index]` is `"` or `'`. */
function isQuoteAt(text: string, index: number): boolean {
  return text[index] === '"' || text[index] === "'";
}

/**
 * WP Rocket's `isExcluded`: whether any non-empty row other than `"0"`
 * (PHP's `array_filter`) occurs in the text (case-sensitive).
 *
 * @param text The text tested.
 * @param rows The rows.
 */
export function isExcludedBy(text: string, rows: readonly string[]): boolean {
  return rows.some((row) => row !== '' && row !== '0' && text.includes(row));
}

/** Where a quoted attribute's `name\s*=\s*` + quote starts and its value lies. */
interface QuotedValue {
  /** The leading character's offset (the match start). */
  readonly start: number;
  /** The value's bounds, inside the quotes. */
  readonly valueStart: number;
  readonly valueEnd: number;
}

/**
 * The first match of `@LEAD NAME \s*=\s* (['"]) (.*) \1@iUs` — `LEAD`
 * being `\s` (or `[\s"']` with `quoteLeads`): the leftmost start whose
 * value's quote closes; the value runs to the first same quote (lazy).
 *
 * @param text The subject (an image's `atts`).
 * @param name The attribute name, lowercase.
 * @param quoteLeads Whether a quote may lead too.
 */
export function firstQuotedValue(
  text: string,
  name: string,
  quoteLeads: boolean
): QuotedValue | null {
  const lower = name.length;
  const lowered = asciiLowerCase(text);
  for (let at = nextLead(lowered, name, -1); at !== -1; at = nextLead(lowered, name, at + 1)) {
    if (!(isSpaceAt(text, at) || (quoteLeads && isQuoteAt(text, at)))) continue;
    if (!asciiCaselessAt(text, at + 1, name)) continue;
    const equals = skipSpaces(text, at + 1 + lower);
    if (text[equals] !== '=') continue;
    const quoteAt = skipSpaces(text, equals + 1);
    if (!isQuoteAt(text, quoteAt)) continue;
    const close = text.indexOf(text[quoteAt] as string, quoteAt + 1);
    if (close === -1) continue;
    return { start: at, valueStart: quoteAt + 1, valueEnd: close };
  }
  return null;
}

/**
 * `canLazyload`'s source: the `src` value (trimmed), or `null` when there
 * is none or it is empty.
 *
 * @param atts The image's `atts`.
 */
export function imageSource(atts: string): string | null {
  const found = firstQuotedValue(atts, 'src', false);
  if (found === null) return null;
  const src = phpTrim(atts.slice(found.valueStart, found.valueEnd));
  return src === '' ? null : src;
}

/**
 * Every `@\ssrc\s*=\s*(['"])([^\s"'>]+)\1@iUs` match replaced by
 * ` src="placeholder"` (a value holding no whitespace, quote or `>`).
 *
 * @param atts The image's `atts`.
 * @param placeholder The placeholder URL.
 */
export function withPlaceholderSource(atts: string, placeholder: string): string {
  let out = '';
  let copied = 0;
  const lower = asciiLowerCase(atts);
  for (let at = nextLead(lower, 'src', -1); at !== -1; at = nextLead(lower, 'src', at + 1)) {
    if (!isSpaceAt(atts, at) || !asciiCaselessAt(atts, at + 1, 'src')) continue;
    const equals = skipSpaces(atts, at + 4);
    if (atts[equals] !== '=') continue;
    const quoteAt = skipSpaces(atts, equals + 1);
    if (!isQuoteAt(atts, quoteAt)) continue;
    let end = quoteAt + 1;
    while (end < atts.length && !isSpaceAt(atts, end) && !isQuoteAt(atts, end) && atts[end] !== '>')
      end++;
    if (end === quoteAt + 1 || atts[end] !== atts[quoteAt]) continue;
    out += `${atts.slice(copied, at)} src="${placeholder}"`;
    copied = end + 1;
    at = end;
  }
  return out + atts.slice(copied);
}

/**
 * Every `@\sloading\s*=\s*(['"])(?:lazy|auto)\1@i` match, as `[start, end)`.
 *
 * @param text The tag.
 */
function nativeLoadingMatches(text: string): [number, number][] {
  const found: [number, number][] = [];
  const lower = asciiLowerCase(text);
  for (
    let at = nextLead(lower, 'loading', -1);
    at !== -1;
    at = nextLead(lower, 'loading', at + 1)
  ) {
    if (!isSpaceAt(text, at) || !asciiCaselessAt(text, at + 1, 'loading')) continue;
    const equals = skipSpaces(text, at + 8);
    if (text[equals] !== '=') continue;
    const quoteAt = skipSpaces(text, equals + 1);
    if (!isQuoteAt(text, quoteAt)) continue;
    const word = quoteAt + 1;
    if (!asciiCaselessAt(text, word, 'lazy') && !asciiCaselessAt(text, word, 'auto')) continue;
    if (text[word + 4] !== text[quoteAt]) continue;
    found.push([at, word + 5]);
    at = word + 4;
  }
  return found;
}

/**
 * The tag without its native `loading="lazy|auto"` attributes (with the
 * whitespace before each).
 *
 * @param text The tag.
 */
export function withoutNativeLoading(text: string): string {
  let out = '';
  let copied = 0;
  for (const [start, end] of nativeLoadingMatches(text)) {
    out += text.slice(copied, start);
    copied = end;
  }
  return out + text.slice(copied);
}

/**
 * Every `/loading=["']lazy["']/i` removed (quotes need not pair).
 *
 * @param text The text.
 */
export function withoutLazyLoading(text: string): string {
  let out = '';
  let copied = 0;
  const lower = asciiLowerCase(text);
  for (let at = lower.indexOf('loading='); at !== -1; at = lower.indexOf('loading=', at + 1)) {
    if (
      asciiCaselessAt(text, at, 'loading=') &&
      isQuoteAt(text, at + 8) &&
      asciiCaselessAt(text, at + 9, 'lazy') &&
      isQuoteAt(text, at + 13)
    ) {
      out += text.slice(copied, at);
      copied = at + 14;
      at += 13;
    }
  }
  return out + text.slice(copied);
}

/**
 * `/[\s|"'](NAME)\s*=\s*("|')([^"|']+)\2/i` replaced by
 * ` data-lazy-NAME=QvalueQ` (the name as written, the lead character
 * dropped): a `srcset`/`sizes` value holding no quote or `|`.
 *
 * @param text The tag.
 * @param name `srcset` or `sizes`.
 */
function lazyResponsive(text: string, name: string): string {
  let out = '';
  let copied = 0;
  const lower = asciiLowerCase(text);
  for (let at = nextLead(lower, name, -1); at !== -1; at = nextLead(lower, name, at + 1)) {
    if (!(isSpaceAt(text, at) || isQuoteAt(text, at) || text[at] === '|')) continue;
    if (!asciiCaselessAt(text, at + 1, name)) continue;
    const equals = skipSpaces(text, at + 1 + name.length);
    if (text[equals] !== '=') continue;
    const quoteAt = skipSpaces(text, equals + 1);
    if (!isQuoteAt(text, quoteAt)) continue;
    let end = quoteAt + 1;
    while (end < text.length && !isQuoteAt(text, end) && text[end] !== '|') end++;
    if (end === quoteAt + 1 || text[end] !== text[quoteAt]) continue;
    const quote = text[quoteAt] as string;
    out += `${text.slice(copied, at)} data-lazy-${text.slice(at + 1, at + 1 + name.length)}=${quote}${text.slice(quoteAt + 1, end)}${quote}`;
    copied = end + 1;
    at = end;
  }
  return out + text.slice(copied);
}

/**
 * The `rocket_lazyload_html` filter WP Rocket hooks (non-native mode):
 * `srcset`, then `sizes`, moved to their `data-lazy-` carriers.
 *
 * @param tag The lazy image tag.
 */
export function withLazyResponsiveAttributes(tag: string): string {
  return lazyResponsive(lazyResponsive(tag, 'srcset'), 'sizes');
}

/**
 * A picture source with every `/([\s"'])srcset/i` renamed `data-lazy-srcset`.
 *
 * @param source The `<source …>` tag.
 */
export function withLazySourceSrcset(source: string): string {
  let out = '';
  let copied = 0;
  const lower = asciiLowerCase(source);
  for (let at = nextLead(lower, 'srcset', -1); at !== -1; at = nextLead(lower, 'srcset', at + 1)) {
    if (!(isSpaceAt(source, at) || isQuoteAt(source, at))) continue;
    if (!asciiCaselessAt(source, at + 1, 'srcset')) continue;
    out += `${source.slice(copied, at + 1)}data-lazy-srcset`;
    copied = at + 7;
    at += 6;
  }
  return out + source.slice(copied);
}

/** How every LazyLoad placeholder opens, up to its dimensions (its served footprint). */
export const LAZY_PLACEHOLDER_PREFIX =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20";

/**
 * LazyLoad's placeholder: an empty SVG with the image's dimensions.
 *
 * @param width The width (`absint`).
 * @param height The height (`absint`).
 */
export function lazyPlaceholder(width: number, height: number): string {
  return `${LAZY_PLACEHOLDER_PREFIX}${String(width)}%20${String(height)}'%3E%3C/svg%3E`;
}

/** A real attribute on a tag: its text and its (still quoted) value. */
export interface RealAttribute {
  readonly attribute: string;
  readonly value: string;
}

/**
 * WP Rocket's `findRealAttribute`: the first match of
 * `#(?<=\s)NAME\s*=\s*(?<value>"[^"]*+"|'[^']*+'|[^\s>]++)#is` (matches
 * found left to right without overlap) that does not start inside a quoted
 * stretch — quotes counted from the tag start, a quote opening a stretch
 * that only the same quote closes.
 *
 * @param tag The tag.
 * @param name The attribute name, lowercase.
 */
export function findRealAttribute(tag: string, name: string): RealAttribute | null {
  let quote: string | null = null;
  let walked = 0;
  const lower = asciiLowerCase(tag);
  for (let at = lower.indexOf(name, 1); at !== -1; at = lower.indexOf(name, at + 1)) {
    if (!isSpaceAt(tag, at - 1) || !asciiCaselessAt(tag, at, name)) continue;
    const equals = skipSpaces(tag, at + name.length);
    if (tag[equals] !== '=') continue;
    const valueStart = skipSpaces(tag, equals + 1);
    let valueEnd = -1;
    if (isQuoteAt(tag, valueStart)) {
      const close = tag.indexOf(tag[valueStart] as string, valueStart + 1);
      if (close !== -1) valueEnd = close + 1;
    }
    if (valueEnd === -1) {
      valueEnd = valueStart;
      while (valueEnd < tag.length && !isSpaceAt(tag, valueEnd) && tag[valueEnd] !== '>')
        valueEnd++;
      if (valueEnd === valueStart) continue;
    }
    for (; walked < at; walked++) {
      const char = tag[walked];
      if (quote === null) {
        if (char === '"' || char === "'") quote = char;
      } else if (char === quote) quote = null;
    }
    if (quote === null) {
      return { attribute: tag.slice(at, valueEnd), value: tag.slice(valueStart, valueEnd) };
    }
    at = valueEnd - 1;
  }
  return null;
}

/** A `background-image` declaration found in a style value. */
export interface BackgroundUrl {
  /** The whole match, trailing whitespace and `;` included (`$url[0]`). */
  readonly declaration: string;
  /** Between `url(` and the first `)` (`$url['url']`). */
  readonly url: string;
}

/**
 * The first match of
 * `#background-image\s*:\s*(?<attr>\s*url\s*\((?<url>[^)]+)\))\s*;?#is`.
 *
 * @param styles The style value without its quotes.
 */
export function backgroundUrl(styles: string): BackgroundUrl | null {
  const property = 'background-image';
  const lower = asciiLowerCase(styles);
  for (let at = lower.indexOf(property); at !== -1; at = lower.indexOf(property, at + 1)) {
    if (!asciiCaselessAt(styles, at, property)) continue;
    const colon = skipSpaces(styles, at + property.length);
    if (styles[colon] !== ':') continue;
    const fn = skipSpaces(styles, colon + 1);
    if (!asciiCaselessAt(styles, fn, 'url')) continue;
    const open = skipSpaces(styles, fn + 3);
    if (styles[open] !== '(') continue;
    const close = styles.indexOf(')', open + 1);
    if (close === -1 || close === open + 1) continue;
    let end = skipSpaces(styles, close + 1);
    if (styles[end] === ';') end++;
    return { declaration: styles.slice(at, end), url: styles.slice(open + 1, close) };
  }
  return null;
}

/**
 * WP Rocket's `stripOuterQuoteChars`: a matching pair of outer quotes
 * removed, nothing else.
 *
 * @param value The attribute value.
 */
export function withoutOuterQuotes(value: string): string {
  const first = value[0];
  return value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)
    ? value.slice(1, -1)
    : value;
}

/** The tag names the class-less rewrite recognizes, in its alternation's order. */
const CLASSLESS_TAGS = ['img', 'div', 'figure', 'section', 'aside', 'li', 'span', 'a'] as const;

/**
 * `preg_replace('#<(img|div|figure|section|aside|li|span|a)([^>]*)>#is',
 * '<\1 class="rocket-lazyload"\2>', $element)`: every such tag (no word
 * boundary — `<link` reads as `li`) gets the class right after its name.
 *
 * @param element The element text.
 */
function withClassAfterEveryName(element: string): string {
  let out = '';
  let copied = 0;
  for (let at = element.indexOf('<'); at !== -1; at = element.indexOf('<', at + 1)) {
    if (at < copied) continue;
    const name = CLASSLESS_TAGS.find((tag) => asciiCaselessAt(element, at + 1, tag));
    if (name === undefined) continue;
    const nameEnd = at + 1 + name.length;
    const gt = element.indexOf('>', nameEnd);
    if (gt === -1) continue;
    out += `${element.slice(copied, nameEnd)} class="rocket-lazyload"${element.slice(nameEnd, gt + 1)}`;
    copied = gt + 1;
  }
  return out + element.slice(copied);
}

/** PHP's `empty()` on a string. */
function phpEmpty(text: string): boolean {
  return text === '' || text === '0';
}

/** PHP's `ltrim`/`rtrim` of every leading/trailing `char`. */
function trimChar(text: string, char: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === char) start++;
  while (end > start && text[end - 1] === char) end--;
  return text.slice(start, end);
}

/**
 * WP Rocket's `addLazyClass`: `rocket-lazyload` added to the element's
 * real class attribute (classes split on spaces, trimmed, empty and `0`
 * ones dropped, its quote kept), or that attribute replaced when it holds
 * no class, or a class attribute added when it has none.
 *
 * @param element The element's opening tag.
 */
export function withLazyClass(element: string): string {
  const found = findRealAttribute(element, 'class');
  if (found === null) return withClassAfterEveryName(element);
  const replaceWith = (text: string): string => element.split(found.attribute).join(text);
  if (phpEmpty(found.value)) return replaceWith('class="rocket-lazyload"');
  const trimmed = phpTrim(found.value);
  // A value PHP's trim empties has no first character: not quoted.
  const quote = trimmed[0] === '"' || trimmed[0] === "'" ? trimmed[0] : null;
  const classes = quote === null ? trimmed : phpTrim(trimChar(trimmed, quote));
  if (phpEmpty(classes)) return replaceWith('class="rocket-lazyload"');
  const normalized = `${classes} rocket-lazyload`
    .split(' ')
    .map(phpTrim)
    .filter((name) => !phpEmpty(name))
    .join(' ');
  const wrap = quote ?? '"';
  return replaceWith(`class=${wrap}${normalized}${wrap}`);
}
