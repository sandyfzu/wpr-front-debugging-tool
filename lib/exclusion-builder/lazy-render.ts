/**
 * The Automatic Lazy Rendering transform: reverses the feature's served
 * effect. Rows are LITERAL substrings tested against the child-cleared
 * markup — the element's opening tag plus its end tag (a void element
 * serializes without one), which is what remains when the children are
 * cleared — and the rewrite removes the `data-wpr-lazyrender` attribute so
 * the served `content-visibility` CSS no longer applies. The feature-wide
 * disable de-stamps every element and also removes the inline CSS block;
 * it removes nothing else — the plugin serves no runner script for this
 * feature.
 */
import { LAZY_RENDER_ATTRIBUTE, LAZY_RENDER_INLINE_CSS_ID } from '../wp-rocket/constants';
import { HTML_VOID_ELEMENTS, scanTags, parseTagAt } from './html-scan';
import type { ScannedTag } from './html-scan';
import { ExclusionValidationError } from './errors';
import { featureRowProblems } from './validate';
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
const ID_ATTRIBUTE = 'id';

/**
 * The child-cleared markup a row matches: the opening-tag text, closed by
 * the element's end tag — `outerHTML` of the element with its children
 * cleared. Void elements serialize without an end tag.
 *
 * @param servedHtml The document being scanned (the tag's spans index it).
 * @param tag The scanned element.
 */
function childClearedMarkup(servedHtml: string, tag: ScannedTag): string {
  const endTag = HTML_VOID_ELEMENTS.has(tag.name) ? '' : `</${tag.name}>`;
  return `${servedHtml.slice(tag.start, tag.openingEnd)}${endTag}`;
}

/**
 * The Automatic Lazy Rendering transform: `servedHtml` + the exclusion set
 * → the html with matched lazy-render stamps removed, plus the transform's
 * report. The rewrite stamps the exclusion marker as CSV on every
 * de-stamped element.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Automatic Lazy Rendering literal rows + toggle slice).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any row is empty — even
 *   under the feature-wide disable, where a broken row is surfaced, never
 *   silently inert. Rows are never compiled as regexes, so regex-looking
 *   text is a fine literal.
 */
export function lazyRenderTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.lazyRender;
  const problems = featureRowProblems(FEATURE, 'literal', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const featureWide = set.disable.lazyRender;
  const matchCounts = rows.map(() => 0);
  const tags = scanTags(servedHtml);
  const patches: TextPatch[] = [];
  // Whole-region removals (the inline CSS block) — counted separately from
  // the attribute-level de-stamps.
  const removals: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  if (featureWide) {
    for (const tag of tags) {
      const isInlineCss =
        tag.name === STYLE_TAG &&
        findAttribute(parseTagAt(servedHtml.slice(tag.start, tag.openingEnd), 0), ID_ATTRIBUTE)
          ?.value === LAZY_RENDER_INLINE_CSS_ID;
      if (isInlineCss) removals.push({ start: tag.start, end: tag.end, text: '' });
    }
  }
  const insideRemoval = (tag: ScannedTag): boolean =>
    removals.some((removal) => tag.start >= removal.start && tag.end <= removal.end);
  for (const tag of tags) {
    // A removal covers an element outright (its spans would overlap a
    // de-stamp patch) — it is not a de-stamp candidate.
    if (insideRemoval(tag)) continue;
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    if (findAttribute(parseTagAt(tagText, 0), LAZY_RENDER_ATTRIBUTE) === null) continue;
    candidates++;
    if (!featureWide) {
      // The child-cleared markup is the match target — first row wins.
      const rowIndex = rows.findIndex((row) => childClearedMarkup(servedHtml, tag).includes(row));
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
      rowKind: 'literal',
      rows,
      matchCounts,
      candidates,
      rewritten,
      regionRemovals: removals.length,
      featureWide
    })
  };
}
