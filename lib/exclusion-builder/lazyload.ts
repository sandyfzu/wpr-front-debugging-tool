/**
 * The Image Lazyload transform: restores real image sources from WP
 * Rocket's lazy markup. Candidate images carry a truthy `data-lazy-src`, or
 * an empty one next to their `<noscript>` original (WP Rocket's `esc_url`
 * empties a `data:` source); srcset/sizes-only images are not candidates.
 * Rows are LITERAL, case-sensitive substrings tested as WP Rocket tests
 * them, against the original image: its `atts` (after `<img` up to the
 * first `>`, even one inside a quoted value, less a trailing `/` and one
 * whitespace character), then its trimmed `src`; rows `''` and `"0"` match
 * nothing (`./literal-rows`). The original is the `<noscript>` copy WP
 * Rocket serves right after the image; without one it is rebuilt with only
 * `src` restored (approximate: the report counts it). A matched image then
 * moves `src`/`srcset`/`sizes` back from their carriers. Pictures, iframes
 * and background images are out of scope.
 */
import { DATA_LAZY_SRC, DATA_LAZY_SRCSET } from '../wp-rocket/constants';
import { scanTags, parseTagAt } from './html-scan';
import { isIgnoredLazyloadRow } from './literal-rows';
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
 * The rebuilt original when WP Rocket served no `<noscript>` copy: the
 * clone with ONLY `src` restored from `data-lazy-src` (the carrier dropped,
 * `srcset`/`sizes` carriers still parked; a `loading` attribute WP Rocket
 * removed cannot come back). Callers gate on a truthy `data-lazy-src` first.
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

/** The tag that opens WP Rocket's `<noscript>` copy of an image's original markup. */
const NOSCRIPT_OPEN = '<noscript>';

/** The tag that closes that copy, right after the original's first `>`. */
const NOSCRIPT_CLOSE = '</noscript>';

/** The `src` value as WP Rocket reads it from `atts` (lazy, dot-all, any case). */
const ATTS_SRC = /[ \t\n\v\f\r]src[ \t\n\v\f\r]*=[ \t\n\v\f\r]*(['"])([\s\S]*?)\1/i;

/** PHP `trim`'s default character set, at either end. */
const PHP_TRIM = /^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g;

/** PCRE's `\s` (no `u`): what WP Rocket's `\s?` before the closing `/?>` takes. */
const PCRE_SPACE = /[ \t\n\v\f\r]$/;

/** The original image WP Rocket matched rows against, and whether it is exact. */
interface OriginalImage {
  /** The original `<img …>` text. */
  readonly text: string;
  /** `false` when rebuilt from the served tag (approximate). */
  readonly exact: boolean;
}

/**
 * The original `<img …>` WP Rocket matched rows against: the `<noscript>`
 * copy it serves right after the lazy image (cut at its first `>`, as WP
 * Rocket cut it — `<img` in any case), else, approximately, the served tag
 * with only `src` restored.
 *
 * @param servedHtml The served document.
 * @param tagStart Offset of the lazy img's `<`.
 * @param tagEnd Offset just past its opening tag.
 */
function originalImage(servedHtml: string, tagStart: number, tagEnd: number): OriginalImage {
  const copyStart = tagEnd + NOSCRIPT_OPEN.length;
  const copyOpen = `<${IMG_TAG}`;
  const opensCopy =
    servedHtml.startsWith(NOSCRIPT_OPEN, tagEnd) &&
    servedHtml.slice(copyStart, copyStart + copyOpen.length).toLowerCase() === copyOpen;
  if (opensCopy) {
    const gt = servedHtml.indexOf('>', copyStart);
    if (gt !== -1 && servedHtml.startsWith(NOSCRIPT_CLOSE, gt + 1)) {
      return { text: servedHtml.slice(copyStart, gt + 1), exact: true };
    }
  }
  return { text: restoredSrcClone(servedHtml.slice(tagStart, tagEnd)), exact: false };
}

/**
 * WP Rocket's two subjects of an image, as `#<img(?<atts>\s.+)\s?/?>#iUs`
 * captures them: `atts` runs from after `<img` to the first `>`, less the
 * `/` and then one whitespace character the ungreedy match leaves to
 * `\s?/?`; then the trimmed `src` value found in it (`''` when none).
 *
 * @param original The original image tag text.
 */
function imageSubjects(original: string): { readonly atts: string; readonly src: string } {
  const gt = original.indexOf('>');
  let atts = original.slice(IMG_TAG.length + 1, gt === -1 ? original.length : gt);
  if (atts.endsWith('/')) atts = atts.slice(0, -1);
  if (PCRE_SPACE.test(atts)) atts = atts.slice(0, -1);
  const src = (ATTS_SRC.exec(atts)?.[2] ?? '').replace(PHP_TRIM, '');
  return { atts, src };
}

/**
 * The first row WP Rocket excludes an image for, or `-1`: a kept row that
 * is a substring of `atts`, else of `src`.
 *
 * @param rows The Lazyload rows.
 * @param original The original image tag text.
 */
function excludingRow(rows: readonly string[], original: string): number {
  const { atts, src } = imageSubjects(original);
  return rows.findIndex(
    (row) => !isIgnoredLazyloadRow(row) && (atts.includes(row) || src.includes(row))
  );
}

/**
 * Put the original's raw `src` value back on a restored tag whose lazy
 * carrier was empty.
 *
 * @param restoredText The restored tag text.
 * @param originalText The `<noscript>` original.
 */
function withOriginalSrc(restoredText: string, originalText: string): string {
  const src = findAttribute(parseTagAt(originalText, 0), SRC_ATTRIBUTE)?.value ?? '';
  return setAttributeValue(restoredText, SRC_ATTRIBUTE, src);
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
 * against the original image, so a row names the image's real URL even
 * though the served markup still holds the placeholder. The rewrite stamps
 * the exclusion marker as CSV (the detection layer reads it as its
 * "excluded by FDT" reason). Images matched against a rebuilt original (no
 * `<noscript>` copy) are counted `approximate`.
 *
 * @param servedHtml The served document (decoded text — no byte handling here).
 * @param set The exclusion set (Lazyload literal rows; no toggle exists).
 * @returns The rewritten html and the report.
 * @throws {@link ExclusionValidationError} when a row is whitespace only —
 *   it would match nearly every image (`''` and `"0"` are ignored, as
 *   WP Rocket ignores them).
 */
export function lazyloadTransform(servedHtml: string, set: ExclusionSet): TransformResult {
  const rows = set.rows.lazyload;
  const problems = featureRowProblems(FEATURE, 'literal', rows);
  if (problems.length > 0) throw new ExclusionValidationError(problems);
  const matchCounts = rows.map(() => 0);
  const patches: TextPatch[] = [];
  let candidates = 0;
  let rewritten = 0;
  let approximate = 0;
  for (const tag of scanTags(servedHtml)) {
    if (tag.name !== IMG_TAG) continue;
    const tagText = servedHtml.slice(tag.start, tag.openingEnd);
    const lazySrc = findAttribute(parseTagAt(tagText, 0), DATA_LAZY_SRC);
    if (lazySrc === null) continue;
    const original = originalImage(servedHtml, tag.start, tag.openingEnd);
    // Candidacy is a truthy `data-lazy-src`, or an empty one WP Rocket wrote
    // itself (`esc_url` empties a `data:` source) next to its `<noscript>`
    // original, which still holds the real `src`. Any other empty or
    // valueless carrier is not the plugin's lazyload work.
    if (!lazySrc.value && !original.exact) continue;
    candidates++;
    if (!original.exact) approximate++;
    // First matching row wins.
    const rowIndex = excludingRow(rows, original.text);
    if (rowIndex === -1) continue;
    matchCounts[rowIndex] = (matchCounts[rowIndex] ?? 0) + 1;
    rewritten++;
    const restored = lazySrc.value
      ? restoreImage(tagText)
      : withOriginalSrc(restoreImage(tagText), original.text);
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
      regionRemovals: 0,
      featureWide: false,
      approximate
    })
  };
}
