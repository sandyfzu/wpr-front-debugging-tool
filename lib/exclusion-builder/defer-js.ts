/**
 * The Defer JS transform: undoes WP Rocket's script deferral. Candidacy is
 * the served `data-rocket-defer` marker (the plugin always stamps it; a
 * bare native `defer` the plugin never stamped is not this feature's
 * work), rows match the script's effective URL — `data-rocket-src` when
 * the delay feature parked it there, otherwise `src` — and the rewrite
 * strips both defer markers. A relative `src` matches in its raw form and,
 * when the caller passes the document's absolute URL, in its
 * document-resolved form too (what a DOM would read off `script.src`).
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
 * Resolve a raw attribute value against the document's URL — built-in URL
 * composition only, no parsing dependency. `null` when the resolution
 * cannot happen (malformed base); the raw value stays the row's only
 * target then.
 *
 * @param raw The raw attribute value.
 * @param documentUrl The absolute URL of the served document.
 */
function resolveAgainstDocument(raw: string, documentUrl: string): string | null {
  try {
    return new URL(raw, documentUrl).href;
  } catch {
    return null;
  }
}

/**
 * The URL texts a script's rows are tested against: the delay-parked
 * original (`data-rocket-src`) when present — matched raw, exactly as
 * parked — otherwise `src`, which a DOM reports resolved, so with
 * `documentUrl` a relative value is tested in both its raw and its
 * document-resolved form. Empty when the script has neither (an inline
 * script — no URL for a row to match).
 *
 * @param tag The script tag as parsed.
 * @param documentUrl The absolute URL of the served document, or omitted
 *   for raw-attribute-only matching.
 */
function rowTargets(tag: ParsedTag, documentUrl: string | undefined): readonly string[] {
  const parked = findAttribute(tag, DELAY_JS_SRC)?.value ?? null;
  if (parked !== null) return [parked];
  const src = findAttribute(tag, SRC_ATTRIBUTE)?.value ?? null;
  if (src === null) return [];
  if (documentUrl === undefined) return [src];
  const resolved = resolveAgainstDocument(src, documentUrl);
  return resolved === null || resolved === src ? [src] : [src, resolved];
}

/**
 * The Defer JS transform: `servedHtml` + the exclusion set → the html with
 * matched WP Rocket-deferred scripts stripped of both defer markers, plus
 * the transform's report. The rewrite stamps the exclusion marker as CSV.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Defer JS rows + toggle slice).
 * @param documentUrl The absolute URL of the served document; when given,
 *   relative `src` values are also matched in their document-resolved form
 *   (the raw value stays matched as-is). Omitted: raw attribute only.
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any Defer JS row is invalid.
 */
export function deferJsTransform(
  servedHtml: string,
  set: ExclusionSet,
  documentUrl?: string
): TransformResult {
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
      const targets = rowTargets(parseTagAt(tagText, 0), documentUrl);
      const rowIndex =
        targets.length === 0
          ? -1
          : compiled.findIndex(({ regex }) => targets.some((target) => regex.test(target)));
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
      featureWide
    })
  };
}
