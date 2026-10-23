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
import type { ParsedTag } from './html-scan';
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
const CONTROLLER_RUN_MARKER = `${DELAY_JS_CONTROLLER}.run`;

/** The Elementor animation helper the plugin serves alongside Delay JS. */
const ELEMENTOR_ANIMATION_RUN_MARKER = 'RocketElementorAnimation.run';

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
 * @param spanned The element read without a spanning wrapper's part, or `null`.
 * @returns The verdict (`null` when undetermined).
 */
function verdictAfterInlinePass(
  matchRow: DelayRowMatch,
  element: string,
  pass: InlinePass,
  spanned: string | null
): DelayVerdict {
  if (pass === 'runs') return matchRow(element);
  const unwrapped = unwrapInlineScripts(element).html;
  const readings = pass === 'skipped' ? [unwrapped] : [element, unwrapped];
  if (spanned !== null) readings.push(spanned);
  return agreedVerdict(matchRow, [...new Set(readings)]);
}

/**
 * The verdict every reading agrees on — matched or not — with the first
 * reading's row, approximate when any reading is; `null` (undetermined)
 * when any reading is undetermined or they disagree.
 *
 * @param matchRow The compiled rows.
 * @param readings The element's possible texts (≥ 1).
 */
function agreedVerdict(matchRow: DelayRowMatch, readings: readonly string[]): DelayVerdict {
  const verdicts = readings.map((reading) => matchRow(reading));
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
  for (const tag of scanTags(servedHtml)) {
    let spanned: string | null = null;
    if (inline.spanning && tag.name === 'script') {
      const body = servedHtml.slice(tag.openingEnd, tag.contentEnd);
      const reading = spanningWrapperReading(body, afterOpening);
      afterOpening ||= body.startsWith(INLINE_WRAP_OPEN);
      if (reading !== null) {
        spanned =
          servedHtml.slice(tag.start, tag.openingEnd) +
          reading +
          servedHtml.slice(tag.contentEnd, tag.end);
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
      // The whole script element is the match target, as WP Rocket saw it
      // before delaying it (rows may also match body text).
      const element = servedHtml.slice(tag.start, tag.end);
      const verdict = verdictAfterInlinePass(matchRow, element, inline.pass, spanned);
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
