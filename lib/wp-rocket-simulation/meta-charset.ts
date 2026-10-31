/**
 * WP Rocket's `<meta charset>` move (`DelayJS\HTML::move_meta_charset_to_head`),
 * run after it injects the Delay JS scripts at the top of `<head>`: the
 * first charset declaration before the last `</head>` is moved right after
 * the `<head …>` opening tag (else after `<html …>`, else before the first
 * tag), and every other declaration its pattern matches is removed.
 *
 * Its pattern is textual and runs on bytes (no UTF option), so it is read
 * here over the page's byte view. The matches come from a scanner
 * (`./meta-charset-scan`) that reproduces the pattern's backtracking
 * order in linear time; whether PCRE's backtrack limit could stop the
 * pattern first is the caller's check (`./meta-charset-cost`).
 */
import { expandPhpReplacement } from './php-replacement';
import { metaCharsetByteSpans } from './meta-charset-scan';
import { firstOpeningTag, openingTagStart, type TagSpan } from './opening-tag';
import { byteView, unitOffsetsOfBytes, UTF8_MEASURE, type ByteMeasure } from './utf8';

/** The lookahead's target, `</head>` (caseless). */
const HEAD_CLOSE = /<\/head>/gi;

/** `/(<\w+)/`: the first tag-like text. */
const FIRST_TAG = /(<\w+)/;

/**
 * PHP's `empty()` on a string: `''` and `'0'`.
 *
 * @param text The string.
 */
export function phpEmpty(text: string): boolean {
  return text === '' || text === '0';
}

/**
 * Where the last `</head>` starts (`-1` when none): the pattern's
 * lookahead `(?=.*</head>)` holds for a match ending at or before it.
 *
 * @param html The page.
 */
export function lastHeadClose(html: string): number {
  let last = -1;
  HEAD_CLOSE.lastIndex = 0;
  for (let found = HEAD_CLOSE.exec(html); found !== null; found = HEAD_CLOSE.exec(html)) {
    last = found.index;
  }
  return last;
}

/**
 * Every declaration the pattern matches, left to right, as code-unit spans.
 * Only text before the last `</head>` can match (the lookahead), so only
 * that text is read.
 *
 * @param html The page.
 * @param measure The served encoding's byte measure.
 * @returns `[start, end)` per match.
 */
export function metaCharsetSpans(
  html: string,
  measure: ByteMeasure = UTF8_MEASURE
): [number, number][] {
  if (!/charset/i.test(html)) return [];
  const limit = lastHeadClose(html);
  if (limit === -1) return [];
  const byteSpans = metaCharsetByteSpans(byteView(html.slice(0, limit), measure));
  const units = unitOffsetsOfBytes(html, byteSpans.flat(), measure);
  const spans: [number, number][] = [];
  for (let index = 0; index < units.length; index += 2) {
    spans.push([units[index] ?? 0, units[index + 1] ?? 0]);
  }
  return spans;
}

/**
 * Insert `text` after a tag (`preg_replace('/(<tag\b[^>]*?>)/i', "\${1}" . text, …, 1)`):
 * the inserted text is read as replacement syntax.
 *
 * @param html The page.
 * @param tag The tag's span (`null`: no match, the page is unchanged).
 * @param text The text interpolated into the replacement.
 */
function insertAfter(html: string, tag: TagSpan | null, text: string): string {
  if (tag === null) return html;
  const opening = html.slice(tag.start, tag.end);
  const written = expandPhpReplacement(`\${1}${text}`, [opening, opening]);
  return html.slice(0, tag.start) + written + html.slice(tag.end);
}

/**
 * WP Rocket's `move_meta_charset_to_head` on a page.
 *
 * @param html The page (after the Delay JS scripts were injected).
 * @param measure The served encoding's byte measure.
 * @returns The page with the first declaration moved and the others removed,
 *   or as given when the pattern matches nothing.
 */
export function moveMetaCharsetToHead(html: string, measure: ByteMeasure = UTF8_MEASURE): string {
  const spans = metaCharsetSpans(html, measure);
  const [first] = spans;
  if (first === undefined) return html;
  const declaration = html.slice(first[0], first[1]);
  let removed = '';
  let at = 0;
  for (const [start, end] of spans) {
    removed += html.slice(at, start);
    at = end;
  }
  removed += html.slice(at);
  if (phpEmpty(removed)) return html;
  let moved: string;
  if (openingTagStart(removed, 'head', true) !== -1) {
    moved = insertAfter(removed, firstOpeningTag(removed, 'head', true), declaration);
  } else if (openingTagStart(removed, 'html', true) !== -1) {
    moved = insertAfter(removed, firstOpeningTag(removed, 'html', true), declaration);
  } else {
    const found = FIRST_TAG.exec(removed);
    moved =
      found === null
        ? removed
        : removed.slice(0, found.index) +
          expandPhpReplacement(`${declaration}\${1}`, [found[0], found[1] ?? '']) +
          removed.slice(found.index + found[0].length);
  }
  return phpEmpty(moved) ? html : moved;
}
