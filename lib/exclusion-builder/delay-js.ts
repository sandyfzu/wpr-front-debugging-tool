/**
 * The Delay JS transform: restores live scripts from WP Rocket's served
 * delayed markup, and — under the feature-wide disable — removes the three
 * controller scripts the feature serves. Candidates are scripts whose
 * `type` is a delay type or that carry the delay controller's runtime
 * status marker; rows match the whole script element as WP Rocket's
 * runtime does (`./delay-js-match`: each row alone, ASCII-case-insensitive,
 * against the element as it was before delaying); the restore follows the controller's own
 * runtime semantics — `type` reclaims `data-rocket-type`'s value (dropped
 * entirely when the original had none) and `src` reclaims `data-rocket-src`.
 *
 * Reach: script elements only. WP Rocket's Delay regex also rewrites script
 * text inside HTML comments, so a matching row leaves those copies
 * original there; here they stay as served. A comment never runs, so the
 * page behaves the same. The same holds for raw script markup inside an
 * attribute value (`data-s='<script src=…></script>'`, never written by
 * WordPress's attribute escaping): it stays delayed here, which differs
 * only when page code injects that value with a script-running API — or
 * when the rewrite broke the value's quoting (a double-quoted value
 * gains `type="…"`), whose break the preview keeps. Mirroring the regex
 * would mean restoring regex regions of raw text, which can span past
 * the comment or attribute that holds them.
 */
import {
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  INLINE_WRAP_OPEN,
  isDelayJSType
} from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import type { ParsedTag, ScannedTag } from './html-scan';
import { PCRE_SPACE_CHARS } from './pcre/byte-set';
import { scriptProbeBudget, type ProbeBudget } from './pcre/id-probe';
import {
  delayMaskedRegions,
  firstRegionFrom,
  maskedForMatching,
  type MaskedRegion
} from './delay-js-mask';
import {
  readDelayRows,
  DELAY_TYPE_ATTRIBUTE,
  type DelayRowMatch,
  type DelayVerdict
} from './delay-js-match';
import {
  hasSpanningWrapper,
  inlinePassUnder,
  spanningWrapperReading,
  unwrapInlineScripts,
  type InlinePass,
  type InlinePassReplay
} from './defer-inline-js';
import { transformReport, type TransformResult } from './report';
import {
  addAttributeValue,
  applyPatches,
  findAttribute,
  removeAttribute,
  setAttributeValue,
  stampExclusionMarker,
  type TextPatch
} from './tag-edit';
import type { ExclusionFeatureId, ExclusionSet } from './set';

/** The delay controller's runtime status marker — a snapshot's delayed-script evidence. */
export const DELAY_STATUS_ATTRIBUTE = 'data-rocket-status';

const FEATURE: ExclusionFeatureId = 'delay_js';
const TYPE_ATTRIBUTE = 'type';
const SRC_ATTRIBUTE = 'src';

/**
 * The plugin's mobile-redirect bootstrap: a UA sniff plus the
 * `?nowprocket=1` cookie/redirect it performs — the script the feature-wide
 * disable removes so the reload stays un-delayed.
 */
const UA_REDIRECT_SCRIPT_PATTERN = /navigator\.userAgent\.match((.|\n|\r)*)\?nowprocket=1/;

/**
 * The inline delay controller's run invocation — removing the invocation
 * script stops the whole delay machinery on the reloaded page.
 */
export const CONTROLLER_RUN_MARKER = `${DELAY_JS_CONTROLLER}.run`;

/** The Elementor animation helper the plugin serves alongside Delay JS. */
const ELEMENTOR_ANIMATION_RUN_MARKER = 'RocketElementorAnimation.run';

/**
 * The end of a script in WP Rocket's Delay JS regex
 * (`<\s*script(…)?>(?<content>.*?)?<\s*\/\s*script\s*>`, `ims`): PCRE's
 * `\s` (no UTF) and an ASCII-caseless `script`, written out.
 */
export const DELAY_SCRIPT_END_SOURCE = `<[${PCRE_SPACE_CHARS}]*\\/[${PCRE_SPACE_CHARS}]*[Ss][Cc][Rr][Ii][Pp][Tt][${PCRE_SPACE_CHARS}]*>`;

/** {@link DELAY_SCRIPT_END_SOURCE}, global (this module's searches). */
const DELAY_SCRIPT_END = new RegExp(DELAY_SCRIPT_END_SOURCE, 'g');

/**
 * The script as WP Rocket's Delay JS matched it: from its `<script` to the
 * first end tag that regex accepts after the opening tag's first `>`. HTML
 * also ends a script at `</script` followed by `/` or anything before the
 * `>` (`</script/>`, `</script x>`), which the regex refuses: it reads on
 * to a later end tag, so its match — the text a row is tested against, and
 * what an excluded match leaves as it was — takes in the scripts until
 * then (it delays the first one's opening tag only, so the served page
 * keeps the odd end tag and those scripts undelayed). Delay JS reads the
 * page with its masked regions as placeholders (`./delay-js-mask`): an end
 * tag inside one does not end the match, and a region starting before the
 * opening tag's first `>` ends the opening with its placeholder's `-->`.
 * Otherwise the match is the HTML element.
 *
 * @param html The served page.
 * @param tag A script the served page delays (its match started there).
 * @param regions The page's masked regions, in page order.
 * @returns Where the match's content ends, where it ends, and the regions it holds.
 */
export function delayScriptMatch(
  html: string,
  tag: ScannedTag,
  regions: readonly MaskedRegion[] = []
): DelayScriptMatch {
  const element = { contentEnd: tag.contentEnd, end: tag.end };
  const gt = html.indexOf('>', tag.start);
  // Regions are in page order and never overlap: found by binary search.
  const first = firstRegionFrom(regions, tag.start + 1);
  const next = regions[first];
  const opening = next !== undefined && (gt === -1 || next.start < gt) ? next : undefined;
  let from = opening?.end ?? (gt === -1 ? tag.openingEnd : gt + 1);
  let match: RegExpExecArray | null = null;
  for (;;) {
    DELAY_SCRIPT_END.lastIndex = from;
    match = DELAY_SCRIPT_END.exec(html);
    if (match === null) break;
    const hidden = regions[firstRegionFrom(regions, match.index + 1) - 1];
    if (hidden === undefined || hidden.end <= match.index) break;
    from = hidden.end;
  }
  // The served end tag of a delayed script is one WP Rocket wrote (`</script>`):
  // a match ending before it would mean the page was not delayed this way.
  const span =
    match === null || match.index < tag.contentEnd
      ? element
      : { contentEnd: match.index, end: match.index + match[0].length };
  let last = first;
  while (last < regions.length && (regions[last]?.end ?? Infinity) <= span.end) last++;
  return { ...span, regions: regions.slice(first, last) };
}

/**
 * Where WP Rocket's script regexes start a script's body: just past the
 * opening tag's first `>`, quoted or not (`<script[^>]*>`) — inside an
 * attribute value when one holds a `>`. The HTML body start when that `>`
 * is past the match's content end (not WP Rocket's reading of this tag).
 *
 * @param html The page.
 * @param tag The script.
 * @param contentEnd Where its match's content ends.
 */
export function wpBodyStart(html: string, tag: ScannedTag, contentEnd: number): number {
  const gt = html.indexOf('>', tag.start);
  return gt === -1 || gt + 1 > contentEnd ? tag.openingEnd : gt + 1;
}

/** A delayed script as WP Rocket's Delay JS matched it (see {@link delayScriptMatch}). */
export interface DelayScriptMatch {
  readonly contentEnd: number;
  readonly end: number;
  /** The masked regions the match holds (read as placeholders). */
  readonly regions: readonly MaskedRegion[];
}

/**
 * Whether a scanned script is delayed: its `type` is one of the served
 * delay types (case-sensitively, per the shared footprint check), or it
 * carries the controller's runtime status marker (a live-DOM snapshot of a
 * delayed script — the served markup never has the marker).
 *
 * @param tag The scanned script tag.
 */
function isDelayedScript(tag: ParsedTag): boolean {
  const type = findAttribute(tag, TYPE_ATTRIBUTE);
  if (type?.value != null && isDelayJSType(type.value)) return true;
  return findAttribute(tag, DELAY_STATUS_ATTRIBUTE) !== null;
}

/**
 * Restore one script's opening tag to a live script — the controller's
 * runtime semantics, as string edits:
 *
 * - a still-delayed `type` reclaims `data-rocket-type`'s value, or is
 *   removed entirely when the original had none (the controller sets none
 *   either) — an empty `data-rocket-type` counts as none;
 * - `src` reclaims `data-rocket-src` (added, or overwritten when a plain
 *   `src` also survived) — but only for a non-empty carrier: an empty or
 *   valueless `data-rocket-src` is treated as absent (kept, nothing
 *   restored);
 * - the consumed data attributes are dropped.
 *
 * @param tagText The script's opening-tag text.
 * @returns The restored tag text; unchanged when there is nothing to restore.
 */
function restoreDelayedScript(tagText: string): string {
  let text = tagText;
  const parsed = parseTagAt(text, 0);
  const declaredType = findAttribute(parsed, DELAY_TYPE_ATTRIBUTE);
  const typeAttr = findAttribute(parsed, TYPE_ATTRIBUTE);
  if (typeAttr?.value != null && isDelayJSType(typeAttr.value)) {
    text = declaredType?.value
      ? setAttributeValue(text, TYPE_ATTRIBUTE, declaredType.value)
      : removeAttribute(text, TYPE_ATTRIBUTE);
    if (declaredType !== null) text = removeAttribute(text, DELAY_TYPE_ATTRIBUTE);
  }
  const rocketSrc = findAttribute(parseTagAt(text, 0), DELAY_JS_SRC);
  if (rocketSrc?.value) {
    text =
      findAttribute(parseTagAt(text, 0), SRC_ATTRIBUTE) !== null
        ? setAttributeValue(text, SRC_ATTRIBUTE, rocketSrc.value)
        : addAttributeValue(text, SRC_ATTRIBUTE, rocketSrc.value);
    text = removeAttribute(text, DELAY_JS_SRC);
  }
  return text;
}

/** How Delay JS reads inline bodies, given the Defer JS inline pass under the set. */
interface InlineReading {
  /** The pass's outcome (see `verdictAfterInlinePass`). */
  readonly pass: InlinePass;
  /** The page holds a wrapper that may span scripts, and the pass may not run. */
  readonly spanning: boolean;
}

/**
 * Delay JS's verdict on one served element as WP Rocket's Delay JS saw it,
 * after the Defer JS inline pass: wrapped while the pass runs, unwrapped
 * when it is skipped; when the pass's outcome is unknown both readings must
 * agree, else the verdict is undetermined. A script a wrapper may span
 * (`spanned`: the element without the wrapper's opening or closing) adds
 * that reading, which must agree too.
 *
 * @param matchRow The compiled rows.
 * @param element The served script element.
 * @param pass The inline pass's outcome under the set.
 * Each reading is built from the page text, then masked on its own: Delay
 * JS masked the page the pass left, and a wrapper's parts may sit inside a
 * masked region (masking first would hide them from the unwrap).
 *
 * @param matchRow The compiled rows.
 * @param element The served script element (WP Rocket's match, unmasked).
 * @param pass The inline pass's outcome under the set.
 * @param spanned The element read without a spanning wrapper's part, or `null`.
 * @param budget The script's id-probe budget when its match holds masked
 *   regions (shared by all its readings), else `null`.
 * @returns The verdict (`null` when undetermined).
 */
function verdictAfterInlinePass(
  matchRow: DelayRowMatch,
  element: string,
  pass: InlinePass,
  spanned: string | null,
  budget: ProbeBudget | null
): DelayVerdict {
  const readings = pass === 'runs' ? [element] : [];
  if (pass !== 'runs') {
    const unwrapped = unwrapInlineScripts(element).html;
    readings.push(...(pass === 'skipped' ? [unwrapped] : [element, unwrapped]));
    if (spanned !== null) readings.push(spanned);
  }
  const subjects = [...new Set(readings)].map((reading) =>
    budget === null ? { text: reading, ids: [] } : asDelayJsReadIt(reading)
  );
  return agreedAcross(subjects.map(({ text, ids }) => matchRow(text, ids, budget ?? undefined)));
}

/**
 * A match's text as Delay JS read it: each masked region a placeholder
 * whose id is the unknowable sentinel, with where the ids are. The regions
 * are found on the text itself: none straddles a delayed match's ends (it
 * would have hidden its opening or its end tag), so they are the page's
 * within it.
 *
 * @param text The match's text (from its `<script`).
 */
function asDelayJsReadIt(text: string): { readonly text: string; readonly ids: readonly number[] } {
  return maskedForMatching(text);
}

/**
 * The verdict several readings of one script agree on — matched or not —
 * with the first reading's row, approximate when any reading is.
 *
 * @param verdicts The readings' verdicts (≥ 1).
 * @returns That verdict, or `null` (undetermined) when any is or they disagree.
 */
function agreedAcross(verdicts: readonly DelayVerdict[]): DelayVerdict {
  const [first] = verdicts;
  if (first == null) return null;
  let approximate = false;
  for (const verdict of verdicts) {
    if (verdict === null || (verdict.row === -1) !== (first.row === -1)) return null;
    approximate ||= verdict.approximate;
  }
  return { row: first.row, approximate };
}

/**
 * The Delay JS transform: `servedHtml` + the exclusion set → the html with
 * matched delayed scripts restored to live scripts, plus the transform's
 * report. Rows are validated before anything runs (all of them named on
 * failure), and the restore stamps the exclusion marker as CSV on every
 * rewritten script — never on a candidate the controller had already
 * restored at runtime. Under the feature-wide disable, the plugin's three
 * controller scripts (the UA `?nowprocket=1` redirect bootstrap, the delay
 * controller's run invocation, the Elementor animation helper) are removed
 * outright — the first of each kind only — and everything else is restored.
 *
 * WP Rocket delays scripts after its Defer JS inline-jQuery pass, so a row
 * sees an inline body as that pass left it under the set's Defer JS rows and
 * toggle (see `verdictAfterInlinePass`).
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Delay JS rows + toggle slice; Defer JS rows + toggle).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Delay JS row blocks (a row
 *   matching every script only warns: it is applied, as on WP Rocket).
 */
export function delayJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const pass = inlinePassUnder(set);
  const spanning = pass !== 'runs' && hasSpanningWrapper(servedHtml);
  return delayAfterInlinePass(servedHtml, set, { pass, spanning });
}

/**
 * The Delay JS transform over a page whose inline pass was already replayed
 * (the pipeline replays it first): a skipped pass is already undone there,
 * so elements are read as they stand, or both ways while it is unknown.
 *
 * @param html The page after the replay.
 * @param set The exclusion set.
 * @param inline The replay's result.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} as {@link delayJsTransform}.
 */
export function delayJsTransformAfterInlinePass(
  html: string,
  set: ExclusionSet,
  inline: InlinePassReplay
): TransformResult {
  return delayAfterInlinePass(html, set, {
    pass: inline.undetermined > 0 ? 'unknown' : 'runs',
    spanning: inline.spanned > 0
  });
}

/**
 * The Delay JS transform's body (see {@link delayJsTransform}).
 *
 * @param servedHtml The page.
 * @param set The exclusion set.
 * @param inline How to read wrapped inline bodies (see `verdictAfterInlinePass`).
 * @returns The rewritten html and the report.
 */
function delayAfterInlinePass(
  servedHtml: string,
  set: ExclusionSet,
  inline: InlineReading
): TransformResult {
  const rows = set.rows.delayJs;
  const { match: matchRow, matchAllRows } = readDelayRows(rows);
  const featureWide = set.disable.delayJs;
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  let regionRemovals = 0;
  let undetermined = 0;
  let approximate = 0;
  // Each controller script is removed once — the first of its kind (the
  // tool's own disable semantics; duplicates are just scripts after that).
  let redirectScriptRemoved = false;
  let controllerScriptRemoved = false;
  let elementorScriptRemoved = false;
  // Whether an earlier script opens the wrapper (a later one may hold its closing).
  let afterOpening = false;
  // The regions Delay JS read as placeholders (see `./delay-js-mask`).
  const regions = delayMaskedRegions(servedHtml);
  const tags = [...scanTags(servedHtml)];
  // A delayed script is read as WP Rocket's regex matched it (see `delayScriptMatch`).
  const matches = tags.map((tag): DelayScriptMatch =>
    tag.name === 'script' && isDelayedScript(tag)
      ? delayScriptMatch(servedHtml, tag, regions)
      : { contentEnd: tag.contentEnd, end: tag.end, regions: [] }
  );
  // Each masked script gets an even share of the id-probe work: its answer
  // never depends on the other scripts or their order.
  const maskedScripts = matches.filter((match) => match.regions.length > 0).length;
  for (const [index, tag] of tags.entries()) {
    const match = matches[index] ?? { contentEnd: tag.contentEnd, end: tag.end, regions: [] };
    // A spanning wrapper's other reading of the body: its range in the page.
    let spannedBody: readonly [number, number] | null = null;
    // Where WP Rocket's script match reads the body from: the opening tag's
    // first `>`, quoted or not — a wrapper written into an attribute value
    // (its page-wide replace reaches attribute copies) opens the body there.
    const bodyStart = wpBodyStart(servedHtml, tag, match.contentEnd);
    if (inline.spanning && tag.name === 'script') {
      const body = servedHtml.slice(bodyStart, match.contentEnd);
      const reading = spanningWrapperReading(body, afterOpening);
      afterOpening ||= body.startsWith(INLINE_WRAP_OPEN);
      if (reading !== null) {
        spannedBody =
          reading.length < body.length && body.startsWith(INLINE_WRAP_OPEN)
            ? [bodyStart + INLINE_WRAP_OPEN.length, match.contentEnd]
            : [bodyStart, bodyStart + reading.length];
      }
    }
    if (featureWide && tag.name === 'script') {
      // The controller markers live in the script's raw content only —
      // never in its markup — so the content text is the test subject.
      const content = servedHtml.slice(tag.openingEnd, tag.contentEnd);
      const removalKind =
        !redirectScriptRemoved && UA_REDIRECT_SCRIPT_PATTERN.test(content)
          ? 'redirect'
          : !controllerScriptRemoved && content.includes(CONTROLLER_RUN_MARKER)
            ? 'controller'
            : !elementorScriptRemoved && content.includes(ELEMENTOR_ANIMATION_RUN_MARKER)
              ? 'elementor'
              : null;
      if (removalKind !== null) {
        if (removalKind === 'redirect') redirectScriptRemoved = true;
        else if (removalKind === 'controller') controllerScriptRemoved = true;
        else elementorScriptRemoved = true;
        patches.push({ start: tag.start, end: tag.end, text: '' });
        regionRemovals++;
        continue;
      }
    }
    if (tag.name !== 'script' || !isDelayedScript(tag)) continue;
    candidates++;
    if (!featureWide) {
      // The whole match is the target, as WP Rocket saw it before delaying
      // it (rows may also match body text), its masked regions as
      // placeholders whose id is unknowable.
      const spanned =
        spannedBody === null
          ? null
          : servedHtml.slice(tag.start, bodyStart) +
            servedHtml.slice(spannedBody[0], spannedBody[1]) +
            servedHtml.slice(match.contentEnd, match.end);
      const verdict = verdictAfterInlinePass(
        matchRow,
        servedHtml.slice(tag.start, match.end),
        inline.pass,
        spanned,
        match.regions.length > 0 ? scriptProbeBudget(maskedScripts) : null
      );
      // Its possible originals disagree: left as served, counted undetermined.
      if (verdict === null) {
        undetermined++;
        continue;
      }
      if (verdict.approximate) approximate++;
      if (verdict.row === -1) continue;
      matchCounts[verdict.row] = (matchCounts[verdict.row] ?? 0) + 1;
    }
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    const restored = restoreDelayedScript(tagText);
    if (restored === tagText) continue; // Already live — nothing to un-delay.
    rewritten++;
    patches.push({
      start: tag.start,
      end: tag.openingEnd,
      text: stampExclusionMarker(restored, FEATURE)
    });
  }
  return {
    html: applyPatches(servedHtml, patches),
    report: transformReport({
      feature: FEATURE,
      rowKind: 'pattern',
      rows,
      matchCounts,
      candidates,
      rewritten,
      regionRemovals,
      featureWide,
      undetermined,
      approximate,
      matchAllRows
    })
  };
}
