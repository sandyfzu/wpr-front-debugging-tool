/**
 * WP Rocket's three Defer JS regexes, reproduced as linear scanners over
 * the page (PCRE without UTF: `\s` = PCRE's ASCII set, `i` folds ASCII
 * letters only), each attempt paired with an upper estimate of the steps
 * PCRE's JIT counts for it:
 *
 * - comments: `/<!--(.*)-->/Uis`, stripped before both passes;
 * - script URLs: `#<script\s+(?:[^>]+[\s'"])?src\s*=\s*['"]\s*?(?<url>[^'"]+)\s*?['"](?:[^>]+)?\/?>#i`;
 * - inline scripts: `#<script(?:[^>]*)>(?<content>[\s\S]*?)</script>#msi`.
 *
 * An attempt whose estimate passes {@link UNREPRODUCED_STEP_CEILING} stops
 * the scan (`beyond`): PCRE's backtrack limit could stop WP Rocket's call
 * there, which is not reproduced. Estimates were fitted on the plugin
 * (`pcre.backtrack_limit` bisected under `php -n -d pcre.jit=1`) and stay
 * at or above its count.
 */
import { asciiCaselessAt, isSpaceAt, skipSpaces } from './pcre-text';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';
import { byteLength, rangeByteCounter, type ByteMeasure } from './utf8';
import type { UnreproducedRegex } from './spec';
import { cachedForwardSearch, nextOccurrenceFinder } from '../../utils/next-occurrence';

/** A scan stopped where PCRE's backtrack limit could stop WP Rocket's regex. */
export interface BeyondScan {
  readonly beyond: UnreproducedRegex;
}

/** Steps an attempt costs besides the bytes it reads (measured: 1–21). */
const ATTEMPT_OVERHEAD = 32;

/** The comment opener and closer of the comment pattern. */
const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * The page without its comments, as `preg_replace('/<!--(.*)-->/Uis', '', …)`
 * leaves it: each `<!--` up to the first `-->` after it (lazy, across lines)
 * is removed, left to right; an opener with no closer after it removes
 * nothing (nor can any later one). A match costs one step per byte between
 * the markers; the failing attempt of an unclosed opener one step per byte
 * up to the page end (both measured exact on long pages: PCRE's
 * required-`>` shortcut only spares short ones). The costliest attempt
 * decides the estimate.
 *
 * @param html The page.
 * @param measure The served encoding's byte measure.
 * @returns The stripped text, or where PCRE could stop.
 */
export function stripDeferComments(html: string, measure: ByteMeasure): string | BeyondScan {
  let out = '';
  let from = 0;
  for (;;) {
    const open = html.indexOf(COMMENT_OPEN, from);
    if (open === -1) break;
    const close = html.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    // Unclosed: the attempt reads to the page end, then the scan stops.
    const end = close === -1 ? html.length : close;
    const steps = byteLength(html, open + COMMENT_OPEN.length, end, measure) + ATTEMPT_OVERHEAD;
    if (steps > UNREPRODUCED_STEP_CEILING) return { beyond: 'html-comments' };
    if (close === -1) break;
    out += html.slice(from, open);
    from = close + COMMENT_CLOSE.length;
  }
  return out + html.slice(from);
}

/** One script tag the URL regex matched. */
export interface DeferSrcMatch {
  /** The whole match (`$tag[0]`). */
  readonly text: string;
  /** The captured URL (`$tag['url']`). */
  readonly url: string;
}

/** Where a URL candidate's tail leads: its match, and how far it read. */
interface Tail {
  /** The match end and URL bounds when the tail matches. */
  readonly match: {
    readonly end: number;
    readonly urlStart: number;
    readonly urlEnd: number;
  } | null;
  /** The furthest offset the tail reads (estimate input). */
  readonly reads: number;
}

/**
 * The deterministic tail of the URL regex from a `src` at `at`:
 * `src\s*=\s*['"]`, the URL up to the next quote of either kind (at least
 * one byte, whitespace kept), then everything to the next `>`. No
 * backtracking can change it: each part is forced by the next character.
 */
function tailAt(
  text: string,
  at: number,
  nextQuote: (from: number) => number,
  nextGt: (from: number) => number
): Tail {
  let index = skipSpaces(text, at + 3);
  if (text.charCodeAt(index) !== 0x3d /* = */) return { match: null, reads: index };
  index = skipSpaces(text, index + 1);
  const quote = text.charCodeAt(index);
  if (quote !== 0x22 && quote !== 0x27) return { match: null, reads: index };
  const urlEnd = nextQuote(index + 1);
  if (urlEnd === -1) return { match: null, reads: text.length };
  if (urlEnd === index + 1) return { match: null, reads: urlEnd };
  const gt = nextGt(urlEnd + 1);
  if (gt === -1) return { match: null, reads: text.length };
  return { match: { end: gt + 1, urlStart: index + 1, urlEnd }, reads: gt };
}

/** Whether a URL candidate (`src`, caseless) starts at `at`, after `[\s'"]`. */
function isSrcCandidate(text: string, at: number): boolean {
  const before = text.charCodeAt(at - 1);
  return (
    (before === 0x22 || before === 0x27 || isSpaceAt(text, at - 1)) &&
    asciiCaselessAt(text, at, 'src')
  );
}

/**
 * Every match of WP Rocket's script-URL regex over the comment-stripped
 * page, in order (as `preg_match_all` with `PREG_SET_ORDER`).
 *
 * At a `<script` + whitespace, PCRE tries the `src` candidates of the
 * `>`-free stretch after it from the last one back (the greedy prefix),
 * then the one right after the whitespace, then — with two or more
 * whitespace characters before a quote — the one after that quote; the
 * first whose tail matches wins. Candidates are read once, left to right,
 * keeping the last matching one and the furthest read so far: the stretch
 * of each attempt ends at or after the previous one's.
 *
 * Estimate per attempt: (whitespace + 1) × 4 × bytes read (the prefix is
 * retried for each split of the whitespace run).
 *
 * @param text The comment-stripped page.
 * @param measure The served encoding's byte measure.
 */
export function deferSrcMatches(
  text: string,
  measure: ByteMeasure
): readonly DeferSrcMatch[] | BeyondScan {
  const nextGt = nextOccurrenceFinder(text, '>');
  const nextQuote = cachedForwardSearch((from, to) => {
    const end = Math.min(to, text.length);
    for (let index = Math.max(from, 0); index < end; index++) {
      const code = text.charCodeAt(index);
      if (code === 0x22 || code === 0x27) return index;
    }
    return -1;
  });
  // Attempts of one stretch measure nested ranges: each in O(1), not its length.
  const bytes = rangeByteCounter(text, measure);
  const opener = /<[Ss][Cc][Rr][Ii][Pp][Tt]/g;
  // Cached: an attempt whose stretch holds no `src` costs O(1), not a scan to the next one.
  const nextSrc = cachedForwardSearch((from, to) => {
    const end = Math.min(to, text.length - 2);
    for (let index = Math.max(from, 0); index < end; index++) {
      if (asciiCaselessAt(text, index, 'src')) return index;
    }
    return -1;
  });
  let candidateFrom = 0;
  let lastMatching = -1;
  let lastTail: Tail | null = null;
  let furthestRead = 0;
  let stretch = -1;
  const matches: DeferSrcMatch[] = [];
  let found: RegExpExecArray | null;
  while ((found = opener.exec(text)) !== null) {
    const start = found.index;
    const after = start + 7;
    if (!isSpaceAt(text, after)) continue;
    const stretchEnd = nextGt(after);
    // No `>` left: PCRE's required-character check fails every attempt at once.
    if (stretchEnd === -1) break;
    if (stretchEnd !== stretch) {
      // A new `>`-free stretch: its candidates (and their reads) are its own.
      stretch = stretchEnd;
      furthestRead = 0;
    }
    // Read the candidates up to this attempt's stretch end (never re-read).
    for (
      let candidate = nextSrc(Math.max(candidateFrom, after));
      candidate !== -1 && candidate < stretchEnd;
      candidate = nextSrc(candidate + 1)
    ) {
      if (!isSrcCandidate(text, candidate)) continue;
      const tail = tailAt(text, candidate, nextQuote, nextGt);
      furthestRead = Math.max(furthestRead, tail.reads);
      if (tail.match !== null) {
        lastMatching = candidate;
        lastTail = tail;
      }
    }
    candidateFrom = stretchEnd;
    const spaceEnd = skipSpaces(text, after);
    const spaces = spaceEnd - after;
    const reads = Math.max(stretchEnd, furthestRead);
    const steps = (spaces + 1) * 4 * bytes(start, reads) + ATTEMPT_OVERHEAD;
    if (steps > UNREPRODUCED_STEP_CEILING) return { beyond: 'defer-script-src' };
    let tail: Tail | null = lastMatching >= spaceEnd + 2 ? lastTail : null;
    if (tail === null && asciiCaselessAt(text, spaceEnd, 'src')) {
      const direct = tailAt(text, spaceEnd, nextQuote, nextGt);
      if (direct.match !== null) tail = direct;
    }
    const quoted = text.charCodeAt(spaceEnd);
    if (
      tail === null &&
      spaces >= 2 &&
      (quoted === 0x22 || quoted === 0x27) &&
      asciiCaselessAt(text, spaceEnd + 1, 'src')
    ) {
      const afterQuote = tailAt(text, spaceEnd + 1, nextQuote, nextGt);
      if (afterQuote.match !== null) tail = afterQuote;
    }
    if (tail === null || tail.match === null) continue;
    const { end, urlStart, urlEnd } = tail.match;
    matches.push({ text: text.slice(start, end), url: text.slice(urlStart, urlEnd) });
    opener.lastIndex = end;
    // Candidates before the match end belong to it; later attempts start after it.
    candidateFrom = Math.max(candidateFrom, end);
    lastMatching = -1;
    lastTail = null;
  }
  return matches;
}

/** One inline script the inline regex matched. */
export interface InlineScriptMatch {
  /** The whole element (`$inline_js[0]`). */
  readonly element: string;
  /** Its body (`$inline_js['content']`). */
  readonly content: string;
}

/** `</script>`, ASCII caseless, exact (no whitespace before `>`). */
const SCRIPT_CLOSE = /<\/[Ss][Cc][Rr][Ii][Pp][Tt]>/g;

/**
 * Every match of WP Rocket's inline-script regex over the comment-stripped
 * page: `<script` (caseless, any continuation) up to its first `>`, then
 * the body up to the first `</script>` (caseless, lazy). An attempt reads
 * its tag and its body, to the page end when no `</script>` follows
 * (measured: one step per byte).
 *
 * @param text The comment-stripped page.
 * @param measure The served encoding's byte measure.
 */
export function inlineScriptMatches(
  text: string,
  measure: ByteMeasure
): readonly InlineScriptMatch[] | BeyondScan {
  const nextGt = nextOccurrenceFinder(text, '>');
  const nextClose = cachedForwardSearch((from, to) => {
    SCRIPT_CLOSE.lastIndex = Math.max(from, 0);
    const hit = SCRIPT_CLOSE.exec(text);
    return hit === null || hit.index >= to ? -1 : hit.index;
  });
  const opener = /<[Ss][Cc][Rr][Ii][Pp][Tt]/g;
  const matches: InlineScriptMatch[] = [];
  let found: RegExpExecArray | null;
  while ((found = opener.exec(text)) !== null) {
    const start = found.index;
    const gt = nextGt(start + 7);
    // No `>` left: PCRE's required-character check fails every attempt at once.
    if (gt === -1) break;
    const close = nextClose(gt + 1);
    const reads = close === -1 ? text.length : close + 9;
    if (byteLength(text, start, reads, measure) + ATTEMPT_OVERHEAD > UNREPRODUCED_STEP_CEILING) {
      return { beyond: 'defer-inline-scripts' };
    }
    if (close === -1) break;
    matches.push({ element: text.slice(start, close + 9), content: text.slice(gt + 1, close) });
    opener.lastIndex = close + 9;
  }
  return matches;
}
