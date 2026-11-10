/**
 * Shared parse-test fixtures for the two guard suites: the canonical payloads
 * each suite mutates per case — declared once so the payload shapes can never
 * drift between them (a shape change touches exactly this file).
 */

/** An all-absent minimal detections payload (every row absent). */
export function minimalDetections(): Record<string, unknown> {
  return {
    wpr: {
      present: true,
      cacheMarkerFound: false,
      cached: false,
      version: '3.20.0.2',
      timeStamp: null
    },
    remove_unused_css: { present: false },
    delay_js: { present: false, scripts: [], version: null, delayedScripts: 0 },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    async_css: { present: false },
    lazyload: { present: false, images: [] },
    lazyload_iframes: { present: false, replaceImage: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
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

/** A fully valid minimal payload the guard tests mutate per case. */
export function validFdt(): Record<string, unknown> {
  return {
    allScriptsLoaded: false,
    pageHeaders: [{ name: 'X-Cache' }],
    undefinedReferencesOnPage: ['jQuery'],
    wprDetections: minimalDetections(),
    preloadedResources: { present: false },
    diagnoserData: null
  };
}

/** A detections payload populated with real values (rejection arms mutate it). */
export function validDetections(): Record<string, unknown> {
  return {
    wpr: {
      present: true,
      cacheMarkerFound: true,
      cached: true,
      version: '3.20.0.2',
      timeStamp: 1791342241
    },
    remove_unused_css: { present: false },
    delay_js: {
      present: true,
      scripts: [
        {
          inline: false,
          src: '/delayed.js',
          delayed: true,
          deferred: false,
          deferredByWPR: false,
          fdtExcluded: null,
          minifyAttribute: false
        }
      ],
      version: '2.0.4',
      delayedScripts: 1
    },
    defer_all_js: { present: false, scripts: [], deferredScripts: 0 },
    async_css: { present: false },
    lazyload: {
      present: false,
      images: [{ src: '/a.jpg', lazyloadDetected: false, excludedReasonsFound: ['data-src'] }]
    },
    lazyload_iframes: { present: false, replaceImage: false },
    lazyload_css_bg_img: { present: false },
    self_hosted_fonts: { present: false },
    image_dimensions: { present: false },
    minify_css: { present: false },
    minify_js: { present: false },
    preload_links: { present: false },
    rocket_cdn: { present: false },
    rocket_above_the_fold_optimization: {
      present: true,
      lcpComment: true,
      preloadedImages: ['https://s.com/hero.webp']
    },
    automatic_lazy_rendering: {
      present: true,
      lazyRenderElements: 3,
      inlineCssPresent: true,
      locationHashes: 0
    },
    auto_preload_fonts: {
      present: true,
      fonts: ['https://s.com/fonts/headings.woff2']
    },
    preconnect_external_domains: {
      present: true,
      domains: ['https://fonts.gstatic.com', 'https://example.org'],
      preconnectCount: 1
    },
    priority_elements_beacon: {
      present: true,
      status: { atf: true, lrc: true, preload_fonts: false, preconnect_external_domain: true },
      isMobile: false,
      elements: 'img, video, picture, p, main, div, li, svg, section, header, span',
      preconnect_external_domain_elements: ['link', 'script', 'iframe'],
      preload_fonts_exclusions: [],
      processed_extensions: ['woff2'],
      external_font_exclusions: []
    }
  };
}

/** A fully valid populated payload the rejection tests mutate per case. */
export function validFdtPayload(): Record<string, unknown> {
  return {
    allScriptsLoaded: false,
    pageHeaders: [{ name: 'X-Cache', value: 'MISS' }],
    undefinedReferencesOnPage: ['jQuery'],
    wprDetections: validDetections(),
    preloadedResources: { present: false },
    diagnoserData: null
  };
}
