/**
 * WP Rocket's opening-tag patterns, `/<name[^>]*>/i` and
 * `/(<name\b[^>]*?>)/i`, found by search: the first `<name` (caseless,
 * ASCII) — with a word boundary after it for the `\b` form — and the first
 * `>` after it. `[^>]` cannot step over a `>`, so when that first opening
 * has none after it, no later one has either: no match. Linear, where the
 * regexes re-read the rest of the page from every `<name` without a `>`.
 */

/** A tag's span in the page. */
export interface TagSpan {
  readonly start: number;
  /** Just past its `>`. */
  readonly end: number;
}

/** Whether a code unit is a PCRE (no UTF) / JS word character. */
const WORD = /[A-Za-z0-9_]/;

/**
 * Where the first `<name` (caseless) starts, or `-1`.
 *
 * @param html The page.
 * @param name The tag name, lowercase ASCII.
 * @param wordBoundary Whether a word boundary must follow the name (`\b`).
 */
export function openingTagStart(html: string, name: string, wordBoundary: boolean): number {
  const opening = new RegExp(`<${name}`, 'gi');
  for (let found = opening.exec(html); found !== null; found = opening.exec(html)) {
    const after = found.index + found[0].length;
    if (!wordBoundary || after === html.length || !WORD.test(html.charAt(after))) {
      return found.index;
    }
  }
  return -1;
}

/**
 * The first opening tag the pattern matches, or `null`.
 *
 * @param html The page.
 * @param name The tag name, lowercase ASCII (letters only: a literal pattern).
 * @param wordBoundary `true` for `/<name\b[^>]*?>/i`, `false` for `/<name[^>]*>/i`.
 */
export function firstOpeningTag(html: string, name: string, wordBoundary: boolean): TagSpan | null {
  const start = openingTagStart(html, name, wordBoundary);
  if (start === -1) return null;
  const gt = html.indexOf('>', start + 1 + name.length);
  return gt === -1 ? null : { start, end: gt + 1 };
}
