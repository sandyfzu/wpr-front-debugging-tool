/**
 * The WP Rocket regexes besides the Delay JS one that PCRE's backtrack
 * limit could stop on a pathological page: the IE-conditional pattern
 * (extraction, then each script conditional's re-injection reading), the
 * xmp and svg masks, and the `<meta charset>` pattern. Their failure modes
 * are not reproduced; instead each one's costliest attempt gets an upper
 * estimate of the steps PCRE's JIT counts, and a page whose estimate passes
 * {@link UNREPRODUCED_STEP_CEILING} is not simulated at all (identity),
 * so the transform never emits a page WP Rocket might serve differently.
 *
 * Estimates were fitted on the plugin (`pcre.backtrack_limit` bisected per
 * subject under `php -n -d pcre.jit=1`, PHP 8.1 / PCRE2 10.49) and checked
 * to stay at or above its count on random subjects; the ceiling is half
 * the limit, the margin for other PCRE builds. Each is linear in the page.
 */
import { asciiCaselessAt, skipSpaces } from './pcre-text';
import { PCRE_BACKTRACK_LIMIT } from './delay-js-regex';
import { metaCharsetCost } from './meta-charset-cost';
import { byteLength, byteView, UTF8_MEASURE, type ByteMeasure } from './utf8';
import type { ConditionalScan, ScriptConditionalParts } from './ie-conditionals';
import { delayXmpRegions, type DelayMaskScan } from '../exclusion-builder/delay-js-mask';

/**
 * The most estimated steps a regex attempt may take for the page to be
 * simulated: half PHP's default `pcre.backtrack_limit`.
 */
export const UNREPRODUCED_STEP_CEILING = PCRE_BACKTRACK_LIMIT / 2;

/** A WP Rocket regex whose backtrack-limit failure is not reproduced. */
export type UnreproducedRegex =
  'ie-conditionals' | 'ie-conditional-script' | 'xmp-mask' | 'svg-mask' | 'meta-charset';

/** Steps any attempt costs besides its bytes (measured: 2–13). */
const ATTEMPT_OVERHEAD = 16;

/**
 * The IE-conditional pattern (`/<!--\[if[^\]]*?\]>.*?<!\[endif\]-->/is`)
 * costs one step per byte its lazy body reads (measured exact): its
 * costliest attempt is the longest conditional, or the first opening with
 * no end, read to the end of the page.
 *
 * @param html The page.
 * @param scan Its conditional scan.
 * @param measure The served encoding's byte measure.
 */
export function ieConditionalsSteps(
  html: string,
  scan: ConditionalScan,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  let most = 0;
  for (const [start, end] of scan.spans) {
    most = Math.max(most, byteLength(html, start, end, measure) + ATTEMPT_OVERHEAD);
  }
  if (scan.unclosed !== -1) {
    most = Math.max(most, byteLength(html, scan.unclosed, html.length, measure) + ATTEMPT_OVERHEAD);
  }
  return most;
}

/** Steps per byte of a script conditional's reading (measured: 2–3.2, up to ~10 with spaced `</script>`s). */
const SCRIPT_CONDITIONAL_STEPS_PER_BYTE = 8;

/** Steps per square of the whitespace after an inner `</script>` (measured: 1.5–2.3). */
const SCRIPT_CONDITIONAL_RUN_WEIGHT = 3;

/** The whitespace pieces after an inner `</script>` are counted with this slack. */
const SCRIPT_CONDITIONAL_RUN_SLACK = 5;

/**
 * The re-injection reading of a conditional holding a script with
 * attributes (only a matching one matters: a non-match keeps the
 * conditional whether PCRE gave up or not). Linear in its bytes, except
 * that after each `</script>` inside its content PCRE re-reads the
 * whitespace run (and the one after a following `<!--`) once per split of
 * it: quadratic in those runs.
 *
 * @param conditional The conditional.
 * @param parts Its parts ({@link ScriptConditionalParts}).
 * @param measure The served encoding's byte measure.
 */
export function ieConditionalScriptSteps(
  conditional: string,
  parts: ScriptConditionalParts,
  measure: ByteMeasure = UTF8_MEASURE
): number {
  let steps =
    SCRIPT_CONDITIONAL_STEPS_PER_BYTE * byteLength(conditional, 0, conditional.length, measure) +
    ATTEMPT_OVERHEAD;
  for (
    let at = conditional.indexOf('</', parts.contentStart);
    at !== -1 && at < parts.closingStart;
    at = conditional.indexOf('</', at + 1)
  ) {
    if (!asciiCaselessAt(conditional, at, '</script>')) continue;
    const afterRun = skipSpaces(conditional, at + '</script>'.length);
    let runs = afterRun - at - '</script>'.length;
    if (conditional.startsWith('<!--', afterRun)) {
      runs += skipSpaces(conditional, afterRun + 4) - afterRun - 4;
    }
    steps += SCRIPT_CONDITIONAL_RUN_WEIGHT * (runs + SCRIPT_CONDITIONAL_RUN_SLACK) ** 2;
  }
  return steps;
}

/** Steps per `<` a mask regex reads on top of its bytes (measured: up to 3). */
const MASK_STEPS_PER_LT = 4;

/** Steps per byte of a failing mask attempt (measured: 2). */
const MASK_FAILING_STEPS_PER_BYTE = 2;

/** The bytes an xmp placeholder adds to the text the svg regex reads, with its `<`. */
const XMP_PLACEHOLDER_STEPS = 32 + MASK_STEPS_PER_LT;

/**
 * The costliest attempt of the xmp and svg mask regexes (`#<xmp.*>.*</xmp>#Uis`,
 * `#<\s*svg.*>.*<\s*\\?/\s*svg\s*>#Uis`): a matching one reads its region
 * once (1 step per byte, more per `<`), the failing one after the last
 * match reads to the end of the text twice. The svg regex reads the page
 * with xmp regions as placeholders: each one it reads also counted at a
 * placeholder's cost (on top of the xmp region's own bytes).
 *
 * @param html The page the masks read.
 * @param scan Its mask scan.
 * @param measure The served encoding's byte measure.
 * @returns Each regex's estimate.
 */
export function maskSteps(
  html: string,
  scan: DelayMaskScan,
  measure: ByteMeasure = UTF8_MEASURE
): { readonly xmp: number; readonly svg: number } {
  // Every xmp region, those inside svg regions included, in page order.
  const xmpStarts = delayXmpRegions(html).map((region) => region.start);
  let xmpIndex = 0;
  /**
   * The xmp regions starting in `[from, to)` (asked in page order).
   *
   * @param from Range start.
   * @param to Range end.
   */
  const xmpWithin = (from: number, to: number): number => {
    while ((xmpStarts[xmpIndex] ?? Infinity) < from) xmpIndex++;
    let count = 0;
    while ((xmpStarts[xmpIndex + count] ?? Infinity) < to) count++;
    return count;
  };
  /**
   * Upper steps of reading `[from, to)`.
   *
   * @param from Range start.
   * @param to Range end.
   * @param perByte Steps per byte.
   */
  const read = (from: number, to: number, perByte: number): number => {
    let lts = 0;
    for (let at = html.indexOf('<', from); at !== -1 && at < to; at = html.indexOf('<', at + 1)) {
      lts++;
    }
    return perByte * byteLength(html, from, to, measure) + MASK_STEPS_PER_LT * lts;
  };
  let xmp = 0;
  let svg = 0;
  for (const region of scan.regions) {
    const steps = read(region.start, region.end, 1) + ATTEMPT_OVERHEAD;
    if (region.kind === 'xmp') xmp = Math.max(xmp, steps);
    else svg = Math.max(svg, steps + XMP_PLACEHOLDER_STEPS * xmpWithin(region.start, region.end));
  }
  if (scan.unclosed.xmp !== -1) {
    const tail = read(scan.unclosed.xmp, html.length, MASK_FAILING_STEPS_PER_BYTE);
    xmp = Math.max(xmp, tail + ATTEMPT_OVERHEAD);
  }
  if (scan.unclosed.svg !== -1) {
    const tail = read(scan.unclosed.svg, html.length, MASK_FAILING_STEPS_PER_BYTE);
    const placeholders = xmpWithin(scan.unclosed.svg, html.length);
    svg = Math.max(svg, tail + XMP_PLACEHOLDER_STEPS * placeholders + ATTEMPT_OVERHEAD);
  }
  return { xmp, svg };
}

/** Pattern nodes the meta-charset exploration may visit (bounds its own run time). */
const META_EXPLORATION_WORK = 4_000_000;

/**
 * Whether the `<meta charset>` pattern stays surely within the ceiling on
 * the page: every attempt's explored steps ({@link metaCharsetCost}, an
 * upper estimate — measured at or above PCRE's count) at most the
 * ceiling, and the exploration not cut short.
 *
 * @param html The page the pattern reads (after the Delay JS injection).
 * @param measure The served encoding's byte measure.
 */
export function metaCharsetWithinCeiling(
  html: string,
  measure: ByteMeasure = UTF8_MEASURE
): boolean {
  const cost = metaCharsetCost(byteView(html, measure), {
    attempt: UNREPRODUCED_STEP_CEILING,
    work: META_EXPLORATION_WORK
  });
  return cost.complete && cost.mostSteps <= UNREPRODUCED_STEP_CEILING;
}
