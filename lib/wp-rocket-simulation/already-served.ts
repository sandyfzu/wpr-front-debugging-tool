/**
 * Whether a served page already carries WP Rocket's Delay JS — then the
 * simulation is the identity (WP Rocket's real output is what rows apply
 * to). Evidence, read off the served text with the tag scanner (no DOM):
 * the generator meta declaring `wpr_delay_js`, or a Delay JS footprint on
 * a `<script>` element — a delay `type`, a `data-rocket-src`, or the
 * controller's run call in an inline body. Elements inside the regions
 * Delay JS masks (`<svg>`, `<xmp>`) do not count, nor does text in
 * comments, prose or attribute values: only real elements are scanned.
 */
import { CONTROLLER_RUN_MARKER } from '../exclusion-builder/delay-js';
import { delayMaskedRegions, firstRegionFrom } from '../exclusion-builder/delay-js-mask';
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { attributeValue, isGeneratorMeta } from './generator-meta';
import {
  DELAY_JS_SRC,
  FEATURE_META_TOKENS,
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
 * Whether the served page already delays its scripts with WP Rocket.
 *
 * @param html The served page.
 * @param tags Its opening tags, when already scanned (`scanTags(html)`).
 */
export function alreadyServesDelayJs(html: string, tags?: readonly ScannedTag[]): boolean {
  const regions = delayMaskedRegions(html);
  const masked = (tag: ScannedTag): boolean => {
    const region = regions[firstRegionFrom(regions, tag.start + 1) - 1];
    return region !== undefined && region.end > tag.start;
  };
  return (tags ?? scanTags(html)).some(
    (tag) => (declaresDelayJs(tag) || isDelayedScript(html, tag)) && !masked(tag)
  );
}
