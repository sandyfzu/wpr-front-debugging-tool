/**
 * The Automatic Lazy Rendering transform: reverses the feature's served
 * effect. Rows match the child-cleared outerHTML — for the string engine,
 * the element's opening-tag text, which is what remains when the children
 * are cleared — and the rewrite removes the `data-wpr-lazyrender`
 * attribute so the served `content-visibility` CSS no longer applies. The
 * feature-wide disable de-stamps every element and also removes the
 * inline CSS block and the runner scripts (any script whose markup carries
 * the lazyrender marker).
 */
import { LAZY_RENDER_ATTRIBUTE, LAZY_RENDER_INLINE_CSS_ID } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { compilePatternRows } from './compile';
import { transformReport, type TransformResult } from './report';
import {
  applyPatches,
  findAttribute,
  removeAttribute,
  stampExclusionMarker,
  type TextPatch
} from './tag-edit';
import type { ExclusionFeatureId, ExclusionSet } from './set';

const FEATURE: ExclusionFeatureId = 'automatic_lazy_rendering';
const STYLE_TAG = 'style';
const SCRIPT_TAG = 'script';
const ID_ATTRIBUTE = 'id';

/**
 * The marker inside a runner script's markup — the attribute the runner
 * queries and the inline CSS id both contain, so one substring covers
 * inline runners, runner asset URLs, and the CSS id reference alike.
 */
const RUNNER_MARKER = 'lazyrender';

/**
 * The Automatic Lazy Rendering transform: `servedHtml` + the exclusion set
 * → the html with matched lazy-render stamps removed, plus the transform's
 * report. The rewrite stamps the exclusion marker as CSV on every
 * de-stamped element.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Automatic Lazy Rendering rows + toggle slice).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any row is invalid — even
 *   under the feature-wide disable, where a broken row is surfaced, never
 *   silently inert.
 */
export function lazyRenderTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.lazyRender;
  const compiled = compilePatternRows(rows, FEATURE);
  const featureWide = set.disable.lazyRender;
  const matchCounts = rows.map(() => 0);
  const tags = scanTags(servedHtml);
  const patches: TextPatch[] = [];
  // Whole-region removals (the inline CSS, runner scripts) — per-tag
  // attribute edits are skipped for anything inside these spans.
  const removals: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  if (featureWide) {
    for (const tag of tags) {
      const isInlineCss =
        tag.name === STYLE_TAG &&
        findAttribute(parseTagAt(servedHtml.slice(tag.start, tag.openingEnd), 0), ID_ATTRIBUTE)
          ?.value === LAZY_RENDER_INLINE_CSS_ID;
      const isRunnerScript =
        tag.name === SCRIPT_TAG && servedHtml.slice(tag.start, tag.end).includes(RUNNER_MARKER);
      if (isInlineCss || isRunnerScript) {
        removals.push({ start: tag.start, end: tag.end, text: '' });
      }
    }
  }
  const insideRemoval = (tag: { readonly start: number; readonly end: number }): boolean =>
    removals.some((removal) => tag.start >= removal.start && tag.end <= removal.end);
  for (const tag of tags) {
    if (insideRemoval(tag)) continue;
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    if (findAttribute(parseTagAt(tagText, 0), LAZY_RENDER_ATTRIBUTE) === null) continue;
    candidates++;
    if (!featureWide) {
      // The child-cleared outerHTML is the match target: the opening tag text.
      const rowIndex = compiled.findIndex(({ regex }) => regex.test(tagText));
      if (rowIndex === -1) continue;
      matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
    }
    const destamped = stampExclusionMarker(
      removeAttribute(tagText, LAZY_RENDER_ATTRIBUTE),
      FEATURE
    );
    rewritten++;
    patches.push({ start: tag.start, end: tag.openingEnd, text: destamped });
  }
  return {
    html: applyPatches(servedHtml, [...patches, ...removals]),
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
