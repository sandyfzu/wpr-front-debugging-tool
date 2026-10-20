/**
 * The Defer JS transform: undoes WP Rocket's script deferral. Candidacy is
 * the served `data-rocket-defer` marker (the plugin always stamps it; a
 * bare native `defer` the plugin never stamped is not this feature's
 * work), rows match the script's effective URL — `data-rocket-src` when
 * the delay feature parked it there, otherwise `src` — and the rewrite
 * strips both defer markers.
 */
import { DELAY_JS_SRC, WPR_DEFER_ATTRIBUTE } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import type { ParsedTag } from './html-scan';
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

const FEATURE: ExclusionFeatureId = 'defer_all_js';
/** The native defer attribute the plugin pairs with its marker. */
const DEFER_ATTRIBUTE = 'defer';
const SRC_ATTRIBUTE = 'src';

/**
 * The script's effective URL: the delayed original when the delay feature
 * parked it in `data-rocket-src`, otherwise the plain `src`; `null` for a
 * script with neither (an inline script — no URL for a row to match).
 *
 * @param tag The script tag as parsed.
 */
function effectiveUrl(tag: ParsedTag): string | null {
  return (
    findAttribute(tag, DELAY_JS_SRC)?.value ?? findAttribute(tag, SRC_ATTRIBUTE)?.value ?? null
  );
}

/**
 * The Defer JS transform: `servedHtml` + the exclusion set → the html with
 * matched WP Rocket-deferred scripts stripped of both defer markers, plus
 * the transform's report. The rewrite stamps the exclusion marker as CSV.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Defer JS rows + toggle slice).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Defer JS row is invalid.
 */
export function deferJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.deferJs;
  const compiled = compilePatternRows(rows, FEATURE);
  const featureWide = set.disable.deferJs;
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  for (const tag of scanTags(servedHtml)) {
    if (tag.name !== 'script') continue;
    // Candidacy is the plugin's marker — a bare native `defer` is not ours.
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    if (findAttribute(parseTagAt(tagText, 0), WPR_DEFER_ATTRIBUTE) === null) continue;
    candidates++;
    if (!featureWide) {
      const url = effectiveUrl(parseTagAt(tagText, 0));
      const rowIndex = url === null ? -1 : compiled.findIndex(({ regex }) => regex.test(url));
      if (rowIndex === -1) continue;
      matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
    }
    let restored = removeAttribute(tagText, WPR_DEFER_ATTRIBUTE);
    restored = removeAttribute(restored, DEFER_ATTRIBUTE);
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
