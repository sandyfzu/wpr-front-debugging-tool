/**
 * Whether a served page already carries WP Rocket's Delay JS, Defer JS or
 * LazyLoad — then that feature's simulation is the identity (WP Rocket's
 * real output is what rows apply to). Evidence is read off the served text
 * with the tag scanner (no DOM): only real elements count, never text in
 * comments, prose or attribute values, and (Delay JS, LazyLoad) never
 * elements inside the regions Delay JS masks (`<svg>`, `<xmp>`).
 */
import { CONTROLLER_RUN_MARKER } from '../exclusion-builder/delay-js';
import { delayMaskedRegions, firstRegionFrom } from '../exclusion-builder/delay-js-mask';
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { attributeValue, isGeneratorMeta, isGeneratorMetaName } from './generator-meta';
import { LAZY_PLACEHOLDER_PREFIX } from './lazyload-tag';
import {
  DATA_LAZY_SRC,
  DELAY_JS_SRC,
  FEATURE_META_TOKENS,
  LAZYLOAD_IFRAME_SELECTOR,
  LAZYLOAD_IMG_SELECTOR,
  LAZYLOAD_NOJS_STYLE_ID,
  LAZYLOAD_OPTIONS_ASSIGNMENT,
  LAZYLOAD_SCRIPT_PATTERN,
  WPR_DEFER_ATTRIBUTE,
  WPR_FEATURES_ATTRIBUTE,
  isDelayJSType
} from '../wp-rocket/constants';

/**
 * Whether a tag is the generator meta declaring Delay JS.
 *
 * @param tag An opening tag.
 */
function declaresDelayJs(tag: ScannedTag): boolean {
  if (!isGeneratorMeta(tag)) return false;
  const features = attributeValue(tag, WPR_FEATURES_ATTRIBUTE);
  return features?.split(/\s+/).includes(FEATURE_META_TOKENS.delay_js) ?? false;
}

/**
 * Whether a tag is a script carrying a Delay JS footprint.
 *
 * @param html The page.
 * @param tag An opening tag.
 */
function isDelayedScript(html: string, tag: ScannedTag): boolean {
  if (tag.name !== 'script') return false;
  if (isDelayJSType(attributeValue(tag, 'type'))) return true;
  if (tag.attrs.some((attr) => attr.name === DELAY_JS_SRC)) return true;
  return html.slice(tag.openingEnd, tag.contentEnd).includes(CONTROLLER_RUN_MARKER);
}

/**
 * A test of whether a tag opens inside a region Delay JS masks (`<svg>`,
 * `<xmp>`): footprints there are not real elements to WP Rocket.
 *
 * @param html The page.
 */
function maskedTagTest(html: string): (tag: ScannedTag) => boolean {
  const regions = delayMaskedRegions(html);
  return (tag) => {
    const region = regions[firstRegionFrom(regions, tag.start + 1) - 1];
    return region !== undefined && region.end > tag.start;
  };
}

/**
 * Whether the served page already delays its scripts with WP Rocket: the
 * generator meta declares `wpr_delay_js`, or a `<script>` element carries
 * a Delay JS footprint — a delay `type`, a `data-rocket-src`, or the
 * controller's run call in an inline body.
 *
 * @param html The served page.
 * @param tags Its opening tags, when already scanned (`scanTags(html)`).
 */
export function alreadyServesDelayJs(html: string, tags?: readonly ScannedTag[]): boolean {
  const masked = maskedTagTest(html);
  return (tags ?? scanTags(html)).some(
    (tag) => (declaresDelayJs(tag) || isDelayedScript(html, tag)) && !masked(tag)
  );
}

/**
 * Whether the served page already defers its scripts with WP Rocket: the
 * generator meta declares `wpr_defer_js`, or a `<script>` element carries
 * the `data-rocket-defer` attribute WP Rocket stamps on every script it
 * defers. Only real elements count (never text in comments or values).
 *
 * @param tags The page's opening tags (`scanTags(html)`).
 */
export function alreadyServesDeferJs(tags: readonly ScannedTag[]): boolean {
  return tags.some(
    (tag) =>
      (isGeneratorMeta(tag) &&
        (attributeValue(tag, WPR_FEATURES_ATTRIBUTE)
          ?.split(/\s+/)
          .includes(FEATURE_META_TOKENS.defer_all_js) ??
          false)) ||
      (tag.name === 'script' && tag.attrs.some((attr) => attr.name === WPR_DEFER_ATTRIBUTE))
  );
}

/** The generator tokens of WP Rocket's LazyLoad (images or iframes: either means its texts are printed). */
const LAZYLOAD_META_TOKENS: readonly string[] = [
  FEATURE_META_TOKENS.lazyload,
  FEATURE_META_TOKENS.lazyload_iframes
];

/** A line break as PCRE's and JS's `.` both refuse it. */
const LINE_BREAK = /[\n\r\u2028\u2029]/g;

/**
 * Whether an inline script body holds WP Rocket's LazyLoad options: its
 * assignment followed, on the same line, by the image or iframe selector
 * it names (`LAZYLOAD_IMG_OPTIONS_PATTERN` / `…IFRAME…`, read linearly:
 * each line is searched once from its first assignment).
 *
 * @param body The script's content.
 */
export function holdsLazyloadOptions(body: string): boolean {
  for (let at = body.indexOf(LAZYLOAD_OPTIONS_ASSIGNMENT); at >= 0;) {
    LINE_BREAK.lastIndex = at;
    const lineEnd = LINE_BREAK.exec(body)?.index ?? body.length;
    const line = body.slice(at + LAZYLOAD_OPTIONS_ASSIGNMENT.length, lineEnd);
    if (line.includes(LAZYLOAD_IMG_SELECTOR) || line.includes(LAZYLOAD_IFRAME_SELECTOR)) {
      return true;
    }
    at = body.indexOf(LAZYLOAD_OPTIONS_ASSIGNMENT, lineEnd);
  }
  return false;
}

/**
 * An element as a LazyLoad footprint test reads it — an opening tag off the
 * served text (the stage) or a live element (the overlay), so both ask one
 * rule ({@link isLazyloadFootprint}).
 */
export interface FootprintElement {
  /** Lowercased tag name. */
  readonly name: string;
  /**
   * An attribute's value (`null` when absent or valueless).
   *
   * @param name A lowercase attribute name.
   */
  attr(name: string): string | null;
  /**
   * Whether the element carries an attribute (valued or not).
   *
   * @param name A lowercase attribute name.
   */
  has(name: string): boolean;
  /** The element's raw text content (read only for scripts). */
  body(): string;
}

/**
 * Whether an element is a WP Rocket LazyLoad footprint — WP Rocket's own
 * markup, never the generic vanilla-lazyload a theme or another plugin
 * may set up: the generator meta declaring LazyLoad (images or iframes),
 * its runtime tag (a script loading from `wp-rocket/assets/js/lazyload/`),
 * its no-JS style (by its `id`), its inline options script (see
 * {@link holdsLazyloadOptions}), or an image carrying `data-lazy-src`
 * with its placeholder SVG as `src`. The standalone "Lazy Load by WP
 * Rocket" plugin prints the same style and image shapes: its page counts
 * as served (WP Rocket's LazyLoad would not reproduce over it).
 *
 * @param element The element.
 */
export function isLazyloadFootprint(element: FootprintElement): boolean {
  switch (element.name) {
    case 'meta': {
      if (!isGeneratorMetaName(element.attr('name'))) return false;
      const features = element.attr(WPR_FEATURES_ATTRIBUTE)?.split(/\s+/) ?? [];
      return LAZYLOAD_META_TOKENS.some((token) => features.includes(token));
    }
    case 'style':
      return element.attr('id') === LAZYLOAD_NOJS_STYLE_ID;
    case 'img':
      return (
        element.has(DATA_LAZY_SRC) &&
        (element.attr('src')?.startsWith(LAZY_PLACEHOLDER_PREFIX) ?? false)
      );
    case 'script':
      return (
        LAZYLOAD_SCRIPT_PATTERN.test(element.attr('src') ?? '') ||
        holdsLazyloadOptions(element.body())
      );
    default:
      return false;
  }
}

/**
 * A scanned opening tag as a {@link FootprintElement}.
 *
 * @param html The page.
 * @param tag An opening tag of it.
 */
function scannedElement(html: string, tag: ScannedTag): FootprintElement {
  return {
    name: tag.name,
    attr: (name) => attributeValue(tag, name),
    has: (name) => tag.attrs.some((attr) => attr.name === name),
    body: () => html.slice(tag.openingEnd, tag.contentEnd)
  };
}

/**
 * Whether the served page already carries any WP Rocket LazyLoad footprint
 * (images or iframes — an iframes-only page counts: its options script
 * would be rewritten). Only real elements count, outside the `<svg>` and
 * `<xmp>` regions (as Delay JS's evidence).
 *
 * @param html The served page.
 * @param tags Its opening tags, when already scanned (`scanTags(html)`).
 */
export function alreadyServesLazyload(html: string, tags?: readonly ScannedTag[]): boolean {
  const masked = maskedTagTest(html);
  return (tags ?? scanTags(html)).some(
    (tag) => isLazyloadFootprint(scannedElement(html, tag)) && !masked(tag)
  );
}
