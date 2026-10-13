/**
 * Panel test fixtures: a minimal, validator-genuine `FdtData` (it survives
 * `parseFdtData` unchanged) with per-test overrides — the base all other
 * data-layer tests build their expectations on.
 */
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';

/** The detection payload exactly as the engine's "nothing found" rowset. */
const EMPTY_DETECTIONS: WprDetections = {
  wpr: { present: false, cached: false, version: null, timeStamp: null },
  remove_unused_css: { present: false },
  async_css: { present: false },
  lazyload_css_bg_img: { present: false },
  minify_css: { present: false },
  minify_js: { present: false },
  preload_links: { present: false },
  rocket_cdn: { present: false },
  delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
  defer_all_js: { present: false, scripts: [] },
  lazyload: { present: false, images: [] },
  lazyload_iframes: { present: false, replaceImage: false },
  rocket_above_the_fold_optimization: { present: false, lcpComment: false },
  automatic_lazy_rendering: {
    present: false,
    lazyRenderElements: 0,
    inlineCssPresent: false,
    locationHashes: 0
  },
  auto_preload_fonts: { present: false, fonts: [] },
  preconnect_external_domains: { present: false, domains: [], preconnectCount: 0 },
  priority_elements_beacon: { present: false, status: null, isMobile: null }
};

/**
 * A fresh `FdtData` (never shared between tests — call per test) with the
 * given overrides merged on top of the empty baseline.
 *
 * @param overrides The fields to replace (shallow merge per top-level key).
 * @returns The data value: a whole, contract-genuine payload.
 */
export function makeFdtData(overrides?: Partial<FdtData>): FdtData {
  return {
    allScriptsLoaded: false,
    pageHeaders: null,
    undefinedReferencesOnPage: [],
    wprDetections: EMPTY_DETECTIONS,
    preloadedResources: { present: false },
    diagnoserData: null,
    ...overrides
  };
}
