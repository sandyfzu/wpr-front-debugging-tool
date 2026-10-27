/**
 * The Automatic Lazy Rendering transform: reverses the feature's served
 * effect. Rows are LITERAL, ASCII-case-insensitive substrings of the
 * element's opening tag as WP Rocket's hash pass sees it (re-serialized by
 * libxml, no end tag); a match excludes the element and every element below
 * it (`./lazy-render-hashing`). The rewrite removes the
 * `data-wpr-lazyrender` attribute so the served `content-visibility` CSS no
 * longer applies. The feature-wide disable de-stamps every element and also
 * removes the inline CSS block; it removes nothing else — the plugin serves
 * no runner script for this feature.
 */
import { LAZY_RENDER_ATTRIBUTE, LAZY_RENDER_INLINE_CSS_ID } from '../wp-rocket/constants';
import { isEndTag, parseTagAt, scanTokens, type ScannedTag } from './html-scan';
import { matchAllRows, throwIfBlocking } from './errors';
import { analyzeLazyRender, isLazyRenderStamped } from './lazy-render-hashing';
import type { DocumentBytes } from './libxml/charset';
import { featureRowReading } from './validate';
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
 * The Automatic Lazy Rendering transform: `servedHtml` + the exclusion set
 * → the html with matched lazy-render stamps removed, plus the transform's
 * report. The rewrite stamps the exclusion marker as CSV on every
 * de-stamped element; a row's match count is the elements it excludes
 * (the outermost matched element's first matching row). An element whose
 * outcome cannot be determined is left as served and counted
 * `undetermined`.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Automatic Lazy Rendering literal rows + toggle slice).
 * @param bytes How the session decoded the page (UTF-8 without a BOM when omitted).
 * @returns The rewritten html and the report.
 * An empty row next to other rows matches every element, as on WP Rocket
 * (a warning, named in the report; a lone `''`/`"0"` row is WP Rocket's
 * no-op). Rows are never compiled as regexes, so regex-looking text is a
 * fine literal.
 */
export function lazyRenderTransform(
  servedHtml: string,
  set: ExclusionSet,
  bytes?: DocumentBytes
): TransformResult {
  const rows = set.rows.lazyRender;
  const reading = featureRowReading(FEATURE, 'literal', rows);
  throwIfBlocking(reading.problems);
  const featureWide = set.disable.lazyRender;
  const matchCounts = rows.map(() => 0);
  const tokens = scanTokens(servedHtml);
  const tags = tokens.filter((token): token is ScannedTag => !isEndTag(token));
  const patches: TextPatch[] = [];
  // Whole-region removals (the inline CSS block) — counted separately from
  // the attribute-level de-stamps.
  const removals: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  let undetermined = 0;
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
  // Built lazily: a page without stamped elements needs no tree.
  let analysis: ReturnType<typeof analyzeLazyRender> | null = null;
  for (const tag of tags) {
    // A removal covers an element outright (its spans would overlap a
    // de-stamp patch) — it is not a de-stamp candidate.
    if (insideRemoval(tag) || !isLazyRenderStamped(tag)) continue;
    candidates++;
    if (!featureWide) {
      analysis ??= analyzeLazyRender(servedHtml, tokens, rows, bytes);
      const verdict = analysis.verdict(tag);
      if (verdict.kind === 'unknown') undetermined++;
      if (verdict.kind !== 'excluded') continue;
      matchCounts[verdict.row] = (matchCounts[verdict.row] ?? 0) + 1;
    }
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
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
      featureWide,
      undetermined,
      matchAllRows: matchAllRows(reading.warnings)
    })
  };
}
