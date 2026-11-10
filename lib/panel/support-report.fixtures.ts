/**
 * Test-only fixtures for the Detections summary and support-report suites:
 * a contract-genuine `FdtData` over the engine's "nothing found" rowset, in
 * the payload validator's own key order (so card order is the real one).
 * Imported by tests only — never by shipped code.
 */
import type { FdtData, WprDetections } from '../wp-rocket/types';

/**
 * The empty detection rowset, fresh per call (tests mutate freely).
 *
 * @returns Every detection row, absent.
 */
export function emptyDetections(): WprDetections {
  return {
    wpr: { present: false, cacheMarkerFound: false, cached: false, version: null, timeStamp: null },
    remove_unused_css: { present: false },
    async_css: { present: false, criticalStyle: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    minify_concatenate_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    mobile_cache: { present: false, variant: null },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
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
}

/**
 * A whole `FdtData` with top-level overrides.
 *
 * @param overrides Fields to replace (shallow merge).
 * @returns The payload.
 */
export function makeReportData(overrides?: Partial<FdtData>): FdtData {
  return {
    allScriptsLoaded: false,
    pageHeaders: null,
    undefinedReferencesOnPage: [],
    wprDetections: emptyDetections(),
    preloadedResources: { present: false },
    diagnoserData: null,
    ...overrides
  };
}
