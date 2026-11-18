/**
 * The panel's performance fixture: a deterministic, contract-genuine
 * `FdtData` at the payload's row caps — 5,000 scripts, 5,000 images and a
 * preload list — for the list pages' long-task checks. Seeded, so nothing is
 * committed: `PERF_FIXTURE_OUT=<path> pnpm exec vitest run perf-fixture`
 * writes it as JSON for a browser run.
 *
 * The mix is shaped like a heavy real page: mostly external scripts, a
 * delayed majority, native and plugin defers, locally excluded scripts,
 * inline code from one-liners to multi-hundred-line blocks and minified
 * one-line bundles, the odd empty script, relative and absolute URLs.
 * Development data only — no shipped module imports this file.
 */
import {
  FDT_EXCLUDED_RESOURCE,
  LAZYLOAD_EXCLUSIONS_LIST
} from '../../../../lib/wp-rocket/constants';
import type {
  DelayedScriptRecord,
  FdtData,
  LazyloadImageRecord,
  WprDetections
} from '../../../../lib/wp-rocket/types';

/** Rows per list: the payload contract's per-list cap. */
export const PERF_FIXTURE_ROWS = 5_000;

/** Preloaded subresource rows (a large but plausible hint list). */
const PRELOAD_ROWS = 200;

/**
 * A small seeded PRNG (mulberry32): the same seed always yields the same
 * fixture, so a regenerated JSON is reproducible byte for byte.
 *
 * @param seed The 32-bit seed.
 * @returns A generator of floats in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Script hosts, relative paths included (pages write both). */
const SCRIPT_BASES = [
  'https://example.test/wp-includes/js/',
  'https://example.test/wp-content/plugins/shop/assets/js/',
  'https://example.test/wp-content/themes/storefront/js/',
  'https://cdn.example-cdn.test/libs/',
  'https://www.googletagmanager.test/',
  '/wp-content/plugins/forms/js/'
] as const;

/** Script file stems. */
const SCRIPT_NAMES = [
  'jquery.min',
  'jquery-migrate',
  'hoverIntent',
  'cart-fragments',
  'slider.bundle',
  'analytics',
  'gtag',
  'lazy-embed',
  'consent-banner',
  'comment-reply'
] as const;

/** One statement of plausible inline code (one line, ~40–110 chars). */
function statement(random: () => number, index: number): string {
  const options = [
    `window.dataLayer = window.dataLayer || []; dataLayer.push({ event: 'view_${String(index)}' });`,
    `var wpApiSettings = {"root":"https:\\/\\/example.test\\/wp-json\\/","nonce":"n${String(index)}"};`,
    `document.documentElement.classList.add('js-ready-${String(index % 7)}');`,
    `if (typeof jQuery !== 'undefined') { jQuery('.menu-${String(index % 13)}').addClass('is-ready'); }`,
    `const settings${String(index)} = { lazy: true, threshold: ${String(index % 300)}, selector: '.lazy' };`
  ];
  return options[Math.floor(random() * options.length)] ?? '';
}

/**
 * Inline source text of one script, by shape: one-liner, a multi-line block,
 * a minified one-line bundle, or (rarely) empty.
 */
function inlineSource(random: () => number, index: number): string {
  const roll = random();
  if (roll < 0.01) return '';
  if (roll < 0.45) return statement(random, index);
  if (roll < 0.94) {
    // Every 250th inline script is a long block; the rest are short ones.
    const lines =
      index % 250 === 0 ? 150 + Math.floor(random() * 150) : 4 + Math.floor(random() * 4);
    return Array.from({ length: lines }, (_, line) => `  ${statement(random, index + line)}`).join(
      '\n'
    );
  }
  const statements = 10 + Math.floor(random() * 16);
  return Array.from({ length: statements }, (_, n) => statement(random, index + n)).join('');
}

/** One script record in the engine's own field order. */
function scriptRecord(random: () => number, index: number): DelayedScriptRecord {
  const delayed = random() < 0.62;
  const inline = random() < 0.42;
  const excluded = random() < 0.04;
  const exclusion = random() < 0.5 ? 'delay_js' : 'delay_js,defer_all_js';
  const deferredByWPR = !inline && random() < 0.12;
  const record: DelayedScriptRecord = {
    delayed: excluded ? false : delayed,
    inline,
    ...(inline
      ? { content: inlineSource(random, index) }
      : {
          src: `${SCRIPT_BASES[index % SCRIPT_BASES.length] ?? ''}${SCRIPT_NAMES[index % SCRIPT_NAMES.length] ?? ''}.js?ver=${String(index)}`
        }),
    deferred: !inline && (deferredByWPR || random() < 0.18),
    deferredByWPR,
    fdtExcluded: excluded ? exclusion : null,
    minifyAttribute: false
  };
  return record;
}

/** One lazyload image record. */
function imageRecord(random: () => number, index: number): LazyloadImageRecord {
  const lazyloaded = random() < 0.7;
  const reason = LAZYLOAD_EXCLUSIONS_LIST[index % LAZYLOAD_EXCLUSIONS_LIST.length] ?? '';
  const roll = random();
  const reasons = lazyloaded
    ? []
    : roll < 0.5
      ? [reason]
      : roll < 0.75
        ? [reason, FDT_EXCLUDED_RESOURCE]
        : [];
  return {
    src: `https://example.test/wp-content/uploads/2026/10/image-${String(index)}-${String(300 + (index % 9) * 100)}x${String(200 + (index % 5) * 80)}.jpg`,
    lazyloadDetected: lazyloaded,
    excludedReasonsFound: reasons
  };
}

/**
 * Generate the fixture.
 *
 * @param seed The PRNG seed (browser runs use the default).
 * @returns A contract-genuine `FdtData` (passes the boundary validator).
 */
export function generatePerfFixture(seed = 6_003): FdtData {
  const random = seededRandom(seed);
  const controller: DelayedScriptRecord = {
    delayed: false,
    inline: true,
    content:
      'class RocketLazyLoadScripts{constructor(){this.v="2.0.4",this.userEvents=["keydown","keyup","mousedown","mousemove","touchmove","touchstart","touchend","wheel"]}}',
    deferred: false,
    deferredByWPR: false,
    fdtExcluded: null,
    minifyAttribute: false
  };
  const scripts = [
    controller,
    ...Array.from({ length: PERF_FIXTURE_ROWS - 1 }, (_, index) => scriptRecord(random, index + 1))
  ];
  const images = Array.from({ length: PERF_FIXTURE_ROWS }, (_, index) =>
    imageRecord(random, index)
  );
  const preloaded = Array.from({ length: PRELOAD_ROWS }, (_, index) => ({
    href:
      index % 4 === 0
        ? `https://example.test/wp-content/themes/storefront/fonts/font-${String(index)}.woff2`
        : `https://example.test/wp-content/uploads/2026/10/hero-${String(index)}.webp`,
    type: index % 4 === 0 ? 'font' : 'image'
  }));
  const detections: WprDetections = {
    wpr: {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.20.1',
      timeStamp: 1_760_000_000
    },
    remove_unused_css: { present: true },
    async_css: { present: false, criticalStyle: false },
    lazyload_css_bg_img: { present: true },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: true },
    minify_js: { present: true },
    minify_concatenate_js: { present: false },
    preload_links: { present: true },
    rocket_cdn: { present: false },
    mobile_cache: { present: false, variant: null },
    dns_prefetch: { present: false, domains: [] },
    delay_js: {
      present: true,
      scripts,
      version: '2.0.4',
      delayedScripts: scripts.filter((script) => script.delayed).length
    },
    defer_all_js: {
      present: true,
      scripts: scripts.flatMap((script) =>
        script.deferredByWPR && script.src !== undefined ? [script.src] : []
      ),
      deferredScripts: scripts.filter((script) => script.deferredByWPR).length
    },
    lazyload: { present: true, images },
    lazyload_iframes: { present: true, replaceImage: false },
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
  return {
    allScriptsLoaded: true,
    pageHeaders: [
      { name: 'cache-control', value: 'max-age=3600' },
      { name: 'x-rocket-nginx-serving-static', value: 'HIT' }
    ],
    undefinedReferencesOnPage: [],
    wprDetections: detections,
    preloadedResources: { present: true, resources: preloaded }
  };
}
