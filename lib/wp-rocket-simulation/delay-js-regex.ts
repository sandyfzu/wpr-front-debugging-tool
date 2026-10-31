/**
 * WP Rocket's Delay JS regex over a (masked) page: its script matches, and
 * when it gives up. PHP runs
 * `/<\s*script(?<attr>\s*[^>]*?)?>(?<content>.*?)?<\s*\/\s*script\s*>/ims`
 * with `preg_replace_callback`: a match runs from an opening (`<\s*script`)
 * through its first `>` to the first end tag after it; matching resumes
 * after it. Found here by search, not by a backtracking regex: linear.
 *
 * It runs with PCRE's JIT on (PHP's default) and `pcre.backtrack_limit` = 1 000 000.
 * The JIT charges each match attempt (each start position, counted afresh)
 * a number of steps; past the limit `preg_replace_callback` fails as a whole
 * and WP Rocket serves the page with no script delayed — yet still injects
 * its runtime, its IE fallback and moves `<meta charset>`.
 *
 * The step counts below were measured on the JIT (PHP 8.1, PCRE2 10.49:
 * the smallest limit each subject passes at, by bisection) and checked
 * exact on thousands of random subjects; with bytes `b` after the opening
 * tag's first `>` at `g`:
 *
 * - every byte the lazy content loop steps over costs 2, plus 1 per
 *   `\s*` of the end-tag pattern the attempt there reaches: a `<` reaches
 *   one, `</` two, `</script` three ({@link endTagReach});
 * - an attempt that matches costs 9 + 2 per attribute byte after the
 *   attribute's leading whitespace (`m`) + its content's steps;
 * - an attempt that fails (no end tag after `g`) re-runs the content loop
 *   to the end of the subject once per way the attribute group can split
 *   its text — `k + 1` for `k` leading whitespace bytes, 2 for an empty
 *   attribute (the group is also skipped) — and costs
 *   `k² + 7k + 8 + 2(k + 1)m` (11 for an empty attribute) + those runs,
 *   each charged its first byte's reach once more;
 * - an attempt with fewer than 17 bytes left, or no `>` after its opening,
 *   ends at once (cost 1).
 *
 * Bytes, not characters: the pattern runs without the UTF option on the
 * page's served bytes ({@link ByteMeasure}, UTF-8 by default).
 *
 * Every function here is linear in the page on any input (the search for
 * an opening's `>` is shared between openings — see {@link nextOpening}).
 */
import { nextOccurrenceFinder, type NextOccurrence } from '../../utils/next-occurrence';
import { DELAY_SCRIPT_END_SOURCE } from '../exclusion-builder/delay-js';
import { PCRE_SPACE_CHARS } from '../exclusion-builder/pcre/byte-set';
import { asciiCaselessAt, skipSpaces } from './pcre-text';
import { UTF8_MEASURE, type ByteMeasure } from './utf8';

/** PHP's default `pcre.backtrack_limit`: the most steps one match attempt may take. */
export const PCRE_BACKTRACK_LIMIT = 1_000_000;

/** The shortest subject a match can span (`<script></script>`): shorter attempts end at once. */
const MIN_MATCH_BYTES = 17;

/** Steps of a matching attempt besides its attribute and content. */
const MATCH_BASE_STEPS = 9;

/** Steps per byte the content loop steps over (before the end-tag reach). */
const STEP_PER_BYTE = 2;

/** The most a byte costs: {@link STEP_PER_BYTE} + an end-tag reach of 3. */
const MAX_STEPS_PER_BYTE = STEP_PER_BYTE + 3;

/**
 * How many `\s*` of the end-tag pattern (`<\s*\/\s*script\s*>`) an attempt
 * at `index` reaches before it fails: 0 off a `<`, 1 after `<`, 2 after
 * `</`, 3 after `</script`. Only called where no end tag starts.
 *
 * @param text The subject.
 * @param index An offset.
 */
export function endTagReach(text: string, index: number): number {
  if (text.charCodeAt(index) !== 60) return 0;
  let at = skipSpaces(text, index + 1);
  if (text[at] !== '/') return 1;
  at = skipSpaces(text, at + 1);
  return asciiCaselessAt(text, at, 'script') ? 3 : 2;
}

/**
 * The content loop's steps over `text[from, to)`: 2 per byte plus each
 * position's end-tag reach.
 *
 * @param text The subject.
 * @param from Start offset.
 * @param to End offset (no end tag starts inside).
 * @param measure The served encoding's byte measure.
 */
export function contentSteps(
  text: string,
  from: number,
  to: number,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  let steps = 0;
  for (let index = from; index < to; index++) {
    const code = text.charCodeAt(index);
    if (code === 60) steps += STEP_PER_BYTE + endTagReach(text, index);
    else steps += STEP_PER_BYTE * (code < 0x80 ? 1 : measure.unitBytes(text, index));
  }
  return steps;
}

/** One match attempt's opening: where its `<` and its first `>` after `script` are. */
export interface DelayAttemptOpening {
  /** Offset of the `<`. */
  readonly start: number;
  /** Offset just past `script`. */
  readonly attrStart: number;
  /** Offset of the opening's first `>` (`-1` when none). */
  readonly gt: number;
}

/**
 * The attribute group's shape: its leading `\s` bytes (`k`) and the bytes
 * after them (`m`).
 *
 * @param text The subject.
 * @param opening The attempt's opening (with a `>`).
 * @param measure The served encoding's byte measure.
 */
function attributeShape(
  text: string,
  opening: DelayAttemptOpening,
  measure: ByteMeasure
): { readonly k: number; readonly m: number } {
  const after = skipSpaces(text, opening.attrStart);
  return { k: after - opening.attrStart, m: unitBytesOf(text, after, opening.gt, measure) };
}

/**
 * The bytes of `text[from, to)`.
 *
 * @param text The subject.
 * @param from Start offset.
 * @param to End offset.
 * @param measure The served encoding's byte measure.
 */
function unitBytesOf(text: string, from: number, to: number, measure: ByteMeasure): number {
  let bytes = 0;
  for (let index = from; index < to; index++) {
    bytes += text.charCodeAt(index) < 0x80 ? 1 : measure.unitBytes(text, index);
  }
  return bytes;
}

/**
 * Whether an attempt over `units` code units surely stays within the
 * limit: every unit is at most the measure's widest (3 bytes in UTF-8) and
 * every byte costs at most 5 steps — so most scripts skip the exact count.
 *
 * @param units Code units from just past `script` to the end tag.
 * @param measure The served encoding's byte measure.
 */
export function surelyWithinLimit(units: number, measure: ByteMeasure = UTF8_MEASURE): boolean {
  return (
    MATCH_BASE_STEPS + units * measure.maxUnitBytes * MAX_STEPS_PER_BYTE <= PCRE_BACKTRACK_LIMIT
  );
}

/**
 * Steps of an attempt that matches: from its opening to the end tag at `contentEnd`.
 *
 * @param text The subject (the masked page).
 * @param opening The attempt's opening.
 * @param contentEnd Where its end tag starts.
 * @param measure The served encoding's byte measure.
 * @returns The steps (linear in the script: callers ask {@link surelyWithinLimit} first).
 */
export function matchAttemptSteps(
  text: string,
  opening: DelayAttemptOpening,
  contentEnd: number,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  const { m } = attributeShape(text, opening, measure);
  return (
    MATCH_BASE_STEPS + STEP_PER_BYTE * m + contentSteps(text, opening.gt + 1, contentEnd, measure)
  );
}

/**
 * Steps of a failing attempt from its attribute shape.
 *
 * @param shape The attribute group's `k` and `m`.
 * @param shape.k Leading `\s` bytes.
 * @param shape.m Bytes after them.
 * @param runSteps Content steps from the opening's `>` to the end, plus its first byte's reach.
 */
function failedStepsOf(
  shape: { readonly k: number; readonly m: number },
  runSteps: number
): number {
  const { k, m } = shape;
  const empty = k === 0 && m === 0;
  const runs = empty ? 2 : k + 1;
  const fixed = empty ? 11 : k * k + 7 * k + 8 + 2 * (k + 1) * m;
  return fixed + runs * runSteps;
}

/**
 * Steps of an attempt that fails (no end tag after its `>`), given the
 * content steps from its `>` to the end of the subject.
 *
 * @param text The subject.
 * @param opening The attempt's opening.
 * @param tailSteps `contentSteps(text, opening.gt + 1, text.length)`.
 * @param measure The served encoding's byte measure.
 */
export function failedAttemptSteps(
  text: string,
  opening: DelayAttemptOpening,
  tailSteps: number,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  if (failsAtOnce(text, opening, measure)) return 1;
  return failedStepsOf(
    attributeShape(text, opening, measure),
    tailSteps + endTagReach(text, opening.gt + 1)
  );
}

/**
 * Whether a failing attempt ends at once (cost 1): no `>` after its
 * opening, or fewer than 17 bytes left from its `<`.
 *
 * @param text The subject.
 * @param opening The attempt's opening.
 * @param measure The served encoding's byte measure.
 */
export function failsAtOnce(
  text: string,
  opening: DelayAttemptOpening,
  measure: ByteMeasure = UTF8_MEASURE
): boolean {
  if (opening.gt === -1) return true;
  // Every unit is at least one byte: only a short tail needs counting.
  if (text.length - opening.start >= MIN_MATCH_BYTES) return false;
  return unitBytesOf(text, opening.start, text.length, measure) < MIN_MATCH_BYTES;
}

/** The opening of a script in the Delay JS regex (`<\s*script`, ASCII-caseless). */
const SCRIPT_OPENING = new RegExp(`<[${PCRE_SPACE_CHARS}]*[Ss][Cc][Rr][Ii][Pp][Tt]`, 'g');

/** The end of a script in the Delay JS regex. */
const SCRIPT_END = new RegExp(DELAY_SCRIPT_END_SOURCE, 'g');

/**
 * The opening of the next script attempt from `from` (`null` when none).
 * Openings are asked for left to right, so their `>` comes from one
 * shared finder: many openings before one far `>` (or none) cost one
 * search, not one each.
 *
 * @param text The masked page.
 * @param from Where to search.
 * @param gtAfter The page's `>` finder.
 */
function nextOpening(
  text: string,
  from: number,
  gtAfter: NextOccurrence
): DelayAttemptOpening | null {
  SCRIPT_OPENING.lastIndex = from;
  const found = SCRIPT_OPENING.exec(text);
  if (found === null) return null;
  const attrStart = found.index + found[0].length;
  return { start: found.index, attrStart, gt: gtAfter(attrStart) };
}

/**
 * The end tag a script attempt matches up to (`null` when none follows).
 *
 * @param text The masked page.
 * @param opening The attempt's opening (with a `>`).
 */
function endTagAfter(
  text: string,
  opening: DelayAttemptOpening
): { readonly start: number; readonly end: number } | null {
  SCRIPT_END.lastIndex = opening.gt + 1;
  const found = SCRIPT_END.exec(text);
  return found === null ? null : { start: found.index, end: found.index + found[0].length };
}

/**
 * The most steps any failing attempt from `first` on takes: they all read
 * to the end of the subject, so their content steps come from one
 * backward pass, and attributes sharing a `>` from one count — linear.
 *
 * @param text The subject.
 * @param first The first failing attempt's opening (with a `>`).
 * @param measure The served encoding's byte measure.
 * @param gtAfter The page's `>` finder (shared with the caller's search).
 */
export function failingTailSteps(
  text: string,
  first: DelayAttemptOpening,
  measure: ByteMeasure = UTF8_MEASURE,
  gtAfter: NextOccurrence = nextOccurrenceFinder(text, '>')
): number {
  const openings: DelayAttemptOpening[] = [];
  for (let opening = nextOpening(text, first.start, gtAfter); opening !== null;) {
    // No `>` after this opening: none after any later one (each ends at once).
    if (opening.gt === -1) break;
    openings.push(opening);
    opening = nextOpening(text, opening.start + 1, gtAfter);
  }
  let most = 1;
  // Backward: content steps from each `>` to the end, and attribute bytes up to each `>`.
  let steps = 0;
  let stepsFrom = text.length;
  let gt = -1;
  let reach = 0;
  let bytes = 0;
  let bytesFrom = -1;
  for (let index = openings.length - 1; index >= 0; index--) {
    const opening = openings[index] as DelayAttemptOpening;
    if (failsAtOnce(text, opening, measure)) continue;
    if (opening.gt !== gt) {
      steps += contentSteps(text, opening.gt + 1, stepsFrom, measure);
      stepsFrom = opening.gt + 1;
      gt = opening.gt;
      // Once per `>`: openings sharing it would re-read a long `<   /` run each.
      reach = endTagReach(text, gt + 1);
      bytes = 0;
      bytesFrom = gt;
    }
    const after = skipSpaces(text, opening.attrStart);
    bytes += unitBytesOf(text, after, bytesFrom, measure);
    bytesFrom = Math.min(bytesFrom, after);
    const shape = { k: after - opening.attrStart, m: bytes };
    most = Math.max(most, failedStepsOf(shape, steps + reach));
  }
  return most;
}

/**
 * The steps one `preg_replace_callback` search from `from` takes — what
 * `pcre.backtrack_limit` is compared with: its matching attempt's, or the
 * most of its failing attempts' (at least 1, as PCRE counts).
 *
 * @param text The subject.
 * @param from Where the search starts.
 * @param measure The served encoding's byte measure.
 */
export function delaySearchSteps(
  text: string,
  from = 0,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  const gtAfter = nextOccurrenceFinder(text, '>');
  const opening = nextOpening(text, from, gtAfter);
  if (opening === null || opening.gt === -1) return 1;
  const endTag = endTagAfter(text, opening);
  return endTag === null
    ? failingTailSteps(text, opening, measure, gtAfter)
    : matchAttemptSteps(text, opening, endTag.start, measure);
}

/** One script match of the Delay JS regex. */
export interface DelayScriptMatch {
  readonly opening: DelayAttemptOpening;
  readonly contentEnd: number;
  readonly end: number;
}

/**
 * Every script match of the Delay JS regex over the masked page, or
 * `null` when PCRE's backtrack limit makes the whole pass fail.
 *
 * @param text The masked page.
 * @param measure The served encoding's byte measure.
 */
export function delayScriptMatches(
  text: string,
  measure: ByteMeasure = UTF8_MEASURE
): DelayScriptMatch[] | null {
  const gtAfter = nextOccurrenceFinder(text, '>');
  const matches: DelayScriptMatch[] = [];
  let from = 0;
  for (;;) {
    const opening = nextOpening(text, from, gtAfter);
    if (opening === null || opening.gt === -1) return matches;
    const endTag = endTagAfter(text, opening);
    if (endTag === null) {
      return failingTailSteps(text, opening, measure, gtAfter) > PCRE_BACKTRACK_LIMIT
        ? null
        : matches;
    }
    if (
      !surelyWithinLimit(endTag.start - opening.attrStart, measure) &&
      matchAttemptSteps(text, opening, endTag.start, measure) > PCRE_BACKTRACK_LIMIT
    ) {
      return null;
    }
    matches.push({ opening, contentEnd: endTag.start, end: endTag.end });
    from = endTag.end;
  }
}
