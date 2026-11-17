/**
 * The forward Delay JS transform: the page WP Rocket would serve with Delay
 * JS on, from a page served without it — its rocket_buffer work reproduced
 * byte for byte (pure, no I/O): IE conditionals set aside, the Delay JS
 * regex pass over the page (xmp/svg regions masked, each script tested
 * against the exclusion list then the stored rows, delayed scripts
 * rewritten), the runtime and IE fallback injected after the first
 * `<head…>`, `<meta charset>` moved, IE conditionals put back.
 *
 * The runtime, IE fallback and list rows are parameters (the packaged
 * bytes of the simulated WP Rocket version). The transform never writes a
 * `wpr_*` comment or a generator-meta token. A page that already delays
 * (`./already-served`) or is AMP (`./amp`) is returned as is — and so is
 * a page on which one of WP Rocket's other regexes could stop at PCRE's
 * backtrack limit (`./unreproduced-limits`): never an output that might
 * differ from WP Rocket's.
 *
 * Linear in the page on any input (every scan reads each stretch of the
 * page a bounded number of times): it runs synchronously on the
 * document's critical path.
 */
import {
  delayMaskScan,
  delayXmpRegions,
  maskPlaceholder,
  MASK_ID_SENTINEL,
  type MaskedRegion
} from '../exclusion-builder/delay-js-mask';
import { compileDelayRowLookup, type DelayRowLookup } from '../exclusion-builder/delay-js-match';
import { delayAttributeRewrite } from '../exclusion-builder/delay-js-rewrite';
import { ExclusionValidationError, type InvalidExclusionRow } from '../exclusion-builder/errors';
import { scanTags } from '../exclusion-builder/html-scan';
import { scriptProbeBudget } from '../exclusion-builder/pcre/id-probe';
import { translateRegexRows, type TranslatedRow } from '../exclusion-builder/pcre/rows';
import { runtimeParse } from '../exclusion-builder/pcre/translate';
import { DELAY_JS_TYPE_CURRENT } from '../wp-rocket/constants';
import type { MetaCharsetMoveText } from '../wp-rocket/versions';
import { alreadyServesDeferJs, alreadyServesDelayJs } from './already-served';
import { deferJsPasses, type DeferJsPassCounts, type DeferJsPassInput } from './defer-js-forward';
import { isAmpDocument } from './amp';
import { delayJsCaveats, type SimulationCaveat } from './caveats';
import { delayScriptMatches, type DelayScriptMatch } from './delay-js-regex';
import {
  featureBuffer,
  injectIeConditionals,
  scriptConditionalParts,
  type FeatureBuffer
} from './ie-conditionals';
import { metaCharsetSpans, moveMetaCharsetToHead, phpEmpty } from './meta-charset';
import { firstOpeningTag } from './opening-tag';
import { expandPhpReplacement } from './php-replacement';
import {
  ieConditionalScriptSteps,
  ieConditionalsSteps,
  maskSteps,
  metaCharsetWithinCeiling,
  UNREPRODUCED_STEP_CEILING,
  type UnreproducedRegex
} from './unreproduced-limits';
import { UTF8_MEASURE, type ByteMeasure } from './utf8';
import type { SimulationNotApplicableReason, SimulationState } from './spec';

/** What the transform is given: the served page and the simulated version's inputs. */
export interface DelayJsForwardInput {
  /** The page as served (Delay JS off), decoded. */
  readonly html: string;
  /** The Delay JS runtime file's text (`assets/js/lazyload-scripts.min.js`). */
  readonly runtime: string;
  /** The IE fallback script's text (`DelayJS\HTML::get_ie_fallback()`). */
  readonly ieFallback: string;
  /** The dynamic list's `delay_js_exclusions` rows (tested first). */
  readonly listRows: readonly string[];
  /** The stored Delay JS exclusion rows (the settings field; tested after the list). */
  readonly rows: readonly string[];
  /** How the simulated version writes the `<meta charset>` it moves. */
  readonly metaCharsetMoveText: MetaCharsetMoveText;
  /**
   * How many bytes each code unit of `html` was served as — WP Rocket's
   * regexes count bytes (PCRE without UTF), which decides their backtrack
   * limit and the meta pattern's byte rule. Default UTF-8; a page served
   * in another charset passes that charset's measure.
   */
  readonly measure?: ByteMeasure;
  /**
   * Defer JS on too: its passes run first, in the same buffer (inside the
   * same IE conditional extraction), as WP Rocket orders them.
   */
  readonly defer?: DeferJsPassInput;
  /**
   * The buffer the earlier features left on `html` (LazyLoad, its texts
   * placed; Defer JS): the pass continues on it instead of a fresh
   * extraction (`defer` then runs on top of it).
   */
  readonly buffer?: FeatureBuffer;
}

/** What the Defer JS passes did ahead of Delay JS (`already-served`: the page already defers). */
export interface DeferAheadReport extends DeferJsPassCounts {
  readonly state: 'simulated' | 'already-served';
}

/**
 * The transform's outcome on the page: `simulated` (the passes ran),
 * `already-served` (WP Rocket already delays here: identity) or
 * `not-applicable` (identity, see {@link DelayJsNotApplicableReason}) —
 * every step state but `csp-blocked`, which the CSP check decides before
 * the transform runs.
 */
export type DelayJsForwardState = Exclude<SimulationState, 'csp-blocked'>;

/** Why the transform is `not-applicable` (see {@link SimulationNotApplicableReason}). */
export type DelayJsNotApplicableReason = SimulationNotApplicableReason;

/** What the transform did. */
export interface DelayJsForwardReport {
  readonly state: DelayJsForwardState;
  /** Set with `not-applicable` only. */
  readonly reason?: DelayJsNotApplicableReason;
  /** With `beyond-exact-reproduction`: the regex that could stop. */
  readonly unreproducedRegex?: UnreproducedRegex;
  /** Scripts rewritten to the delayed form. */
  readonly delayed: number;
  /** Whether the runtime (and the IE fallback) were injected: the page has a `<head…>` match. */
  readonly runtimeInjected: boolean;
  readonly caveats: readonly SimulationCaveat[];
  /**
   * WP Rocket's Delay JS regex passes PCRE's backtrack limit on this page:
   * like WP Rocket, nothing is delayed (the runtime is still injected).
   */
  readonly regexLimitHit: boolean;
  /**
   * Scripts left as served because whether a row matches them depends on
   * the random ids WP Rocket writes into its mask placeholders (a row
   * spelling those placeholders) — WP Rocket's own outcome varies per load.
   */
  readonly undetermined: number;
  /** With {@link DelayJsForwardInput.defer} on a simulated page: the Defer JS passes. */
  readonly defer?: DeferAheadReport;
}

/** The transform's result. */
export interface DelayJsForwardResult {
  readonly html: string;
  readonly report: DelayJsForwardReport;
}

/** A mask placeholder's text before its id. */
const ID_OFFSET = maskPlaceholder('svg', '').indexOf(' -->');

/** A placeholder with a 13-digit id: the shape this transform writes (see {@link maskIds}). */
const OWN_PLACEHOLDER = /<!-- WPR_(?:SVG|XMP)_(\d{13}) -->/g;

/**
 * A row is never matched by WP Rocket when PCRE rejects its runtime
 * pattern (`preg_match` warns and returns false): proven by the parser.
 *
 * @param row The row.
 */
function runtimeRejects(row: string): boolean {
  return runtimeParse('delay_js', row).issues.some((issue) => issue.kind === 'invalid');
}

/**
 * The reason a row cannot be reproduced.
 *
 * @param row The row's translation.
 */
function unreproducibleReason(row: TranslatedRow): string {
  return (
    row.problem?.reason ??
    'How WP Rocket applies this row is not modeled, so its simulation cannot be reproduced exactly'
  );
}

/**
 * Whether the transform reproduces how WP Rocket applies a row: it has an
 * exact matcher, or PCRE rejects it (it then never matches, as on WP Rocket).
 *
 * @param row The row's translation.
 */
function reproducible(row: TranslatedRow): boolean {
  return row.matcher !== null || runtimeRejects(row.row);
}

/** An exclusion list row the transform cannot reproduce. */
export interface UnreproducibleListRow {
  /** Its index in the list. */
  readonly index: number;
  readonly row: string;
  /** Why its matching is not reproduced. */
  readonly reason: string;
}

/**
 * The first exclusion list row the transform cannot reproduce — the check
 * {@link readForwardRows} makes on the list rows it is given (a list row is
 * translated the same alone or ahead of stored rows: the list comes first),
 * for validating a list before it reaches the transform.
 *
 * @param listRows The list's rows.
 * @returns The row, or null when every row is reproduced.
 */
export function firstUnreproducibleListRow(
  listRows: readonly string[]
): UnreproducibleListRow | null {
  const rows = translateRegexRows('delay_js', listRows).rows;
  const index = rows.findIndex((translated) => !reproducible(translated));
  const translated = rows[index];
  return translated === undefined
    ? null
    : { index, row: translated.row, reason: unreproducibleReason(translated) };
}

/**
 * Read the exclusion list and the stored rows for matching, in WP Rocket's
 * order (list first). A row PCRE rejects never matches, as on WP Rocket.
 *
 * @param listRows The dynamic list's rows.
 * @param rows The stored rows.
 * @returns The lookup over a script's text.
 * @throws {@link ExclusionValidationError} naming every stored row whose
 *   matching cannot be reproduced (by its index among the stored rows).
 * @throws {@link Error} when a list row cannot be reproduced (lists are
 *   validated before they reach the transform).
 */
export function readForwardRows(
  listRows: readonly string[],
  rows: readonly string[]
): DelayRowLookup {
  const translation = translateRegexRows('delay_js', [...listRows, ...rows]);
  const invalid: InvalidExclusionRow[] = [];
  translation.rows.forEach((translated, index) => {
    if (reproducible(translated)) return;
    if (index < listRows.length) {
      throw new Error(
        `Delay JS exclusion list row ${String(index)} (${JSON.stringify(translated.row)}) cannot be reproduced: ${unreproducibleReason(translated)}`
      );
    }
    invalid.push({
      feature: 'delay_js',
      index: index - listRows.length,
      row: translated.row,
      reason: unreproducibleReason(translated),
      ...(translated.problem === null ? {} : { problem: translated.problem.problem })
    });
  });
  if (invalid.length > 0) throw new ExclusionValidationError(invalid);
  return compileDelayRowLookup(translation.rows);
}

/** The page as the Delay JS regex reads it: masked regions as placeholders. */
interface MaskedPage {
  readonly text: string;
  /** Each placeholder written: its offset in {@link text} and its id. */
  readonly placeholders: readonly { readonly at: number; readonly id: string }[];
  /** Placeholder id → the text it is restored to. */
  readonly restore: ReadonlyMap<string, string>;
}

/**
 * Placeholder ids for `count` regions: 13 digits (a valid uniqid shape),
 * none of whose placeholders the page spells itself.
 *
 * @param page The page.
 * @param count How many ids.
 */
function maskIds(page: string, count: number): string[] {
  const spelled = new Set(Array.from(page.matchAll(OWN_PLACEHOLDER), (found) => found[1]));
  const ids: string[] = [];
  for (let next = 0; ids.length < count; next++) {
    const id = String(next).padStart(13, '0');
    if (!spelled.has(id)) ids.push(id);
  }
  return ids;
}

/**
 * Mask a page as WP Rocket does before its Delay JS regex: each xmp region,
 * then each svg region (read with the xmp ones masked), becomes a comment
 * placeholder. WP Rocket restores xmp regions before svg ones, so an xmp
 * region inside an svg one comes back as its placeholder — with this
 * transform's id where WP Rocket writes a random one.
 *
 * @param page The page (IE conditionals set aside).
 * @param regions Its masked regions ({@link delayMaskScan}).
 */
function maskPage(page: string, regions: readonly MaskedRegion[]): MaskedPage {
  if (regions.length === 0) return { text: page, placeholders: [], restore: new Map() };
  const listed = new Set(regions.map((region) => region.start));
  const nested = delayXmpRegions(page).filter((xmp) => !listed.has(xmp.start));
  const ids = maskIds(page, regions.length + nested.length);
  let idIndex = 0;
  const takeId = (): string => ids[idIndex++] ?? '';
  let nestedIndex = 0;
  /** A region's original text, nested xmp regions written as their placeholders. */
  const stored = (region: MaskedRegion): string => {
    let text = '';
    let at = region.start;
    while ((nested[nestedIndex]?.start ?? Infinity) < region.end) {
      const inner = nested[nestedIndex++] as MaskedRegion;
      text += page.slice(at, inner.start) + maskPlaceholder('xmp', takeId());
      at = inner.end;
    }
    return text + page.slice(at, region.end);
  };
  let text = '';
  let at = 0;
  const placeholders: { at: number; id: string }[] = [];
  const restore = new Map<string, string>();
  for (const region of regions) {
    text += page.slice(at, region.start);
    const id = takeId();
    restore.set(id, stored(region));
    placeholders.push({ at: text.length, id });
    text += maskPlaceholder(region.kind, id);
    at = region.end;
  }
  return { text: text + page.slice(at), placeholders, restore };
}

/**
 * Put masked regions back (`restore_xmp_tags` then `restore_svg_tags`).
 *
 * @param text The rewritten masked page.
 * @param restore Placeholder id → original text.
 */
function unmask(text: string, restore: ReadonlyMap<string, string>): string {
  if (restore.size === 0) return text;
  return text.replace(OWN_PLACEHOLDER, (placeholder, id: string) => restore.get(id) ?? placeholder);
}

/**
 * A match's text for row matching: each placeholder id inside it written
 * as the sentinel (WP Rocket's ids are random), and where those ids are.
 *
 * @param masked The masked page.
 * @param start The match start.
 * @param end The match end.
 */
function matchSubject(
  masked: MaskedPage,
  start: number,
  end: number
): { readonly text: string; readonly ids: readonly number[] } {
  let text = '';
  let at = start;
  const ids: number[] = [];
  // Placeholders are in page order: start at the first one at or after `start`.
  let low = 0;
  let high = masked.placeholders.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((masked.placeholders[middle]?.at ?? Infinity) < start) low = middle + 1;
    else high = middle;
  }
  for (let index = low; index < masked.placeholders.length; index++) {
    const placeholder = masked.placeholders[index];
    if (placeholder === undefined || placeholder.at >= end) break;
    const idAt = placeholder.at + ID_OFFSET;
    text += masked.text.slice(at, idAt);
    ids.push(text.length);
    text += MASK_ID_SENTINEL;
    at = idAt + MASK_ID_SENTINEL.length;
  }
  return { text: text + masked.text.slice(at, end), ids };
}

/**
 * A script as WP Rocket's `replace_scripts` writes it, before rows: the
 * delayed form, or `null` when its type keeps it as served.
 *
 * @param text The masked page.
 * @param match The script's match.
 */
function delayedForm(text: string, match: DelayScriptMatch): string | null {
  const attributes = text.slice(match.opening.attrStart, match.opening.gt);
  const content = text.slice(match.opening.gt + 1, match.contentEnd);
  if (phpEmpty(attributes)) return `<script type="${DELAY_JS_TYPE_CURRENT}">${content}</script>`;
  const rewritten = delayAttributeRewrite(attributes);
  return rewritten === null
    ? null
    : `<script type="${DELAY_JS_TYPE_CURRENT}" ${rewritten}>${content}</script>`;
}

/** The Delay JS regex pass's outcome. */
interface DelayPass {
  readonly html: string;
  readonly delayed: number;
  readonly regexLimitHit: boolean;
  readonly undetermined: number;
}

/**
 * WP Rocket's Delay JS regex pass (`DelayJS\HTML::parse`) over a page.
 *
 * @param page The page (IE conditionals set aside).
 * @param regions Its masked regions.
 * @param lookup The rows' lookup.
 * @param measure The served encoding's byte measure.
 */
function delayPass(
  page: string,
  regions: readonly MaskedRegion[],
  lookup: DelayRowLookup,
  measure: ByteMeasure
): DelayPass {
  const unchanged = (regexLimitHit: boolean): DelayPass => ({
    html: page,
    delayed: 0,
    regexLimitHit,
    undetermined: 0
  });
  if (phpEmpty(page)) return unchanged(false);
  const masked = maskPage(page, regions);
  const matches = delayScriptMatches(masked.text, measure);
  if (matches === null) return unchanged(true);
  let out = '';
  let at = 0;
  let delayed = 0;
  let undetermined = 0;
  for (const match of matches) {
    out += masked.text.slice(at, match.opening.start);
    at = match.end;
    const original = masked.text.slice(match.opening.start, match.end);
    const form = delayedForm(masked.text, match);
    // A script its type keeps as served stays so whatever the rows say.
    if (form === null) {
      out += original;
      continue;
    }
    const subject = matchSubject(masked, match.opening.start, match.end);
    const row = lookup(subject.text, subject.ids, scriptProbeBudget());
    if (row === null) undetermined++;
    if (row === -1) delayed++;
    out += row === -1 ? form : original;
  }
  out += masked.text.slice(at);
  if (phpEmpty(out)) return unchanged(false);
  return { html: unmask(out, masked.restore), delayed, regexLimitHit: false, undetermined };
}

/**
 * Insert a script after the first `<head…>` (`preg_replace` with
 * `$0<script>…</script>`, limit 1): the script text is read as replacement
 * syntax, as WP Rocket's interpolation makes it.
 *
 * @param html The page.
 * @param script The script's text.
 * @returns The page, or `null` when it has no `<head…>`.
 */
function insertAfterHead(html: string, script: string): string | null {
  // `/<head[^>]*>/i`.
  const head = firstOpeningTag(html, 'head', false);
  if (head === null) return null;
  const opening = html.slice(head.start, head.end);
  const written = expandPhpReplacement(`$0<script>${script}</script>`, [opening]);
  return html.slice(0, head.start) + written + html.slice(head.end);
}

/** `add_delay_js_script`'s injection, before its meta charset move. */
interface DelayScriptsInjection {
  readonly html: string;
  readonly runtimeInjected: boolean;
  /** Whether the meta charset move runs next (PHP returns early on an empty page). */
  readonly movesMeta: boolean;
}

/**
 * WP Rocket's `add_delay_js_script` up to its meta charset move: the
 * runtime, then the IE fallback (which lands before it), after the first
 * `<head…>`.
 *
 * @param html The page after the regex pass.
 * @param runtime The runtime's text.
 * @param ieFallback The IE fallback's text.
 */
function injectDelayScripts(
  html: string,
  runtime: string,
  ieFallback: string
): DelayScriptsInjection {
  const unchanged = { html, runtimeInjected: false, movesMeta: false };
  const withRuntime = insertAfterHead(html, runtime);
  if (withRuntime !== null && phpEmpty(withRuntime)) return unchanged;
  const withFallback = insertAfterHead(withRuntime ?? html, ieFallback);
  const injected = withFallback ?? withRuntime ?? html;
  if (phpEmpty(injected)) return unchanged;
  return { html: injected, runtimeInjected: withRuntime !== null, movesMeta: true };
}

/**
 * The regex (if any) besides the Delay JS one whose backtrack limit could
 * change WP Rocket's output, among those read before the meta move: the
 * IE-conditional extraction, a script conditional's re-injection reading,
 * the xmp or svg mask.
 *
 * @param conditionals The page's conditionals (extracted).
 * @param conditionalsSteps The extraction's estimate.
 * @param masks The masks' estimates on the extracted page.
 * @param masks.xmp The xmp mask's.
 * @param masks.svg The svg mask's.
 * @param measure The served encoding's byte measure.
 */
function unreproducedBeforeMetaMove(
  conditionals: readonly string[],
  conditionalsSteps: number,
  masks: { readonly xmp: number; readonly svg: number },
  measure: ByteMeasure
): UnreproducedRegex | null {
  if (conditionalsSteps > UNREPRODUCED_STEP_CEILING) return 'ie-conditionals';
  for (const conditional of conditionals) {
    const parts = scriptConditionalParts(conditional);
    if (
      parts !== null &&
      ieConditionalScriptSteps(conditional, parts, measure) > UNREPRODUCED_STEP_CEILING
    ) {
      return 'ie-conditional-script';
    }
  }
  if (masks.xmp > UNREPRODUCED_STEP_CEILING) return 'xmp-mask';
  if (masks.svg > UNREPRODUCED_STEP_CEILING) return 'svg-mask';
  return null;
}

/**
 * Simulate WP Rocket's Delay JS on a page served without it.
 *
 * @param input The page and the simulated version's runtime, fallback and rows.
 * @returns The page WP Rocket would serve, and the report.
 * @throws {@link ExclusionValidationError} naming stored rows whose matching
 *   cannot be reproduced; {@link Error} for such a list row.
 */
export function simulateDelayJs(input: DelayJsForwardInput): DelayJsForwardResult {
  const measure = input.measure ?? UTF8_MEASURE;
  const tags = scanTags(input.html);
  const identity = (
    state: DelayJsForwardState,
    why: Pick<DelayJsForwardReport, 'reason' | 'unreproducedRegex'> = {}
  ): DelayJsForwardResult => ({
    html: input.html,
    report: {
      state,
      ...why,
      delayed: 0,
      runtimeInjected: false,
      caveats: [],
      regexLimitHit: false,
      undetermined: 0
    }
  });
  const beyond = (regex: UnreproducedRegex): DelayJsForwardResult =>
    identity('not-applicable', { reason: 'beyond-exact-reproduction', unreproducedRegex: regex });
  if (isAmpDocument(input.html, tags)) return identity('not-applicable', { reason: 'amp' });
  if (alreadyServesDelayJs(input.html, tags)) return identity('already-served');
  const lookup = readForwardRows(input.listRows, input.rows);
  const buffer = featureBuffer(input.html, input.buffer);
  let page = buffer.html;
  let defer: DeferAheadReport | undefined;
  if (input.defer !== undefined) {
    if (alreadyServesDeferJs(tags)) {
      defer = { state: 'already-served', deferred: 0, wrapped: 0 };
    } else {
      const passes = deferJsPasses(page, input.defer, measure);
      if ('beyond' in passes) return beyond(passes.beyond);
      page = passes.html;
      defer = { state: 'simulated', deferred: passes.deferred, wrapped: passes.wrapped };
    }
  }
  const masks = delayMaskScan(page);
  const unreproduced = unreproducedBeforeMetaMove(
    buffer.conditionals,
    ieConditionalsSteps(input.html, buffer.scan, measure),
    maskSteps(page, masks, measure),
    measure
  );
  if (unreproduced !== null) return beyond(unreproduced);
  const pass = delayPass(page, masks.regions, lookup, measure);
  const injected = injectDelayScripts(pass.html, input.runtime, input.ieFallback);
  let added = injected.html;
  if (injected.movesMeta && metaCharsetSpans(added, measure).length > 0) {
    // A page whose metas the pattern never matches is left as is either way.
    if (!metaCharsetWithinCeiling(added, measure)) return beyond('meta-charset');
    added = moveMetaCharsetToHead(added, input.metaCharsetMoveText, measure);
  }
  return {
    html: injectIeConditionals(added, buffer.conditionals),
    report: {
      state: 'simulated',
      delayed: pass.delayed,
      runtimeInjected: injected.runtimeInjected,
      caveats: delayJsCaveats(tags),
      regexLimitHit: pass.regexLimitHit,
      undetermined: pass.undetermined,
      ...(defer === undefined ? {} : { defer })
    }
  };
}
