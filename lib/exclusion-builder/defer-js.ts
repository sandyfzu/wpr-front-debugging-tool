/**
 * The Defer JS transform: undoes WP Rocket's script deferral. Candidacy is
 * the served `data-rocket-defer` marker (the plugin always stamps it; a
 * bare native `defer` the plugin never stamped is not this feature's
 * work); rows match the `src` value WP Rocket captured — raw, as served
 * (whitespace and entities kept) — with WP Rocket's joined-row semantics
 * (`./defer-js-rows`), and the rewrite strips both defer markers.
 */
import { DELAY_JS_SRC, WPR_DEFER_ATTRIBUTE } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { deferRowSet } from './defer-js-rows';
import { ExclusionValidationError } from './errors';
import { transformReport, type TransformResult } from './report';
import {
  applyPatches,
  findAttribute,
  removeAttribute,
  stampExclusionMarker,
  type TextPatch
} from './tag-edit';
import { featureRowProblems } from './validate';
import type { ExclusionFeatureId, ExclusionSet } from './set';

const FEATURE: ExclusionFeatureId = 'defer_all_js';
/** The native defer attribute the plugin pairs with its marker. */
const DEFER_ATTRIBUTE = 'defer';

/**
 * WP Rocket's capture of a script's URL (`DeferJS::defer_js`), anchored at
 * one opening tag: PCRE's `\s` (ASCII whitespace and VT only) and its
 * ASCII-only caseless `script`/`src`, written out so no JS Unicode
 * whitespace or case folding creeps in. The greedy prefix takes the last
 * `src=` that fits; the lazy `\s*?` leaves surrounding whitespace in the
 * value; a quote ends it.
 */
const SRC_CAPTURE =
  /^<[Ss][Cc][Rr][Ii][Pp][Tt][\t\n\v\f\r ]+(?:[^>]+[\t\n\v\f\r '"])?[Ss][Rr][Cc][\t\n\v\f\r ]*=[\t\n\v\f\r ]*['"][\t\n\v\f\r ]*?([^'"]+)[\t\n\v\f\r ]*?['"](?:[^>]+)?\/?>/;

/**
 * The tag text WP Rocket's Defer JS saw. It runs before Delay JS, which
 * renames every `src=` it rewrites to `data-rocket-src=` (dropping only
 * whitespace around `=`, which the capture ignores); a delayed tag gets
 * that rename undone. Any other later edit (Delay's `type` rewrite, the
 * defer marker itself) holds no `src=` and leaves the capture unchanged.
 *
 * @param tagText The served opening tag.
 */
function deferTimeTag(tagText: string): string {
  const parked = findAttribute(parseTagAt(tagText, 0), DELAY_JS_SRC);
  return parked === null ? tagText : tagText.replaceAll(`${DELAY_JS_SRC}=`, 'src=');
}

/**
 * The subject WP Rocket's rows are tested against for one script: the
 * captured `src` value, raw. `null` when WP Rocket captures none (it then
 * never deferred the script, so a marked script without one was stamped by
 * something else).
 *
 * @param tagText The served opening tag.
 */
export function deferSubject(tagText: string): string | null {
  return SRC_CAPTURE.exec(deferTimeTag(tagText))?.[1] ?? null;
}

/**
 * The Defer JS transform: `servedHtml` + the exclusion set → the html with
 * matched WP Rocket-deferred scripts stripped of both defer markers, plus
 * the transform's report. The rewrite stamps the exclusion marker as CSV.
 * When WP Rocket's page state cannot be replayed, the matches are applied
 * as if it defers and the report says so.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Defer JS rows + toggle slice). No document
 *   URL is taken: WP Rocket matches the raw `src` value, never a resolved one.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Defer JS row has a
 *   problem — the page-wide `joined-page-off` included.
 */
export function deferJsTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.deferJs;
  const problems = featureRowProblems(FEATURE, 'pattern', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const rowSet = deferRowSet(rows);
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
      const subject = deferSubject(tagText);
      const rowIndex = subject === null ? -1 : rowSet.firstMatch(subject);
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
      regionRemovals: 0,
      featureWide,
      ...(rowSet.page === 'unknown' ? { pageState: 'unknown' as const } : {}),
      rowCountsBestEffort: rows.length > 1
    })
  };
}
