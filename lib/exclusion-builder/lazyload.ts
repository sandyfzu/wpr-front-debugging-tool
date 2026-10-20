/**
 * The Image Lazyload transform: restores real image sources from WP
 * Rocket's lazy markup. Candidate images carry a lazy attribute; rows are
 * LITERAL substrings tested against the img markup with the lazy values
 * restored (the clone — the image's real identity, which the served
 * placeholder hides); the rewrite moves `src`/`srcset`/`sizes` back from
 * their lazy carriers.
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

/** The lazy attribute → real attribute moves, in restore order. */
const LAZY_MOVES: readonly { readonly lazy: string; readonly real: string }[] = [
  { lazy: DATA_LAZY_SRC, real: 'src' },
  { lazy: DATA_LAZY_SRCSET, real: 'srcset' },
  { lazy: LAZY_SIZES_ATTRIBUTE, real: 'sizes' }
];

/**
 * Restore one img's opening tag: each lazy value moves to its real
 * attribute (added at the tag's end, or overwritten in place), and the
 * lazy carrier is dropped. The srcset-only case falls out naturally — a
 * missing lazy `src` leaves the served placeholder untouched.
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
 * against the restored clone, so a row names the image's real URL even
 * though the served markup still holds the placeholder. The rewrite stamps
 * the exclusion marker as CSV (the detection layer reads it as its
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
    if (!LAZY_MOVES.some(({ lazy }) => findAttribute(parseTagAt(tagText, 0), lazy) !== null))
      continue;
    candidates++;
    const restored = restoreImage(tagText);
    // Rows are literal substrings of the restored clone — first match wins.
    const rowIndex = rows.findIndex((row) => restored.includes(row));
    if (rowIndex === -1) continue;
    matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
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
      rowKind: 'literal',
      rows,
      matchCounts,
      candidates,
      rewritten,
      featureWide: false
    })
  };
}
