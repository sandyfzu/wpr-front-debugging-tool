/**
 * Detection orchestrator: parse once, run every check once, apply the
 * presence-propagation rule, report the elapsed wall time for the
 * processing log.
 *
 * WP Rocket is "present" when its footprints say so OR when any optimization
 * was detected — except the deferral check (other tools also defer scripts)
 * and the `wpr` row itself. The rule runs after every check. The beacon
 * counts as presence: a beacon-only page (features pending, zero applied
 * markers) is a WP Rocket page.
 */

import type { PreloadedResources, WprDetections } from '../wp-rocket/types';
import { detectWpr } from './detect-wpr';
import {
  detectAsyncCss,
  detectDeferAllJs,
  detectDelayJs,
  detectLazyload,
  detectLazyloadCssBgImg,
  detectLazyloadIframes,
  detectMinifyCss,
  detectMinifyJs,
  detectPreloadLinks,
  detectPreloadedResources,
  detectRemoveUnusedCss,
  detectRocketCdn
} from './detect-optimizations';
import {
  detectAutoPreloadFonts,
  detectAutomaticLazyRendering,
  detectBeacon,
  detectOptimizeCriticalImages,
  detectPreconnectExternalDomains,
  parseBeaconConfig
} from './priority-elements';
import { parsePage } from './parse-page';
import type { ParsedPage } from './parse-page';

export interface DetectionResult {
  detections: WprDetections;
  preloadedResources: PreloadedResources;
  /** Wall time the whole pass took, for the processing log. */
  elapsedMs: number;
}

/**
 * Run the complete detection pass over a page's HTML.
 *
 * @param html The page HTML (as serialized/loaded) — parsed internally, so
 *   callers must not reuse documents across runs.
 * @returns Detections, preloaded resources and duration.
 */
export function runDetection(html: string): DetectionResult {
  const started = performance.now();
  const page = parsePage(html);
  const detections = runChecks(page);
  const preloadedResources = detectPreloadedResources(page);
  applyPresencePropagation(detections);
  return { detections, preloadedResources, elapsedMs: performance.now() - started };
}

/**
 * Run every check once over an already-parsed page. Single-sourced so the
 * bench and the orchestrator can never drift apart. The beacon config is
 * parsed once here and fed to the beacon row's check (pending-state
 * composition stays out of the engine entirely — the four feature checks
 * read page markup only).
 */
export function runChecks(page: ParsedPage): WprDetections {
  // Registry order matches the reference engine's (it is also output key
  // order, so serialized payloads compare shape-for-shape). The Priority
  // Elements rows sit together: the four feature checks, then the family's
  // shared beacon.
  const beaconConfig = parseBeaconConfig(page);
  return {
    wpr: detectWpr(page.document),
    remove_unused_css: detectRemoveUnusedCss(page),
    async_css: detectAsyncCss(page),
    delay_js: detectDelayJs(page),
    defer_all_js: detectDeferAllJs(page),
    lazyload: detectLazyload(page),
    lazyload_iframes: detectLazyloadIframes(page),
    lazyload_css_bg_img: detectLazyloadCssBgImg(page),
    rocket_above_the_fold_optimization: detectOptimizeCriticalImages(page),
    automatic_lazy_rendering: detectAutomaticLazyRendering(page),
    auto_preload_fonts: detectAutoPreloadFonts(page),
    preconnect_external_domains: detectPreconnectExternalDomains(page),
    priority_elements_beacon: detectBeacon(page, beaconConfig),
    minify_css: detectMinifyCss(page),
    minify_js: detectMinifyJs(page),
    preload_links: detectPreloadLinks(page),
    rocket_cdn: detectRocketCdn(page)
  };
}

/** Rows whose presence implies nothing about WP Rocket itself. */
const NON_PROPAGATING_KEYS: ReadonlySet<keyof WprDetections> = new Set(['wpr', 'defer_all_js']);

/**
 * An optimization found on the page implies WP Rocket handled the page. Driven
 * from the record's own keys, so a new check row propagates without a second
 * list to maintain; the exclusions above are the whole rule. Exported so the
 * content script's data hub can own the pass end-to-end over one parsed page —
 * the rule has exactly this one declaring site.
 */
export function applyPresencePropagation(detections: WprDetections): void {
  if (detections.wpr.present) return;
  const rows = Object.keys(detections) as Array<keyof WprDetections>;
  if (rows.some((key) => !NON_PROPAGATING_KEYS.has(key) && detections[key].present)) {
    // Deferral alone would not have counted (defer_all_js excluded above).
    detections.wpr.present = true;
  }
}
