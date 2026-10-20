/**
 * The Delay JS transform: restores live scripts from WP Rocket's served
 * delayed markup. Candidates are scripts whose `type` is a delay type or
 * that carry the delay controller's runtime status marker; rows match the
 * whole script markup (attributes, body, end tag) as regular expressions;
 * the restore follows the controller's own runtime semantics — `type`
 * reclaims `data-rocket-type`'s value (dropped entirely when the original
 * had none) and `src` reclaims `data-rocket-src`.
 */
import { DELAY_JS_SRC, isDelayJSType } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import type { ParsedTag } from './html-scan';
import { compilePatternRows } from './compile';
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

/** Where the controller parks a delayed script's original `type` value. */
export const DELAY_TYPE_ATTRIBUTE = 'data-rocket-type';

const FEATURE: ExclusionFeatureId = 'delay_js';
const TYPE_ATTRIBUTE = 'type';
const SRC_ATTRIBUTE = 'src';

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
 *   removed entirely when the original script had no type (the controller
 *   sets none either). A live `type` beside the status marker means the
 *   controller already restored the script — it stays untouched;
 * - `src` reclaims `data-rocket-src` (added, or overwritten when a plain
 *   `src` also survived);
 * - both data attributes are dropped.
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
    text =
      declaredType?.value != null
        ? setAttributeValue(text, TYPE_ATTRIBUTE, declaredType.value)
        : removeAttribute(text, TYPE_ATTRIBUTE);
    if (declaredType !== null) text = removeAttribute(text, DELAY_TYPE_ATTRIBUTE);
  }
  const rocketSrc = findAttribute(parseTagAt(text, 0), DELAY_JS_SRC);
  if (rocketSrc !== null) {
    const srcValue = rocketSrc.value ?? '';
    text =
      findAttribute(parseTagAt(text, 0), SRC_ATTRIBUTE) !== null
        ? setAttributeValue(text, SRC_ATTRIBUTE, srcValue)
        : addAttributeValue(text, SRC_ATTRIBUTE, srcValue);
    text = removeAttribute(text, DELAY_JS_SRC);
  }
  return text;
}

/**
 * The Delay JS transform: `servedHtml` + the exclusion set → the html with
 * matched delayed scripts restored to live scripts, plus the transform's
 * report. Rows are validated before anything runs (all of them named on
 * failure), and the restore stamps the exclusion marker as CSV on every
 * rewritten script — never on a candidate the controller had already
 * restored at runtime.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Delay JS rows + toggle slice).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Delay JS row is invalid.
 */
export function delayJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.delayJs;
  const compiled = compilePatternRows(rows, FEATURE);
  const featureWide = set.disable.delayJs;
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  for (const tag of scanTags(servedHtml)) {
    if (tag.name !== 'script' || !isDelayedScript(tag)) continue;
    candidates++;
    if (!featureWide) {
      // The whole script markup is the match target (both delay types live
      // in the opening tag; rows may also match body text).
      const region = servedHtml.slice(tag.start, tag.end);
      const rowIndex = compiled.findIndex(({ regex }) => regex.test(region));
      if (rowIndex === -1) continue;
      matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
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
      featureWide
    })
  };
}
