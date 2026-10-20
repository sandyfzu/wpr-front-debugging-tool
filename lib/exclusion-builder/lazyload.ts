/**
 * The Image Lazyload transform: restores real image sources from WP
 * Rocket's lazy markup. Candidate images carry a truthy `data-lazy-src`
 * (the plugin's own runtime candidacy — srcset/sizes-only or empty-carrier
 * images are not candidates); rows are LITERAL substrings tested against
 * the clone with only `src` restored (`data-lazy-src` → `src`, the other
 * lazy carriers still parked — the image's real identity, which the served
 * placeholder hides); a matched image then moves `src`/`srcset`/`sizes`
 * back from their carriers.
 */
import { DATA_LAZY_SRC, DATA_LAZY_SRCSET } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { ExclusionValidationError } from './errors';
import { featureRowProblems } from './validate';
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

/**
 * The lazy `sizes` carrier — the third of the lazyload family's attributes
 * (`data-lazy-src`/`data-lazy-srcset` live in the shared footprint
 * vocabulary; this one has no consumer outside the restore yet).
 */
export const LAZY_SIZES_ATTRIBUTE = 'data-lazy-sizes';

const FEATURE: ExclusionFeatureId = 'lazyload';
const IMG_TAG = 'img';
const SRC_ATTRIBUTE = 'src';

/** The lazy attribute → real attribute moves, in restore order. */
const LAZY_MOVES: readonly { readonly lazy: string; readonly real: string }[] = [
  { lazy: DATA_LAZY_SRC, real: SRC_ATTRIBUTE },
  { lazy: DATA_LAZY_SRCSET, real: 'srcset' },
  { lazy: LAZY_SIZES_ATTRIBUTE, real: 'sizes' }
];

/**
 * The match target: the clone with ONLY `src` restored from
 * `data-lazy-src` (the carrier dropped, `srcset`/`sizes` carriers still
 * parked) — the image's real identity as the plugin's own candidacy builds
 * it. Callers gate on a truthy `data-lazy-src` first.
 *
 * @param tagText The img's opening-tag text.
 * @returns The clone's tag text.
 */
function restoredSrcClone(tagText: string): string {
  const lazySrc = findAttribute(parseTagAt(tagText, 0), DATA_LAZY_SRC);
  if (lazySrc === null || !lazySrc.value) return tagText;
  const realExists = findAttribute(parseTagAt(tagText, 0), SRC_ATTRIBUTE) !== null;
  const withSrc = realExists
    ? setAttributeValue(tagText, SRC_ATTRIBUTE, lazySrc.value)
    : addAttributeValue(tagText, SRC_ATTRIBUTE, lazySrc.value);
  return removeAttribute(withSrc, DATA_LAZY_SRC);
}

/**
 * Restore one img's opening tag: each lazy value moves to its real
 * attribute (added at the tag's end, or overwritten in place), and the
 * lazy carrier is dropped — `src` first, then `srcset`/`sizes` only when
 * their carriers are present.
 *
 * @param tagText The img's opening-tag text.
 * @returns The restored tag text.
 */
function restoreImage(tagText: string): string {
  let text = tagText;
  for (const { lazy, real } of LAZY_MOVES) {
    const lazyAttr = findAttribute(parseTagAt(text, 0), lazy);
    if (lazyAttr === null) continue;
    const realExists = findAttribute(parseTagAt(text, 0), real) !== null;
    text = realExists
      ? setAttributeValue(text, real, lazyAttr.value ?? '')
      : addAttributeValue(text, real, lazyAttr.value ?? '');
    text = removeAttribute(text, lazy);
  }
  return text;
}

/**
 * The Image Lazyload transform: `servedHtml` + the exclusion set → the html
 * with matched images restored, plus the transform's report. Matching runs
 * against the only-src-restored clone, so a row names the image's real URL
 * even though the served markup still holds the placeholder. The rewrite
 * stamps the exclusion marker as CSV (the detection layer reads it as its
 * "excluded by FDT" reason).
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Lazyload literal rows; no toggle exists).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when any literal row is empty —
 *   an empty substring would match every image.
 */
export function lazyloadTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.lazyload;
  const problems = featureRowProblems(FEATURE, 'literal', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  for (const tag of scanTags(servedHtml)) {
    if (tag.name !== IMG_TAG) continue;
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    // Candidacy is a truthy `data-lazy-src` — an absent, valueless or
    // empty carrier is not the plugin's lazyload work (its own runtime
    // selector skips those images entirely).
    const lazySrc = findAttribute(parseTagAt(tagText, 0), DATA_LAZY_SRC);
    if (lazySrc === null || !lazySrc.value) continue;
    candidates++;
    // Rows are literal substrings of the only-src-restored clone — first
    // match wins.
    const rowIndex = rows.findIndex((row) => restoredSrcClone(tagText).includes(row));
    if (rowIndex === -1) continue;
    matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
    rewritten++;
    patches.push({
      start: tag.start,
      end: tag.openingEnd,
      text: stampExclusionMarker(restoreImage(tagText), FEATURE)
    });
  }
  return {
    html: applyPatches(servedHtml, patches),
    report: transformReport({
      feature: FEATURE,
      rowKind: 'literal',
      rows,
      matchCounts,
      candidates,
      rewritten,
      regionRemovals: 0,
      featureWide: false
    })
  };
}
