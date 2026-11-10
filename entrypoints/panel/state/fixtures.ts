/**
 * Panel test fixtures: a minimal, validator-genuine `FdtData` (it survives
 * `parseFdtData` unchanged) with per-test overrides — the base all other
 * data-layer tests build their expectations on.
 */
import type { FdtData, WprDetections } from '../../../lib/wp-rocket/types';
import {
  createHardReloadBudget,
  type BudgetStorage,
  type HardReloadBudget
} from './hard-reload-budget';

/** The detection payload exactly as the engine's "nothing found" rowset. */
const EMPTY_DETECTIONS: WprDetections = {
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

/**
 * One minimal, type-genuine delayed-script record (the shape the tables and
 * the nav's live-state fixtures count over). Tests override the fields they
 * care about.
 *
 * @param overrides The fields to replace.
 * @returns The record: a whole `DelayedScriptRecord`.
 */
export function makeDelayScript(
  overrides?: Partial<FdtData['wprDetections']['delay_js']['scripts'][number]>
): FdtData['wprDetections']['delay_js']['scripts'][number] {
  return {
    inline: false,
    src: '/delayed.js',
    delayed: true,
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minifyAttribute: false,
    ...overrides
  };
}

/**
 * One minimal, type-genuine lazyload-image record.
 *
 * @param overrides The fields to replace.
 * @returns The record: a whole `LazyloadImageRecord`.
 */
export function makeLazyImage(
  overrides?: Partial<FdtData['wprDetections']['lazyload']['images'][number]>
): FdtData['wprDetections']['lazyload']['images'][number] {
  return { src: '/a.jpg', lazyloadDetected: true, excludedReasonsFound: [], ...overrides };
}

/**
 * An in-memory `BudgetStorage`: one map, the Web Storage semantics the
 * budget relies on (`getItem` answers null for a missing key). Share one
 * instance between stores to model a panel document reloading in place.
 */
export function makeMemoryStorage(): BudgetStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    }
  };
}

/**
 * The production budget over in-memory storage (fresh unless shared).
 *
 * @param storage The backing storage (default: a fresh one).
 */
export function makeHardReloadBudget(
  storage: BudgetStorage = makeMemoryStorage()
): HardReloadBudget {
  return createHardReloadBudget(
    () => storage,
    () => undefined
  );
}
