/**
 * The forward LazyLoad transform for images: the page WP Rocket would
 * serve with LazyLoad for images on (iframes and videos off), from the page
 * WordPress prints for it — its rocket_buffer pass reproduced byte for
 * byte (pure, no I/O), inside the buffer's IE conditional extraction. The
 * caller places LazyLoad's own head and footer texts first: they are part
 * of the page the pass reads.
 *
 * The pass, on a parse copy without `<script>` then `<noscript>` elements:
 *
 * 1. pictures — a picture naming an exclusion gets `data-no-lazy=""` on
 *    every `<img` when its first image could be lazy loaded; any other gets
 *    its sources' `srcset` renamed `data-lazy-srcset`, then its first image
 *    replaced across the page (noscript stretches aside) by its lazy form
 *    and a `<noscript>` copy;
 * 2. images (on a fresh parse copy) — each distinct image either replaced
 *    by its lazy form (placeholder `src` sized by `width`/`height`,
 *    `data-lazy-src`, native `loading` dropped, `srcset`/`sizes` moved to
 *    `data-lazy-` carriers) and a `<noscript>` copy, or, when excluded, its
 *    `loading="lazy"` removed (its whole tag, then its attributes, page
 *    wide);
 * 3. background images (on the images' parse copy) — each candidate tag
 *    whose real `style` declares `background-image: url(…)` gets
 *    `data-bg`, the `rocket-lazyload` class, and loses that declaration.
 *
 * Exclusions are literal substrings: WP Rocket's attribute and src rows
 * plus the stored rows. Every rewrite is PHP's `str_replace` over the whole
 * page, in match order.
 */
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { replaceDisjoint, type KeyEnds } from './disjoint-replace';
import {
  featureBuffer,
  injectIeConditionals,
  scriptConditionalParts,
  type FeatureBuffer
} from './ie-conditionals';
import {
  backgroundElementMatches,
  imageMatches,
  lazyloadParseCopy,
  pictureMatches,
  sourceMatches,
  type ImageMatch,
  type LazyloadBeyond
} from './lazyload-scan';
import {
  backgroundUrl,
  findRealAttribute,
  firstQuotedValue,
  imageSource,
  isExcludedBy,
  lazyPlaceholder,
  withLazyClass,
  withLazyResponsiveAttributes,
  withLazySourceSrcset,
  withoutLazyLoading,
  withoutNativeLoading,
  withoutOuterQuotes,
  withPlaceholderSource
} from './lazyload-tag';
import type { LazyloadUnreproduced } from './spec';
import { pictureImagePatternCompiles, replacePictureImage } from './lazyload-picture-image';
import { asciiCaselessAt, isSpaceAt } from './pcre-text';
import { htmlEntityDecodeHtml5 } from './php-entities';
import { phpAbsint } from './php-numeric';
import {
  ReplacementWorkExceeded,
  countReplacementWork,
  strReplaceCounted,
  type ReplacementWork
} from './str-replace-sequence';
import {
  ieConditionalScriptSteps,
  ieConditionalsSteps,
  UNREPRODUCED_STEP_CEILING
} from './unreproduced-limits';
import { byteLength, UTF8_MEASURE, type ByteMeasure } from './utf8';
import { escAttr, escUrl, wpStripAllTags } from './wp-escaping';
import { nextOccurrenceFinder } from '../../utils/next-occurrence';

/** The exclusion rows the image pass tests (substrings, case-sensitive). */
export interface LazyloadExclusions {
  /** WP Rocket's attribute rows (the version's literals) plus the stored rows. */
  readonly attributes: readonly string[];
  /** WP Rocket's src rows (the version's literals) plus the stored rows. */
  readonly src: readonly string[];
}

/** The version's own exclusion literals (the simulation data file's lists). */
export interface LazyloadLiterals {
  readonly excludedAttributes: readonly string[];
  readonly excludedSrc: readonly string[];
}

/**
 * The rows the pass tests: WP Rocket adds the stored rows to both lists
 * (deduplication aside, which a substring test cannot see).
 *
 * @param literals The version's literals.
 * @param rows The stored LazyLoad exclusion rows.
 */
export function lazyloadExclusions(
  literals: LazyloadLiterals,
  rows: readonly string[]
): LazyloadExclusions {
  return {
    attributes: [...literals.excludedAttributes, ...rows],
    src: [...literals.excludedSrc, ...rows]
  };
}

/** What the pass did. */
export interface LazyloadPassCounts {
  /** Distinct images replaced by their lazy form (outside pictures). */
  readonly images: number;
  /** Pictures whose sources or first image were made lazy. */
  readonly pictures: number;
  /** Background candidates given `data-bg`. */
  readonly backgrounds: number;
}

/** The pass's outcome on an IE-extracted page. */
export type LazyloadPassResult = ({ readonly html: string } & LazyloadPassCounts) | LazyloadBeyond;

/** What the transform is given. */
export interface LazyloadForwardInput {
  /** The page as WordPress prints it with LazyLoad on (its head and footer texts placed), decoded. */
  readonly html: string;
  readonly literals: LazyloadLiterals;
  /** The stored LazyLoad exclusion rows (`exclude_lazyload`). */
  readonly rows: readonly string[];
  /** Bytes per code unit as served (default UTF-8): decides the backtrack-limit estimates. */
  readonly measure?: ByteMeasure;
}

/** A step beyond exact reproduction: LazyLoad's own, or the buffer's IE extraction. */
export type LazyloadUnreproducedStep =
  LazyloadUnreproduced | 'ie-conditionals' | 'ie-conditional-script';

/** What the transform did. */
export interface LazyloadForwardReport extends LazyloadPassCounts {
  readonly state: 'simulated' | 'not-applicable';
  /** With `not-applicable`: the step that could diverge from WP Rocket. */
  readonly unreproduced?: LazyloadUnreproducedStep;
}

/** The transform's result. */
export interface LazyloadForwardResult {
  readonly html: string;
  readonly report: LazyloadForwardReport;
  /** With `simulated`: the buffer after the pass (later features' passes continue on it). */
  readonly buffer?: FeatureBuffer;
}

/** Thrown inside the pass to stop it where WP Rocket's run could diverge. */
class Beyond extends Error {
  override readonly name = 'Beyond';

  /** @param step The step. */
  constructor(readonly step: LazyloadUnreproduced) {
    super(step);
  }
}

/**
 * The value, or a stop at the step that made it unreproducible.
 *
 * @param value A scan's result.
 * @throws {@link Beyond} for a {@link LazyloadBeyond}.
 */
function settled<T>(value: T | LazyloadBeyond): T {
  if (typeof value === 'object' && value !== null && 'beyond' in value)
    throw new Beyond(value.beyond);
  return value;
}

/** Steps per byte any tag-level regex costs at most (measured: up to 3 over its tag). */
const TAG_STEPS_PER_BYTE = 4;

/**
 * Stop unless every tag-level regex on `text` surely stays within the
 * backtrack ceiling.
 *
 * @param text The tag (or picture, or URL) a regex reads.
 * @param measure The served encoding's byte measure.
 * @throws {@link Beyond} past the ceiling.
 */
function boundTag(text: string, measure: ByteMeasure): void {
  if (
    TAG_STEPS_PER_BYTE * byteLength(text, 0, text.length, measure) + 32 >
    UNREPRODUCED_STEP_CEILING
  ) {
    throw new Beyond('lazyload-tag-length');
  }
}

/**
 * A dimension attribute's `absint` (0 when absent).
 *
 * @param atts The image's `atts`.
 * @param name `width` or `height`.
 * @throws {@link Beyond} past 2^53.
 */
function dimension(atts: string, name: string): number {
  const found = firstQuotedValue(atts, name, true);
  if (found === null) return 0;
  const value = phpAbsint(atts.slice(found.valueStart, found.valueEnd));
  if (value === null) throw new Beyond('lazyload-dimension');
  return value;
}

/**
 * `esc_url`, stopping where it is not reproduced.
 *
 * @param url The URL.
 * @throws {@link Beyond} for an unported path.
 */
function escapedUrl(url: string): string {
  const escaped = escUrl(url);
  if (escaped === null) throw new Beyond('lazyload-url');
  return escaped;
}

/**
 * `canLazyload`: the image's trimmed `src`, or `null` when its attributes
 * or its source name an exclusion, or it has no (non-empty) quoted `src`.
 *
 * @param image The match.
 * @param exclusions The rows.
 * @param measure The served encoding's byte measure.
 * @throws {@link Beyond} for a tag too long to bound.
 */
function lazyloadableSource(
  image: ImageMatch,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure
): string | null {
  boundTag(image.text, measure);
  if (isExcludedBy(image.atts, exclusions.attributes)) return null;
  const src = imageSource(image.atts);
  return src === null || isExcludedBy(src, exclusions.src) ? null : src;
}

/**
 * An image's lazy tag (`replaceImage` in non-native mode, then the
 * responsive filter), or `null` when `canLazyload` refuses it.
 *
 * @param image The match.
 * @param exclusions The rows.
 * @param measure The served encoding's byte measure.
 * @throws {@link Beyond} where not reproducible.
 */
function lazyImageTag(
  image: ImageMatch,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure
): string | null {
  const src = lazyloadableSource(image, exclusions, measure);
  if (src === null) return null;
  const placeholder = lazyPlaceholder(
    dimension(image.atts, 'width'),
    dimension(image.atts, 'height')
  );
  const atts = `${withPlaceholderSource(image.atts, placeholder)} data-lazy-src="${escapedUrl(src)}"`;
  const tag = image.text.split(image.atts).join(atts);
  return withLazyResponsiveAttributes(withoutNativeLoading(tag));
}

/**
 * An image's lazy form with its `<noscript>` copy.
 *
 * @param image The match.
 * @param tag Its lazy tag.
 */
function withNoscriptCopy(image: ImageMatch, tag: string): string {
  return `${tag}<noscript>${image.text}</noscript>`;
}

/**
 * The picture pass (`lazyloadPictures`).
 *
 * @param html The page.
 * @param exclusions The rows.
 * @param measure The served encoding's byte measure.
 * @param work The replay's work so far.
 */
function lazyPictures(
  html: string,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure,
  work: ReplacementWork
): { readonly html: string; readonly pictures: number } {
  const pictures = settled(pictureMatches(settled(lazyloadParseCopy(html, measure)), measure));
  const excluded = [...exclusions.attributes, ...exclusions.src];
  let out = html;
  let lazy = 0;
  for (const picture of pictures) {
    if (isExcludedBy(picture.text, excluded)) {
      const image = settled(imageMatches(picture.text, measure, true))[0];
      if (image === undefined || lazyloadableSource(image, exclusions, measure) === null) continue;
      const kept = picture.text.split('<img').join('<img data-no-lazy=""');
      out = strReplaceCounted(work, out, picture.text, kept);
      continue;
    }
    let rewritten = false;
    const sources = sourceMatches(picture.sources);
    if (sources.length > 0) {
      let lazyPicture = picture.text;
      for (const source of sources) {
        lazyPicture = strReplaceCounted(work, lazyPicture, source, withLazySourceSrcset(source));
      }
      out = strReplaceCounted(work, out, picture.text, lazyPicture);
      rewritten = true;
    }
    const image = settled(imageMatches(picture.text, measure, true))[0];
    const tag = image === undefined ? null : lazyImageTag(image, exclusions, measure);
    if (image !== undefined && tag !== null) {
      const compiles = pictureImagePatternCompiles(image.text, measure);
      if (compiles === null) throw new Beyond('lazyload-picture-pattern-size');
      if (compiles) {
        out = settled(replacePictureImage(out, image.text, withNoscriptCopy(image, tag), work));
        rewritten = true;
      }
    }
    if (rewritten) lazy++;
  }
  return { html: out, pictures: lazy };
}

/**
 * An image key: from `<img` + whitespace (caseless) to the first `>` at
 * least two characters on — exactly an image match's extent.
 *
 * @param text The text searched.
 */
const imageKeyEnds: KeyEnds = (text) => {
  const nextGt = nextOccurrenceFinder(text, '>');
  return (at) => {
    if (!asciiCaselessAt(text, at, '<img') || !isSpaceAt(text, at + 4)) return -1;
    const gt = nextGt(at + 6);
    return gt === -1 ? -1 : gt + 1;
  };
};

/**
 * Whether one pass over the original page gives what the image pass's
 * sequential `str_replace` calls give. Every search is an image match, so
 * an occurrence of one is exactly an image extent; it holds when the
 * occurrences are disjoint (checked by the pass itself) and no call can
 * create an occurrence of a later search:
 * - each replacement starts with `<`, ends with `>`, and every image start
 *   inside it closes inside it (an occurrence starting in it ends in it);
 * - no later search occurs inside an earlier replacement;
 * - no image extent of the page crosses into an occurrence's start (an
 *   occurrence ending inside a replacement would start before it).
 *
 * @param html The page.
 * @param order The searches in call order (distinct).
 * @param replacements Each search's replacement.
 */
function onePassExact(
  html: string,
  order: readonly string[],
  replacements: ReadonlyMap<string, string>
): boolean {
  const rank = new Map(order.map((search, index) => [search, index]));
  for (const [index, search] of order.entries()) {
    const replacement = replacements.get(search) as string;
    if (!replacement.startsWith('<') || !replacement.endsWith('>')) return false;
    // `/<img/gi` folds ASCII letters only: non-ASCII never folds onto ASCII without `u`.
    for (const { index: at } of replacement.matchAll(/<img/gi)) {
      if (!isSpaceAt(replacement, at + 4)) continue;
      // An image key ends at the first `>` two characters past the whitespace.
      const gt = replacement.indexOf('>', at + 6);
      if (gt === -1) return false;
      const later = rank.get(replacement.slice(at, gt + 1));
      if (later !== undefined && later > index) return false;
    }
  }
  const keyEnd = imageKeyEnds(html);
  let previousEnd = -1;
  for (const found of html.matchAll(/<img/gi)) {
    if (!isSpaceAt(html, found.index + 4)) continue;
    const end = keyEnd(found.index);
    if (
      found.index < previousEnd &&
      rank.has(html.slice(found.index, end === -1 ? found.index : end))
    ) {
      return false;
    }
    previousEnd = end;
  }
  return true;
}

/**
 * Replay work charged per distinct image the pass rewrites or keeps — its
 * attribute regexes, escaping and lookups (measured: about 4 µs each, as
 * long as the replay takes for this many code units) — so a page of
 * hundreds of thousands of tiny images is refused instead of running long.
 */
const IMAGE_WORK = 4096;

/**
 * The image pass (`lazyloadImages`, non-native mode).
 *
 * @param html The page (after the picture pass).
 * @param copy Its parse copy.
 * @param exclusions The rows.
 * @param measure The served encoding's byte measure.
 * @param work The replay's work so far.
 */
function lazyImages(
  html: string,
  copy: string,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure,
  work: ReplacementWork
): { readonly html: string; readonly images: number } {
  const seen = new Set<string>();
  const steps: [string, string][] = [];
  let keptChanged = false;
  let images = 0;
  for (const image of settled(imageMatches(copy, measure))) {
    if (seen.has(image.text)) continue;
    seen.add(image.text);
    countReplacementWork(work, IMAGE_WORK);
    const tag = lazyImageTag(image, exclusions, measure);
    if (tag === null) {
      const kept = withoutLazyLoading(image.text);
      if (kept === image.text) continue;
      const keptAtts = withoutLazyLoading(image.atts);
      steps.push([image.text, kept], [image.atts, keptAtts], [image.atts, keptAtts]);
      keptChanged = true;
      continue;
    }
    steps.push([image.text, withNoscriptCopy(image, tag)]);
    images++;
  }
  if (!keptChanged) {
    const replacements = new Map(steps);
    const order = steps.map(([search]) => search);
    if (onePassExact(html, order, replacements)) {
      const once = replaceDisjoint(html, replacements, imageKeyEnds);
      if (once !== null) return { html: once, images };
    }
  }
  let out = html;
  for (const [search, replacement] of steps)
    out = strReplaceCounted(work, out, search, replacement);
  return { html: out, images };
}

/** `trim($text, '\'" ')`. */
function trimQuotesAndSpaces(text: string): string {
  return text.replace(/^['" ]+|['" ]+$/g, '');
}

/**
 * A background URL as WP Rocket cleans it: entities decoded, tags
 * stripped, quotes and spaces trimmed, `esc_url`.
 *
 * @param url The raw `url(…)` content.
 * @param measure The served encoding's byte measure.
 * @throws {@link Beyond} where not reproducible.
 */
function cleanBackgroundUrl(url: string, measure: ByteMeasure): string {
  const decoded = htmlEntityDecodeHtml5(url);
  if (decoded === null) throw new Beyond('lazyload-entities');
  // Decoded references are written as UTF-8 bytes, which only a UTF-8 page reads back as is.
  if (measure !== UTF8_MEASURE && decoded !== url && /[^\0-\x7f]/.test(decoded)) {
    throw new Beyond('lazyload-entities');
  }
  return escapedUrl(trimQuotesAndSpaces(wpStripAllTags(decoded)));
}

/**
 * The background pass (`lazyloadBackgroundImages`).
 *
 * @param html The page (after the image pass).
 * @param copy The parse copy the image pass read.
 * @param exclusions The rows.
 * @param measure The served encoding's byte measure.
 * @param work The replay's work so far.
 */
function lazyBackgrounds(
  html: string,
  copy: string,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure,
  work: ReplacementWork
): { readonly html: string; readonly backgrounds: number } {
  let out = html;
  let backgrounds = 0;
  for (const element of backgroundElementMatches(copy)) {
    const style = findRealAttribute(element.text, 'style');
    if (style === null) continue;
    boundTag(element.text, measure);
    const withoutStyle = element.text.split(style.attribute).join('');
    if (isExcludedBy(withoutStyle, exclusions.attributes)) continue;
    const found = backgroundUrl(withoutOuterQuotes(style.value));
    if (found === null || asciiLowerCase(found.url).includes('data:image')) continue;
    const url = cleanBackgroundUrl(found.url, measure);
    if (isExcludedBy(url, exclusions.src)) continue;
    const lazy = withLazyClass(element.text)
      .split(found.declaration)
      .join('')
      .split(`<${element.tag}`)
      .join(`<${element.tag} data-bg="${escAttr(url)}"`);
    out = strReplaceCounted(work, out, element.text, lazy);
    backgrounds++;
  }
  return { html: out, backgrounds };
}

/**
 * The pass's work bound, in code units its rewrites read natively (each
 * `str_replace` and per-picture replacement reads the whole page) plus the
 * per-lookup and per-image charges. Measured on Node 24, a unit costs
 * 0.1–0.75 ns, so the bound stops any page within about 0.4 s — a 1 MB
 * page with 150 `<picture>` blocks (sources and image: 300 page reads)
 * takes about 0.15 s and fits; past the bound the page is not simulated.
 */
const LAZYLOAD_WORK_LIMIT = 2 ** 29;

/**
 * LazyLoad's image pass on a page whose IE conditionals are already set
 * aside (the buffer's state when it runs).
 *
 * @param html The IE-extracted page.
 * @param exclusions The rows ({@link lazyloadExclusions}).
 * @param measure The served encoding's byte measure.
 */
export function lazyloadImagesPass(
  html: string,
  exclusions: LazyloadExclusions,
  measure: ByteMeasure = UTF8_MEASURE
): LazyloadPassResult {
  const work: ReplacementWork = { units: 0, limit: LAZYLOAD_WORK_LIMIT };
  try {
    const pictures = lazyPictures(html, exclusions, measure, work);
    const copy = settled(lazyloadParseCopy(pictures.html, measure));
    const images = lazyImages(pictures.html, copy, exclusions, measure, work);
    const backgrounds = lazyBackgrounds(images.html, copy, exclusions, measure, work);
    return {
      html: backgrounds.html,
      images: images.images,
      pictures: pictures.pictures,
      backgrounds: backgrounds.backgrounds
    };
  } catch (error) {
    if (error instanceof Beyond) return { beyond: error.step };
    if (error instanceof ReplacementWorkExceeded) return { beyond: 'lazyload-replacements' };
    throw error;
  }
}

/**
 * Simulate WP Rocket's LazyLoad for images on a page WordPress printed with
 * it on (its head and footer texts placed by the caller).
 *
 * @param input The page, the version's literals and the stored rows.
 * @returns The page WP Rocket would serve, the report, and on `simulated` the buffer after the pass.
 */
export function simulateLazyloadImages(input: LazyloadForwardInput): LazyloadForwardResult {
  const measure = input.measure ?? UTF8_MEASURE;
  const beyond = (step: LazyloadUnreproducedStep): LazyloadForwardResult => ({
    html: input.html,
    report: { state: 'not-applicable', unreproduced: step, images: 0, pictures: 0, backgrounds: 0 }
  });
  const buffer = featureBuffer(input.html, undefined);
  if (ieConditionalsSteps(input.html, buffer.scan, measure) > UNREPRODUCED_STEP_CEILING) {
    return beyond('ie-conditionals');
  }
  for (const conditional of buffer.conditionals) {
    const parts = scriptConditionalParts(conditional);
    if (
      parts !== null &&
      ieConditionalScriptSteps(conditional, parts, measure) > UNREPRODUCED_STEP_CEILING
    ) {
      return beyond('ie-conditional-script');
    }
  }
  const pass = lazyloadImagesPass(
    buffer.html,
    lazyloadExclusions(input.literals, input.rows),
    measure
  );
  if ('beyond' in pass) return beyond(pass.beyond);
  const { html, ...counts } = pass;
  return {
    html: injectIeConditionals(html, buffer.conditionals),
    report: { state: 'simulated', ...counts },
    buffer: { ...buffer, html }
  };
}
