/**
 * Human-readable rendering of WP Rocket option ids.
 *
 * Feature options are named by the feature labels (`lib/detection/labels`,
 * the one declaring site of feature names), so an option row and a feature
 * card can never spell one feature two ways; the two JSON maps carry the
 * rest of the plugin vocabulary (non-feature options and diagnoser labels).
 * `getRealOptionName` is the single accessor. The JSON is imported
 * statically (small, always needed) so typings flow through the bundler.
 */

import {
  LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  LABEL_COMBINE_JAVASCRIPT,
  LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  LABEL_LOAD_JAVASCRIPT_DEFERRED,
  LABEL_MINIFY_CSS,
  LABEL_MINIFY_JAVASCRIPT,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRELOAD_FONTS,
  LABEL_PRELOAD_LINKS,
  LABEL_REMOVE_UNUSED_CSS,
  LABEL_CDN,
  LABEL_SELF_HOST_GOOGLE_FONTS,
  LABEL_WP_ROCKET
} from '../detection/labels';
import optionNames from './option-names.json' with { type: 'json' };
import otherNames from './other-names.json' with { type: 'json' };

/** Option ids that name a detected feature (or the plugin) → its feature label. */
export const FEATURE_OPTION_LABELS: Readonly<Record<string, string>> = {
  remove_unused_css: LABEL_REMOVE_UNUSED_CSS,
  async_css: LABEL_LOAD_CSS_ASYNCHRONOUSLY,
  minify_css: LABEL_MINIFY_CSS,
  minify_js: LABEL_MINIFY_JAVASCRIPT,
  minify_concatenate_js: LABEL_COMBINE_JAVASCRIPT,
  delay_js: LABEL_DELAY_JAVASCRIPT_EXECUTION,
  defer_all_js: LABEL_LOAD_JAVASCRIPT_DEFERRED,
  lazyload: LABEL_IMAGE_LAZYLOAD,
  lazyload_iframes: LABEL_IFRAMES_AND_VIDEOS_LAZYLOAD,
  lazyload_css_bg_img: LABEL_CSS_BACKGROUND_IMAGES_LAZYLOAD,
  image_dimensions: LABEL_ADD_MISSING_IMAGE_DIMENSIONS,
  host_fonts_locally: LABEL_SELF_HOST_GOOGLE_FONTS,
  auto_preload_fonts: LABEL_PRELOAD_FONTS,
  preload_links: LABEL_PRELOAD_LINKS,
  rocket_above_the_fold_optimization: LABEL_OPTIMIZE_CRITICAL_IMAGES,
  rocket_cdn: LABEL_CDN,
  wpr: LABEL_WP_ROCKET
};

/** Internal option id → user-facing label. */
const OPTION_NAMES: ReadonlyMap<string, string> = new Map<string, string>([
  ...Object.entries<string>(optionNames),
  ...Object.entries<string>(otherNames),
  ...Object.entries(FEATURE_OPTION_LABELS)
]);

/**
 * Label for an option id, or the id itself when unmapped (the diagnoser can
 * surface option ids this file does not know yet — showing the raw id is the
 * honest fallback and beats a collected crash).
 */
export function getRealOptionName(option: string): string {
  return OPTION_NAMES.get(option) ?? option;
}

/**
 * The known option ids, for registries that need to enumerate rows (never a
 * proxy for validation — unknown ids fall back above by design).
 */
export function knownOptionIds(): string[] {
  return [...OPTION_NAMES.keys()];
}
