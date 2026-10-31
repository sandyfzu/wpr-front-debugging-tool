/**
 * The page-scale regexes of WP Rocket's LazyLoad image pass, reproduced as
 * linear scanners (PCRE without UTF: `\s` = PCRE's ASCII set, `i` folds
 * ASCII letters only), each attempt paired with an upper estimate of the
 * steps PCRE's JIT counts for it — it counts lazy-quantifier and
 * backtracking iterations, not greedy or possessive character runs:
 *
 * - script/noscript hiding: `#<(no)?script[^>]*>.*?<\/(no)?script\s*>#mis`;
 * - pictures: `#<picture(?:.*)?>(?<sources>.*)</picture>#iUs`;
 * - images: `#<img(?<atts>\s.+)\s?/?>#iUs`;
 * - picture sources: `#<source(?<atts>\s.+)>#iUs`;
 * - background candidates:
 *   `#<(?<tag>div|figure|section|aside|span|li|a)\b(?:[^>=]++|=\s*+"[^"]*+"|=\s*+'[^']*+'|=)*+>#is`.
 *
 * An attempt whose estimate passes {@link UNREPRODUCED_STEP_CEILING} stops
 * the scan (`beyond`): PCRE's backtrack limit could stop WP Rocket's call
 * there, which is not reproduced. Estimates were fitted on the plugin
 * (`pcre.backtrack_limit` bisected under `php -n -d pcre.jit=1`) and stay
 * at or above its count.
 */
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { PCRE_SPACE_CHARS } from '../exclusion-builder/pcre/byte-set';
import { asciiCaselessAt, isSpaceAt } from './pcre-text';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';
import { rangeByteCounter, type ByteMeasure } from './utf8';
import { cachedForwardSearch, nextOccurrenceFinder } from '../../utils/next-occurrence';
import type { LazyloadUnreproduced } from './spec';

/** A scan stopped where WP Rocket's run could diverge. */
export interface LazyloadBeyond {
  readonly beyond: LazyloadUnreproduced;
}

/** Steps an attempt costs besides what it reads (measured: 1–21). */
const ATTEMPT_OVERHEAD = 32;

/** Steps per byte the image pattern's lazy `.+` with its optional tail reads (measured: 3). */
const IMAGE_STEPS_PER_BYTE = 4;

/** Steps per byte a hidden block's lazy body reads (measured: 1, 1.1 over end-tag lookalikes). */
const HIDDEN_STEPS_PER_BYTE = 2;

/**
 * Steps per byte the picture pattern reads (measured: 2 per byte of its
 * lazy opening, 1 per byte of its lazy body plus 3 per `<` in it).
 */
const PICTURE_STEPS_PER_BYTE = 4;

/**
 * Steps per byte an attempt from an unclosed opening (no `>` after it)
 * reads to the page end, once PCRE skips its required-`>` check: it skips
 * it when more than 500 000 bytes remain after the opening (PCRE2 10.49's
 * JIT; measured: images 3, pictures 2 per byte), and the image pattern
 * also reads it after an `<img\s>` whose only `>` it cannot use. Other
 * builds search other distances, so every unclosed opening is charged as
 * read, and summed (measured: only the first one reads).
 */
const UNCLOSED_STEPS_PER_BYTE = 4;

/**
 * Whether the unclosed openings `opener` still finds, from the one at
 * `first` on, could pass the ceiling: each charged
 * {@link UNCLOSED_STEPS_PER_BYTE} per byte from it to the page end.
 *
 * @param text The subject.
 * @param opener The opening's global regex, `lastIndex` past `first`.
 * @param first The first unclosed opening's offset.
 * @param bytes The subject's byte counter.
 * @param counts Whether an opening found at an offset is a real attempt.
 */
function unclosedOpeningsExceed(
  text: string,
  opener: RegExp,
  first: number,
  bytes: (from: number, to: number) => number,
  counts: (start: number) => boolean
): boolean {
  let steps = 0;
  for (let start: number | undefined = first; start !== undefined;) {
    if (counts(start)) {
      steps += UNCLOSED_STEPS_PER_BYTE * bytes(start, text.length) + ATTEMPT_OVERHEAD;
      if (steps > UNREPRODUCED_STEP_CEILING) return true;
    }
    start = opener.exec(text)?.index;
  }
  return false;
}

/** The two blocks hidden from LazyLoad's matching. */
export type HiddenBlock = 'script' | 'noscript';

/**
 * The page without its `<script>` (or `<noscript>`) elements, as
 * `preg_replace('#<script[^>]*>.*?<\/script\s*>#mis', '', …)` leaves it:
 * from each opening (caseless, any continuation) to its first `>`, then
 * to the first end tag after it (`\s*` before its `>`), left to right. An
 * opening with no end tag after its `>` removes nothing, nor can any later
 * one. An attempt costs one step per byte its lazy body reads.
 *
 * @param html The page.
 * @param name Which element.
 * @param measure The served encoding's byte measure.
 */
export function withoutHiddenBlocks(
  html: string,
  name: HiddenBlock,
  measure: ByteMeasure
): string | LazyloadBeyond {
  const opener = new RegExp(`<${name}`, 'gi');
  const closer = new RegExp(`</${name}[${PCRE_SPACE_CHARS}]*>`, 'gi');
  const bytes = rangeByteCounter(html, measure);
  const nextGt = nextOccurrenceFinder(html, '>');
  let out = '';
  let copied = 0;
  let found: RegExpExecArray | null;
  while ((found = opener.exec(html)) !== null) {
    const gt = nextGt(found.index + name.length + 1);
    if (gt === -1) break;
    closer.lastIndex = gt + 1;
    const close = closer.exec(html);
    const reads = close === null ? html.length : close.index;
    if (
      HIDDEN_STEPS_PER_BYTE * bytes(gt + 1, reads) + ATTEMPT_OVERHEAD >
      UNREPRODUCED_STEP_CEILING
    ) {
      return { beyond: 'lazyload-hidden-blocks' };
    }
    if (close === null) break;
    out += html.slice(copied, found.index);
    copied = close.index + close[0].length;
    opener.lastIndex = copied;
  }
  return out + html.slice(copied);
}

/** LazyLoad's parse copy: scripts, then noscripts hidden. */
export function lazyloadParseCopy(html: string, measure: ByteMeasure): string | LazyloadBeyond {
  const noScripts = withoutHiddenBlocks(html, 'script', measure);
  if (typeof noScripts !== 'string') return noScripts;
  return withoutHiddenBlocks(noScripts, 'noscript', measure);
}

/** One picture the picture regex matched. */
export interface PictureMatch {
  /** The whole match, `<picture` to its first `</picture>` (`$picture[0]`). */
  readonly text: string;
  /** Between the opening's first `>` and that end tag (`$picture['sources']`). */
  readonly sources: string;
}

/**
 * Every distinct match of the picture regex in the parse copy, in order
 * (`array_unique`: a match's text decides its sources). A match runs from
 * `<picture` (caseless, any continuation) to its first `>`, then to the
 * first `</picture>`. Its attempt reads both stretches (up to
 * {@link PICTURE_STEPS_PER_BYTE} steps per byte). An opening with no end
 * tag after its `>` fails, and so does any later one; its attempt reads
 * the opening to the page end and retries the body from every `>` up to
 * the page end — at that rate too. One with no `>` left ends the scan,
 * charged as reading to the page end (as is every later one), as the
 * image scan does.
 *
 * @param copy The parse copy.
 * @param measure The served encoding's byte measure.
 */
export function pictureMatches(
  copy: string,
  measure: ByteMeasure
): readonly PictureMatch[] | LazyloadBeyond {
  const bytes = rangeByteCounter(copy, measure);
  const nextGt = nextOccurrenceFinder(copy, '>');
  const lower = asciiLowerCase(copy);
  const opener = /<picture/gi;
  const seen = new Set<string>();
  const matches: PictureMatch[] = [];
  let found: RegExpExecArray | null;
  while ((found = opener.exec(copy)) !== null) {
    const start = found.index;
    const gt = nextGt(start + 8);
    if (gt === -1) {
      if (unclosedOpeningsExceed(copy, opener, start, bytes, () => true)) {
        return { beyond: 'lazyload-pictures' };
      }
      break;
    }
    const close = lower.indexOf('</picture>', gt + 1);
    if (close === -1) {
      let steps = PICTURE_STEPS_PER_BYTE * bytes(start, copy.length) + ATTEMPT_OVERHEAD;
      for (let at = gt; at !== -1; at = nextGt(at + 1)) {
        steps += PICTURE_STEPS_PER_BYTE * bytes(at + 1, copy.length);
        if (steps > UNREPRODUCED_STEP_CEILING) return { beyond: 'lazyload-pictures' };
      }
      break;
    }
    if (
      PICTURE_STEPS_PER_BYTE * bytes(start, close) + ATTEMPT_OVERHEAD >
      UNREPRODUCED_STEP_CEILING
    ) {
      return { beyond: 'lazyload-pictures' };
    }
    const end = close + '</picture>'.length;
    const text = copy.slice(start, end);
    if (!seen.has(text)) {
      seen.add(text);
      matches.push({ text, sources: copy.slice(gt + 1, close) });
    }
    opener.lastIndex = end;
  }
  return matches;
}

/** One image the image regex matched. */
export interface ImageMatch {
  /** `<img` to the tag's end (`$image[0]`). */
  readonly text: string;
  /** From the whitespace after `<img` to the optional `\s`/`/` before `>` (`$image['atts']`). */
  readonly atts: string;
}

/**
 * Where an image match's `atts` ends, given its `>`: the lazy `.+` stops
 * at the first offset where `>`, `/>`, `\s>` or `\s/>` follows (at least
 * one character after the whitespace).
 *
 * @param text The subject.
 * @param start The `<img` offset.
 * @param gt The match's `>`.
 */
function attsEnd(text: string, start: number, gt: number): number {
  const first = start + 6;
  if (gt - 2 >= first && isSpaceAt(text, gt - 2) && text[gt - 1] === '/') return gt - 2;
  if (gt - 1 >= first && (text[gt - 1] === '/' || isSpaceAt(text, gt - 1))) return gt - 1;
  return gt;
}

/**
 * The image matches of a subject, in order, from `from` (as
 * `preg_match_all`, or `preg_match` with `firstOnly`): `<img` (caseless)
 * + a whitespace character, then up to the first `>` at least two
 * characters on. An attempt reads its match at about three steps per byte.
 * One with no `>` left ends the scan: PCRE's required-character check
 * fails it at once only while the rest of the page is short enough, so
 * it, and every later one, is charged as reading to the page end.
 *
 * @param text The subject.
 * @param measure The served encoding's byte measure.
 * @param firstOnly Stop at the first match.
 */
export function imageMatches(
  text: string,
  measure: ByteMeasure,
  firstOnly = false
): readonly ImageMatch[] | LazyloadBeyond {
  const bytes = rangeByteCounter(text, measure);
  const nextGt = nextOccurrenceFinder(text, '>');
  const opener = /<img/gi;
  const matches: ImageMatch[] = [];
  let found: RegExpExecArray | null;
  while ((found = opener.exec(text)) !== null) {
    const start = found.index;
    if (!isSpaceAt(text, start + 4)) continue;
    const gt = nextGt(start + 6);
    if (gt === -1) {
      const counts = (at: number): boolean => isSpaceAt(text, at + 4);
      if (unclosedOpeningsExceed(text, opener, start, bytes, counts)) {
        return { beyond: 'lazyload-images' };
      }
      break;
    }
    if (
      IMAGE_STEPS_PER_BYTE * bytes(start, gt + 1) + ATTEMPT_OVERHEAD >
      UNREPRODUCED_STEP_CEILING
    ) {
      return { beyond: 'lazyload-images' };
    }
    matches.push({
      text: text.slice(start, gt + 1),
      atts: text.slice(start + 4, attsEnd(text, start, gt))
    });
    if (firstOnly) break;
    opener.lastIndex = gt + 1;
  }
  return matches;
}

/**
 * The distinct `<source` tags of a picture's sources, in order:
 * `<source` (caseless) + a whitespace character, then up to the first `>`
 * at least two characters on. An attempt costs one step per byte it reads
 * (measured), within its picture's own bounded estimate: no estimate.
 *
 * @param sources The picture's sources.
 */
export function sourceMatches(sources: string): readonly string[] {
  const nextGt = nextOccurrenceFinder(sources, '>');
  const opener = /<source/gi;
  const seen = new Set<string>();
  const matches: string[] = [];
  let found: RegExpExecArray | null;
  while ((found = opener.exec(sources)) !== null) {
    const start = found.index;
    if (!isSpaceAt(sources, start + 7)) continue;
    const gt = nextGt(start + 9);
    if (gt === -1) break;
    const text = sources.slice(start, gt + 1);
    if (!seen.has(text)) {
      seen.add(text);
      matches.push(text);
    }
    opener.lastIndex = gt + 1;
  }
  return matches;
}

/** One background candidate the element regex matched. */
export interface BackgroundElementMatch {
  /** The opening tag (`$element[0]`). */
  readonly text: string;
  /** The tag name as written (`$element['tag']`). */
  readonly tag: string;
}

/** The candidate tag names, in the alternation's order. */
const BACKGROUND_TAGS = ['div', 'figure', 'section', 'aside', 'span', 'li', 'a'] as const;

/** Whether `text[index]` is a PCRE word character (no UTF: ASCII letters, digits, `_`). */
function isWordAt(text: string, index: number): boolean {
  return index < text.length && /\w/.test(text.charAt(index));
}

/**
 * The tag name the alternation matches at `<` + 1, followed by a word
 * boundary — the first alternative that does, as PCRE backtracks into the
 * next one when `\b` fails.
 *
 * @param text The subject.
 * @param at The offset after `<`.
 */
function backgroundTagAt(text: string, at: number): string | null {
  for (const name of BACKGROUND_TAGS) {
    if (asciiCaselessAt(text, at, name) && !isWordAt(text, at + name.length)) {
      return text.slice(at, at + name.length);
    }
  }
  return null;
}

/**
 * Every match of the background candidate regex, in order (duplicates
 * kept — WP Rocket does not deduplicate them). Its possessive body reads,
 * left to right: runs of anything but `>` and `=`, a `=` + whitespace + a
 * closed quoted value (`"` tried before `'`), or a bare `=`; the tag ends
 * at the first `>` reached that way, and fails at the end of the subject.
 * Bodies from different starts join at their first `=` or `>`, so the end
 * reached from each `=` is computed once (linear in total). Possessive
 * runs cost PCRE's JIT next to nothing (measured): no estimate.
 *
 * @param copy The parse copy.
 */
export function backgroundElementMatches(copy: string): readonly BackgroundElementMatch[] {
  const nextGt = nextOccurrenceFinder(copy, '>');
  const nextEquals = nextOccurrenceFinder(copy, '=');
  const nextQuote = { '"': nextOccurrenceFinder(copy, '"'), "'": nextOccurrenceFinder(copy, "'") };
  const nextNonSpace = cachedForwardSearch((from, to) => {
    const end = Math.min(to, copy.length);
    for (let at = Math.max(from, 0); at < end; at++) if (!isSpaceAt(copy, at)) return at;
    return -1;
  });
  // The tag end (exclusive) reached from the `=` at a key, or -1.
  const endFromEquals = new Map<number, number>();
  /**
   * The tag end reached from offset `from` in the body's free state.
   *
   * @param from The offset.
   */
  const endFrom = (from: number): number => {
    const chain: number[] = [];
    let at = from;
    let end: number;
    for (;;) {
      const gt = nextGt(at);
      const equals = nextEquals(at);
      if (equals === -1 || (gt !== -1 && gt < equals)) {
        end = gt === -1 ? -1 : gt + 1;
        break;
      }
      const known = endFromEquals.get(equals);
      if (known !== undefined) {
        end = known;
        break;
      }
      chain.push(equals);
      const value = nextNonSpace(equals + 1);
      const quote = value === -1 ? undefined : copy[value];
      const close = quote === '"' || quote === "'" ? nextQuote[quote](value + 1) : -1;
      at = close === -1 ? equals + 1 : close + 1;
    }
    for (const equals of chain) endFromEquals.set(equals, end);
    return end;
  };
  const matches: BackgroundElementMatch[] = [];
  for (let at = copy.indexOf('<'); at !== -1; at = copy.indexOf('<', at + 1)) {
    const tag = backgroundTagAt(copy, at + 1);
    if (tag === null) continue;
    const end = endFrom(at + 1 + tag.length);
    if (end === -1) continue;
    matches.push({ text: copy.slice(at, end), tag });
    at = end - 1;
  }
  return matches;
}
