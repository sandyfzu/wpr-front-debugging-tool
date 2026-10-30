/**
 * The replacement LazyLoad makes for a picture's image: WP Rocket quotes
 * the image tag (`IMG`) into
 * `#<noscript[^>]*>.*IMG.*<\/noscript>(*SKIP)(*FAIL)|IMG#i` and replaces
 * every caseless occurrence of the tag across the page, except within a
 * noscript stretch the first branch skips. Without the `s` flag `.`
 * excludes only LF, so that stretch runs from a `<noscript` (caseless, to
 * its first `>`) over the rest of that line, to the LAST occurrence of the
 * tag on it whose line still holds a `</noscript>` after it, to the last
 * such `</noscript>` — matching resumes past it. The replacement text is a
 * PHP replacement string (`$n`/`\n` references expand).
 *
 * The pattern holds the tag twice: PCRE refuses to compile it past its
 * compiled-size cap, and WP Rocket then leaves the picture's image as is.
 */
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { asciiCaselessAt } from './pcre-text';
import { expandPhpReplacement } from './php-replacement';
import { countReplacementWork, type ReplacementWork } from './str-replace-sequence';
import { nextOccurrenceFinder } from '../../utils/next-occurrence';
import { UNREPRODUCED_STEP_CEILING } from './unreproduced-limits';
import { byteLength, type ByteMeasure } from './utf8';
import type { LazyloadBeyond } from './lazyload-scan';

/**
 * The longest image tag, in bytes, whose pattern compiled — PHP 8.1.34
 * with PCRE2 10.49 (link size 2): 16 369 compiles, 16 370 fails, the same
 * for every byte kind tried (letters, digits, quoted and control bytes,
 * multibyte; 4 compiled units per byte under the 64 Ki cap).
 */
export const PICTURE_IMAGE_PATTERN_MAX_BYTES = 16_369;

/**
 * Bytes either side of {@link PICTURE_IMAGE_PATTERN_MAX_BYTES} within
 * which another PCRE2 build's fixed overhead could flip the verdict (one
 * build was measured): such a tag is not reproduced.
 */
export const PICTURE_IMAGE_PATTERN_BAND_BYTES = 128;

/**
 * Whether the pattern for an image tag compiles: `true`, `false`, or
 * `null` within the band.
 *
 * @param image The image tag.
 * @param measure The served encoding's byte measure.
 */
export function pictureImagePatternCompiles(image: string, measure: ByteMeasure): boolean | null {
  const bytes = byteLength(image, 0, image.length, measure);
  if (bytes <= PICTURE_IMAGE_PATTERN_MAX_BYTES - PICTURE_IMAGE_PATTERN_BAND_BYTES) return true;
  if (bytes > PICTURE_IMAGE_PATTERN_MAX_BYTES + PICTURE_IMAGE_PATTERN_BAND_BYTES) return false;
  return null;
}

/** Steps a noscript attempt costs besides the `<` it visits (measured: up to 8). */
const ATTEMPT_OVERHEAD = 32;

/** Steps per `<` an attempt's `.*` backtracks over (PCRE's JIT steps from one `<` candidate to the next). */
const STEPS_PER_LT = 2;

/**
 * Replay work charged per `<noscript` opening visited or occurrence read
 * (a few native searches and binary searches each, against code units
 * scanned natively — the unit {@link ReplacementWork} counts).
 */
const LOOKUP_WORK = 256;

/** The opening and closing tags of the skipped stretch, lowercase. */
const NOSCRIPT_OPEN = '<noscript';
const NOSCRIPT_CLOSE = '</noscript>';

/**
 * Every offset where `needle` (non-empty) starts in `text`, ASCII letters
 * compared caselessly. A JS caseless regex (no `u` flag) finds a superset —
 * it also folds non-ASCII pairs, which PCRE without UTF does not — so each
 * hit is checked. Occurrences of an image tag never overlap (its only `>`
 * ends it), so the search resumes past each one.
 *
 * @param text The text.
 * @param needle The needle.
 */
function caselessOccurrences(text: string, needle: string): number[] {
  const lower = asciiLowerCase(needle);
  const search = new RegExp(needle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'gi');
  const offsets: number[] = [];
  let found: RegExpExecArray | null;
  while ((found = search.exec(text)) !== null) {
    if (asciiCaselessAt(text, found.index, lower)) offsets.push(found.index);
    else search.lastIndex = found.index + 1;
  }
  return offsets;
}

/**
 * How many of the ascending `offsets` are below `at`.
 *
 * @param offsets Ascending offsets.
 * @param at The bound.
 */
function countBelow(offsets: readonly number[], at: number): number {
  let lo = 0;
  let hi = offsets.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((offsets[mid] as number) < at) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The `<` and `</noscript>` offsets of one line (no LF inside), ascending. */
interface LineMarks {
  readonly lts: readonly number[];
  readonly closes: readonly number[];
}

/** One occurrence of the tag, read as the first branch would from it. */
interface Occurrence {
  /** Where `(*SKIP)` resumes when this is the occurrence the branch settles on, or -1. */
  readonly skipTo: number;
  /** Steps trying it costs: its second `.*` over the rest of its line. */
  readonly steps: number;
}

/**
 * The page after WP Rocket's per-picture replacement of `image` by
 * `replacement` (a PHP replacement string), or where PCRE's backtrack
 * limit could stop it.
 *
 * At a `<noscript` the first branch settles on the last occurrence of the
 * tag on the line after the opening's `>` whose own line (from its end)
 * still holds a `</noscript>`; occurrences after it are tried first. An
 * attempt's estimate: two steps per `<` its first `.*` covers, plus, for
 * each occurrence tried, one step and two per `<` its second `.*` covers.
 *
 * Only what a reached `<noscript` needs is computed: the occurrences are
 * found by one native search, and a line's `<` and `</noscript>` offsets
 * once, when first read. The work — the page, each line read, each
 * opening visited and occurrence read — is charged to `work`.
 *
 * @param html The page.
 * @param image The image tag (non-empty).
 * @param replacement The replacement string.
 * @param work The replay's work so far (mutated).
 * @throws {@link ReplacementWorkExceeded} past the replay's work bound.
 */
export function replacePictureImage(
  html: string,
  image: string,
  replacement: string,
  work: ReplacementWork = { units: 0 }
): string | LazyloadBeyond {
  countReplacementWork(work, html.length);
  const occurrences = caselessOccurrences(html, image);
  if (occurrences.length === 0) return html;
  // Cached finders: a single-line page must not be rescanned per opening visited.
  const nextNewline = nextOccurrenceFinder(html, '\n');
  const nextGt = nextOccurrenceFinder(html, '>');
  const lineEnd = (from: number): number => {
    const newline = nextNewline(from);
    return newline === -1 ? html.length : newline;
  };
  const lines = new Map<number, LineMarks>();
  /**
   * The marks of the line ending at `end` (a LF or the page end).
   *
   * @param end The line's end.
   */
  const marksOf = (end: number): LineMarks => {
    let marks = lines.get(end);
    if (marks !== undefined) return marks;
    const start = end === 0 ? 0 : html.lastIndexOf('\n', end - 1) + 1;
    countReplacementWork(work, end - start);
    const lts: number[] = [];
    const closes: number[] = [];
    for (let at = html.indexOf('<', start); at !== -1 && at < end; at = html.indexOf('<', at + 1)) {
      lts.push(at);
      if (asciiCaselessAt(html, at, NOSCRIPT_CLOSE)) closes.push(at);
    }
    marks = { lts, closes };
    lines.set(end, marks);
    return marks;
  };
  const ltsWithin = (marks: LineMarks, from: number, to: number): number =>
    countBelow(marks.lts, to) - countBelow(marks.lts, from);
  const read = new Map<number, Occurrence>();
  /**
   * Occurrence `index`, read from its end to its line's end.
   *
   * @param index The occurrence's index.
   */
  const readAt = (index: number): Occurrence => {
    let occurrence = read.get(index);
    if (occurrence !== undefined) return occurrence;
    const after = (occurrences[index] as number) + image.length;
    const end = lineEnd(after);
    const marks = marksOf(end);
    const close = marks.closes[countBelow(marks.closes, end - NOSCRIPT_CLOSE.length + 1) - 1] ?? -1;
    occurrence = {
      skipTo: close >= after ? close + NOSCRIPT_CLOSE.length : -1,
      steps: 1 + STEPS_PER_LT * ltsWithin(marks, after, end)
    };
    read.set(index, occurrence);
    return occurrence;
  };
  /**
   * The first branch at the `<noscript` at `start`: the skip target, -1
   * when it fails, or where PCRE could stop.
   *
   * @param start The opening's offset.
   */
  const firstBranch = (start: number): number | LazyloadBeyond => {
    countReplacementWork(work, LOOKUP_WORK);
    const gt = nextGt(start + NOSCRIPT_OPEN.length);
    if (gt === -1) return -1;
    const end = lineEnd(gt + 1);
    const from = countBelow(occurrences, gt + 1);
    let steps = ATTEMPT_OVERHEAD + STEPS_PER_LT * ltsWithin(marksOf(end), gt + 1, end);
    // Occurrences on the line are tried last to first until one settles.
    for (let index = countBelow(occurrences, end) - 1; index >= from; index--) {
      countReplacementWork(work, LOOKUP_WORK);
      const occurrence = readAt(index);
      steps += occurrence.steps;
      if (steps > UNREPRODUCED_STEP_CEILING) return { beyond: 'lazyload-picture-image' };
      if (occurrence.skipTo !== -1) return occurrence.skipTo;
    }
    return steps > UNREPRODUCED_STEP_CEILING ? { beyond: 'lazyload-picture-image' } : -1;
  };
  const opener = /<noscript/gi;
  const expanded = new Map<string, string>();
  const parts: string[] = [];
  let copied = 0;
  let pos = 0;
  let next = 0;
  for (;;) {
    while (next < occurrences.length && (occurrences[next] as number) < pos) next++;
    const occurrence = occurrences[next];
    if (occurrence === undefined) break;
    opener.lastIndex = pos;
    const noscript = opener.exec(html)?.index ?? Infinity;
    if (noscript < occurrence) {
      const skipTo = firstBranch(noscript);
      if (typeof skipTo !== 'number') return skipTo;
      pos = skipTo === -1 ? noscript + 1 : skipTo;
      continue;
    }
    const matched = html.slice(occurrence, occurrence + image.length);
    let written = expanded.get(matched);
    if (written === undefined) {
      written = expandPhpReplacement(replacement, [matched]);
      expanded.set(matched, written);
    }
    parts.push(html.slice(copied, occurrence), written);
    copied = occurrence + image.length;
    pos = copied;
  }
  parts.push(html.slice(copied));
  return parts.join('');
}
