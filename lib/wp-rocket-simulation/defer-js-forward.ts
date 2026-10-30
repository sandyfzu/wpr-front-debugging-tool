/**
 * The forward Defer JS transform: the page WP Rocket would serve with Defer
 * JS on, from a page served without it — its two rocket_buffer passes
 * reproduced byte for byte (pure, no I/O), inside the buffer's IE
 * conditional extraction:
 *
 * 1. script deferral — every `<script … src=…>` the URL regex matches
 *    outside comments, unless the joined exclusion pattern (dynamic list
 *    then stored rows) matches its URL or the tag already holds
 *    whitespace + `async`/`defer`, gets each `>` of its match stamped
 *    `data-rocket-defer defer`, wherever that tag text occurs;
 * 2. inline-jQuery wrapping — every inline script calling jQuery is wrapped
 *    in a `DOMContentLoaded` listener, unless empty, structured data, or
 *    named by the inline exclusion list; skipped whole when the joined rows
 *    name a jQuery file.
 *
 * Replacements are PHP's `str_replace`, in match order, over the whole page
 * (comments included) — done in one linear pass when that provably gives
 * the same text, else replayed call by call within a bounded amount of
 * work. A page that already defers, is AMP, or already delays (WP Rocket
 * defers first, so its output cannot be rebuilt from the delayed page) is
 * returned as is; so is one where PCRE's backtrack limit could stop a regex, or whose call-by-call
 * replay would pass that bound.
 */
import { ExclusionValidationError, type InvalidExclusionRow } from '../exclusion-builder/errors';
import { deferRowSet } from '../exclusion-builder/defer-js-rows';
import { compiledSizeClaimed } from '../exclusion-builder/pcre/parse';
import { JQUERY_CODE, LD_JSON, namesJqueryFile } from '../exclusion-builder/defer-inline-js';
import { scanTags } from '../exclusion-builder/html-scan';
import { pregQuote, unescapedDelimiterAt } from '../exclusion-builder/php/preg-quote';
import { INLINE_WRAP_CLOSE, INLINE_WRAP_OPEN, WPR_DEFER_STAMP } from '../wp-rocket/constants';
import type { DeferInlineQuoteDelimiter } from '../wp-rocket/versions';
import { alreadyServesDeferJs, alreadyServesDelayJs } from './already-served';
import { isAmpDocument } from './amp';
import type { KeyEnds } from './disjoint-replace';
import {
  REPLACEMENT_WORK_LIMIT,
  ReplacementWorkExceeded,
  replaceInOrder,
  type ReplacementWork
} from './str-replace-sequence';
import {
  deferSrcMatches,
  inlineScriptMatches,
  stripDeferComments,
  type BeyondScan
} from './defer-js-scan';
import {
  conditionalScan,
  extractIeConditionals,
  injectIeConditionals,
  scriptConditionalParts
} from './ie-conditionals';
import { asciiCaselessAt, isSpaceAt } from './pcre-text';
import { cachedForwardSearch, nextOccurrenceFinder } from '../../utils/next-occurrence';
import {
  ieConditionalScriptSteps,
  ieConditionalsSteps,
  UNREPRODUCED_STEP_CEILING,
  type UnreproducedRegex
} from './unreproduced-limits';
import { UTF8_MEASURE, utf8Length, type ByteMeasure } from './utf8';
import type { SimulationNotApplicableReason, SimulationState } from './spec';

/** The dynamic lists Defer JS reads (the simulated version's, or the latest). */
export interface DeferJsLists {
  /** `defer_js_external_exclusions`: joined ahead of the stored rows into the URL pattern. */
  readonly external: readonly string[];
  /** `defer_js_inline_exclusions`: texts whose inline scripts are never wrapped. */
  readonly inline: readonly string[];
}

/** Defer JS's inputs besides the page: the stored rows, the lists, the version's quoting. */
export interface DeferJsPassInput {
  /** The stored Defer JS exclusion rows (the settings field). */
  readonly rows: readonly string[];
  readonly lists: DeferJsLists;
  /** The simulated version's `preg_quote` delimiter for the inline list. */
  readonly inlineQuoteDelimiter: DeferInlineQuoteDelimiter;
}

/** What the transform is given. */
export interface DeferJsForwardInput extends DeferJsPassInput {
  /** The page as served (Defer JS off), decoded. */
  readonly html: string;
  /** Bytes per code unit as served (default UTF-8): decides the backtrack-limit estimates. */
  readonly measure?: ByteMeasure;
}

/** What the two passes did. */
export interface DeferJsPassCounts {
  /** Distinct script tags stamped deferred. */
  readonly deferred: number;
  /** Distinct inline scripts wrapped. */
  readonly wrapped: number;
}

/** The passes' outcome on an IE-extracted page. */
export type DeferJsPassResult = ({ readonly html: string } & DeferJsPassCounts) | BeyondScan;

/** The transform's outcome: every step state but `csp-blocked` (Defer JS injects no runtime). */
export type DeferJsForwardState = Exclude<SimulationState, 'csp-blocked'>;

/** What the transform did. */
export interface DeferJsForwardReport extends DeferJsPassCounts {
  readonly state: DeferJsForwardState;
  /** Set with `not-applicable` only. */
  readonly reason?: SimulationNotApplicableReason;
  /** With `beyond-exact-reproduction`: the regex (or rewrite) that could stop. */
  readonly unreproducedRegex?: UnreproducedRegex;
}

/** The transform's result. */
export interface DeferJsForwardResult {
  readonly html: string;
  readonly report: DeferJsForwardReport;
}

/** The replay bound Defer JS shares with every buffer pass ({@link REPLACEMENT_WORK_LIMIT}). */
export const DEFER_REPLACEMENT_WORK_LIMIT = REPLACEMENT_WORK_LIMIT;

/**
 * `/\s+(?:async|defer)/i` on a tag: some PCRE whitespace character directly
 * followed by `async` or `defer` (caseless) — linear, unlike a backtracking
 * `\s+` over a long whitespace run.
 *
 * @param tag The matched tag text.
 */
export function holdsAsyncOrDefer(tag: string): boolean {
  for (let index = 0; index < tag.length - 1; index++) {
    if (
      isSpaceAt(tag, index) &&
      (asciiCaselessAt(tag, index + 1, 'async') || asciiCaselessAt(tag, index + 1, 'defer'))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The joined URL exclusion rows as WP Rocket merges them (list first,
 * duplicates dropped keeping the first) and their matcher: `null` when the
 * joined pattern fails WP Rocket's pre-check (nothing is deferred).
 *
 * @param input The rows and lists.
 * @returns The first-matching-row lookup, or `null`.
 * @throws {@link ExclusionValidationError} naming every stored row whose
 *   matching cannot be reproduced (by stored index); {@link Error} for such
 *   a list row, or for a pre-check this tool cannot replay.
 */
export function deferUrlMatcher(input: DeferJsPassInput): ((url: string) => number) | null {
  const merged = [...new Set([...input.lists.external, ...input.rows])];
  // No rows at all: the empty pattern `#()#i` passes the pre-check and matches every URL.
  if (merged.length === 0) return () => 0;
  const set = deferRowSet(merged);
  if (set.page === 'off') return null;
  const listCount = new Set(input.lists.external).size;
  const invalid: InvalidExclusionRow[] = [];
  for (const problem of set.problems) {
    if (problem.index < listCount) {
      throw new Error(
        `Defer JS exclusion list row ${String(problem.index)} (${JSON.stringify(problem.row)}) cannot be reproduced: ${problem.reason}`
      );
    }
    invalid.push({ ...problem, index: input.rows.indexOf(problem.row) });
  }
  if (invalid.length > 0) throw new ExclusionValidationError(invalid);
  if (set.page === 'unknown' || !joinedSizeClaimed(merged)) {
    throw new Error("WP Rocket's Defer JS pre-check cannot be replayed for these rows");
  }
  return set.compileMatcher();
}

/** The last joined pattern measured, and its verdict (one document's rows repeat across runs). */
let lastJoinedSize: { readonly joined: string; readonly claimed: boolean } | undefined;

/**
 * Whether WP Rocket's joined file pattern `#(row|…)#i` is claimed to stay
 * within PCRE's compiled-size cap. Past it the pre-check fails and WP
 * Rocket defers nothing — a verdict the per-row checks never see, as only
 * the join grows that large (a long list, or stored rows on top of it).
 *
 * @param rows The joined rows (list and stored, deduplicated).
 */
function joinedSizeClaimed(rows: readonly string[]): boolean {
  const joined = `(${rows.join('|')})`;
  if (lastJoinedSize?.joined !== joined) {
    lastJoinedSize = { joined, claimed: compiledSizeClaimed(joined, true) };
  }
  return lastJoinedSize.claimed;
}

/** How the inline exclusion pattern treats every inline script. */
type InlineExclusions =
  | { readonly kind: 'every' } // empty pattern (PHP `empty()`), or an empty alternative
  | { readonly kind: 'none' } // the pattern does not compile: `preg_match` fails
  | { readonly kind: 'uncertain' } // its compiled size is too near PCRE's cap to tell
  | { readonly kind: 'rows'; readonly rows: readonly string[] }; // literal rows, ASCII caseless

/**
 * The largest inline pattern, in PCRE2 code units, that compiled — PHP
 * 8.1.34 with PCRE2 10.49 (no UTF, link size 2): 65 521 compiles, 65 522
 * fails ("regular expression is too large"), the same over row counts
 * (1 to 13 104), lengths (1 to 32 760), multibyte, quoted and control bytes.
 */
export const INLINE_PATTERN_UNITS_LIMIT = 65_521;

/**
 * Units either side of {@link INLINE_PATTERN_UNITS_LIMIT} within which
 * another PCRE2 build's fixed overhead could flip the verdict (only one
 * build was measured): a pattern this near the cap is not reproduced.
 */
export const INLINE_PATTERN_UNITS_BAND = 512;

/**
 * The compiled size of the quoted rows' alternation, in PCRE2 code units:
 * 2 per literal byte (`OP_CHAR`/`OP_CHARI` and the byte — a quoting
 * escape adds none) and 3 per `|`, the fixed parts excluded (they are in
 * {@link INLINE_PATTERN_UNITS_LIMIT}).
 *
 * @param rows The rows the joined pattern keeps (trailing empty ones trimmed).
 */
export function inlinePatternUnits(rows: readonly string[]): number {
  let bytes = 0;
  for (const row of rows) bytes += utf8Length(row);
  return 2 * bytes + 3 * Math.max(0, rows.length - 1);
}

/**
 * Whether the kept rows' pattern compiles: `true`, `false`, or `null`
 * within {@link INLINE_PATTERN_UNITS_BAND} of the limit.
 *
 * @param rows The rows the joined pattern keeps.
 */
function inlinePatternCompiles(rows: readonly string[]): boolean | null {
  const units = inlinePatternUnits(rows);
  if (units <= INLINE_PATTERN_UNITS_LIMIT - INLINE_PATTERN_UNITS_BAND) return true;
  if (units > INLINE_PATTERN_UNITS_LIMIT + INLINE_PATTERN_UNITS_BAND) return false;
  return null;
}

/**
 * The inline exclusion pattern WP Rocket builds — each row `preg_quote`d
 * with the version's delimiter, `|`-joined, trailing `|` trimmed — read as
 * what it does inside `/(…)/msi`.
 *
 * @param rows The inline list.
 * @param delimiter The version's quoting delimiter.
 */
export function inlineExclusions(
  rows: readonly string[],
  delimiter: DeferInlineQuoteDelimiter
): InlineExclusions {
  const quoted = rows.map((row) => pregQuote(row, delimiter));
  const joined = quoted
    .map((row) => `${row}|`)
    .join('')
    .replace(/\|+$/, '');
  // PHP's empty(): '' and '0' both skip every script.
  if (joined === '' || joined === '0') return { kind: 'every' };
  // An unescaped `/` ends the pattern early: an unknown modifier, never compiled.
  if (unescapedDelimiterAt(`(${joined})`, '/') !== -1) return { kind: 'none' };
  // Trimming into a last row's quoted `\|` leaves an escaping `\` before `)`: the group never closes.
  if ((/\\+$/.exec(joined)?.[0].length ?? 0) % 2 === 1) return { kind: 'none' };
  let last = quoted.length;
  while (last > 0 && quoted[last - 1] === '') last--;
  const compiles = inlinePatternCompiles(rows.slice(0, last));
  // Past PCRE's compiled-size cap `preg_match` fails: every script is evaluated as not excluded.
  if (compiles === false) return { kind: 'none' };
  if (compiles === null) return { kind: 'uncertain' };
  // An empty alternative before the last row matches every body.
  if (quoted.slice(0, last).includes('')) return { kind: 'every' };
  return { kind: 'rows', rows: rows.slice(0, last).map(asciiLower) };
}

/** ASCII letters lowercased (PCRE's caseless matching without UTF folds no other). */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/**
 * Whether the inline exclusions skip a script body.
 *
 * @param exclusions The pattern's reading.
 * @param content The script body.
 */
function inlineExcluded(
  exclusions: Exclude<InlineExclusions, { readonly kind: 'uncertain' }>,
  content: string
): boolean {
  if (exclusions.kind !== 'rows') return exclusions.kind === 'every';
  const lower = asciiLower(content);
  return exclusions.rows.some((row) => lower.includes(row));
}

/**
 * A script tag's key: up to its first `>` (unique but for a URL holding `>`).
 *
 * @param text The text searched.
 */
const tagKeyEnds: KeyEnds = (text) => {
  const nextGt = nextOccurrenceFinder(text, '>');
  return (at) => {
    const gt = nextGt(at);
    return gt === -1 ? -1 : gt + 1;
  };
};

/** `</script>`, ASCII caseless. */
const ELEMENT_CLOSE = /<\/[Ss][Cc][Rr][Ii][Pp][Tt]>/g;

/**
 * An inline script element's key: the whole element — its tag to the first
 * `>`, then to the first `</script>` (its body holds none).
 *
 * @param text The text searched.
 */
const elementKeyEnds: KeyEnds = (text) => {
  const nextGt = nextOccurrenceFinder(text, '>');
  const nextClose = cachedForwardSearch((from, to) => {
    ELEMENT_CLOSE.lastIndex = Math.max(from, 0);
    const hit = ELEMENT_CLOSE.exec(text);
    return hit === null || hit.index >= to ? -1 : hit.index;
  });
  return (at) => {
    const gt = nextGt(at);
    const close = gt === -1 ? -1 : nextClose(gt + 1);
    return close === -1 ? -1 : close + '</script>'.length;
  };
};

/**
 * The script-deferral pass (`DeferJS::defer_js`) over an IE-extracted page.
 *
 * Stamping creates no occurrence of a stamped tag text, so one pass is
 * exact when the occurrences are disjoint: an occurrence touching a stamped
 * tag would hold a whole insertion (it starts with `<` and ends with `>`,
 * the insertion ` data-rocket-defer defer` holds neither, and every `>` of
 * a stamped tag follows one) — but a tag holding whitespace + `defer` is
 * never stamped.
 *
 * @param html The page.
 * @param matcher The URL exclusion lookup, or `null` (pre-check failed: identity).
 * @param measure The served encoding's byte measure.
 * @param work The replacement work so far.
 */
function deferScripts(
  html: string,
  matcher: ((url: string) => number) | null,
  measure: ByteMeasure,
  work: ReplacementWork
): { readonly html: string; readonly deferred: number } | BeyondScan {
  const stripped = stripDeferComments(html, measure);
  if (typeof stripped !== 'string') return stripped;
  const matches = deferSrcMatches(stripped, measure);
  if ('beyond' in matches) return matches;
  if (matches.length === 0 || matcher === null) return { html, deferred: 0 };
  const order: string[] = [];
  const stamped = new Map<string, string>();
  for (const tag of matches) {
    if (matcher(tag.url) >= 0 || holdsAsyncOrDefer(tag.text)) continue;
    order.push(tag.text);
    if (!stamped.has(tag.text)) stamped.set(tag.text, tag.text.replaceAll('>', WPR_DEFER_STAMP));
  }
  return {
    html: replaceInOrder(html, order, stamped, true, tagKeyEnds, work),
    deferred: stamped.size
  };
}

/** `<script`, ASCII caseless, anywhere. */
const SCRIPT_OPEN = /<script/i;

/**
 * Whether wrapping an inline script can create no occurrence of any wrapped
 * script: its replacement is its tag, the wrapper opening, its body, the
 * wrapper closing and its end tag (the body occurs once), it does not hold
 * the wrapper opening, and its body holds no `<script`. An occurrence
 * touching a wrapped script then either covers the wrapper opening (held by
 * no search) or starts in the body (no `<script` there) or lies in original
 * text overlapping the script's own occurrence (not one pass).
 *
 * @param element The script element.
 * @param content Its body.
 * @param wrapped Its replacement.
 */
function wrapsPlainly(element: string, content: string, wrapped: string): boolean {
  const tagEnd = element.length - content.length - '</script>'.length;
  return (
    wrapped ===
      `${element.slice(0, tagEnd)}${INLINE_WRAP_OPEN}${content}${INLINE_WRAP_CLOSE}${element.slice(tagEnd + content.length)}` &&
    !element.includes(INLINE_WRAP_OPEN) &&
    !SCRIPT_OPEN.test(content)
  );
}

/**
 * The inline-jQuery pass (`DeferJS::defer_inline_js`) over an IE-extracted page.
 *
 * @param html The page (after the deferral pass).
 * @param input The rows, lists and quoting.
 * @param measure The served encoding's byte measure.
 * @param work The replacement work so far.
 */
function wrapInlineScripts(
  html: string,
  input: DeferJsPassInput,
  measure: ByteMeasure,
  work: ReplacementWork
): { readonly html: string; readonly wrapped: number } | BeyondScan {
  if (namesJqueryFile([...input.lists.external, ...input.rows])) return { html, wrapped: 0 };
  const stripped = stripDeferComments(html, measure);
  if (typeof stripped !== 'string') return stripped;
  const matches = inlineScriptMatches(stripped, measure);
  if ('beyond' in matches) return matches;
  const exclusions = inlineExclusions(input.lists.inline, input.inlineQuoteDelimiter);
  const order: string[] = [];
  const wraps = new Map<string, string>();
  let createsNone = true;
  for (const { element, content } of matches) {
    if (content === '' || LD_JSON.test(element)) continue;
    // The pattern is evaluated here: a size too near the cap cannot be told.
    if (exclusions.kind === 'uncertain') return { beyond: 'defer-inline-exclusions' };
    if (inlineExcluded(exclusions, content)) continue;
    if (!JQUERY_CODE.test(content)) continue;
    order.push(element);
    if (wraps.has(element)) continue;
    // `str_replace` on the element: every occurrence of the body is wrapped, in the tag too.
    const wrapped = element
      .split(content)
      .join(`${INLINE_WRAP_OPEN}${content}${INLINE_WRAP_CLOSE}`);
    wraps.set(element, wrapped);
    createsNone &&= wrapsPlainly(element, content, wrapped);
  }
  return {
    html: replaceInOrder(html, order, wraps, createsNone, elementKeyEnds, work),
    wrapped: wraps.size
  };
}

/**
 * Both Defer JS passes on a page whose IE conditionals are already set
 * aside (the buffer's state when they run) — shared by the Defer JS
 * transform and the Delay JS one, which runs them first in the same buffer.
 *
 * @param html The IE-extracted page.
 * @param input The rows, lists and quoting.
 * @param measure The served encoding's byte measure.
 * @throws What {@link deferUrlMatcher} throws.
 */
export function deferJsPasses(
  html: string,
  input: DeferJsPassInput,
  measure: ByteMeasure = UTF8_MEASURE
): DeferJsPassResult {
  const matcher = deferUrlMatcher(input);
  const work = { units: 0 };
  try {
    const scripts = deferScripts(html, matcher, measure, work);
    if ('beyond' in scripts) return scripts;
    const inline = wrapInlineScripts(scripts.html, input, measure, work);
    if ('beyond' in inline) return inline;
    return { html: inline.html, deferred: scripts.deferred, wrapped: inline.wrapped };
  } catch (error) {
    if (error instanceof ReplacementWorkExceeded) return { beyond: 'defer-replacements' };
    throw error;
  }
}

/**
 * Simulate WP Rocket's Defer JS on a page served without it.
 *
 * @param input The page, the stored rows, the lists and the version's quoting.
 * @returns The page WP Rocket would serve, and the report.
 * @throws What {@link deferUrlMatcher} throws.
 */
export function simulateDeferJs(input: DeferJsForwardInput): DeferJsForwardResult {
  const measure = input.measure ?? UTF8_MEASURE;
  const tags = scanTags(input.html);
  const identity = (
    state: DeferJsForwardState,
    why: Pick<DeferJsForwardReport, 'reason' | 'unreproducedRegex'> = {}
  ): DeferJsForwardResult => ({
    html: input.html,
    report: { state, ...why, deferred: 0, wrapped: 0 }
  });
  const beyond = (regex: UnreproducedRegex): DeferJsForwardResult =>
    identity('not-applicable', { reason: 'beyond-exact-reproduction', unreproducedRegex: regex });
  if (isAmpDocument(input.html, tags)) return identity('not-applicable', { reason: 'amp' });
  if (alreadyServesDeferJs(tags)) return identity('already-served');
  // WP Rocket defers before it delays: a delayed page no longer holds the
  // scripts as Defer JS would read them, so its output cannot be rebuilt.
  if (alreadyServesDelayJs(input.html, tags)) {
    return identity('not-applicable', { reason: 'delay-js-served' });
  }
  const conditionals = conditionalScan(input.html);
  if (ieConditionalsSteps(input.html, conditionals, measure) > UNREPRODUCED_STEP_CEILING) {
    return beyond('ie-conditionals');
  }
  const extracted = extractIeConditionals(input.html, conditionals);
  for (const conditional of extracted.conditionals) {
    const parts = scriptConditionalParts(conditional);
    if (
      parts !== null &&
      ieConditionalScriptSteps(conditional, parts, measure) > UNREPRODUCED_STEP_CEILING
    ) {
      return beyond('ie-conditional-script');
    }
  }
  const passes = deferJsPasses(extracted.html, input, measure);
  if ('beyond' in passes) return beyond(passes.beyond);
  return {
    html: injectIeConditionals(passes.html, extracted.conditionals),
    report: { state: 'simulated', deferred: passes.deferred, wrapped: passes.wrapped }
  };
}
