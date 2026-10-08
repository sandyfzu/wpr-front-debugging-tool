/**
 * Test-only reference implementation of the detection algorithm, kept as a
 * frozen behavioral baseline: the port's engine must produce identical
 * output on every fixture (see the parity tests).
 *
 * It is type-checked (so nothing hides behind the exemption) and lint rules
 * relax only its deliberate loose typing — except one guard: it must never
 * import the port's logic modules (importing the engine under test would
 * make the parity comparison circular). What it DOES import is the shared
 * footprint vocabulary (`lib/wp-rocket/constants` — its values are pinned by
 * literal tests of their own) and the shared contract types
 * (`lib/wp-rocket/types`, type-only: erased at runtime, while also making
 * every record emitted here shape-checked against the port's contracts).
 * Only the control flow is independently re-implemented — that independence
 * is what the parity harness measures.
 *
 * Two deliberate normalizations against the original algorithm, both because
 * parsed documents never render:
 * 1. `textContent` in place of `innerText` — identical values for
 *    un-rendered documents; the test runner's `innerText` collapses
 *    whitespace non-conformantly.
 * 2. The lazyload image's `src` reads `?? ''` after the `data-lazy-src`
 *    attribute — the original emitted `null` there (an untyped accident);
 *    the port's `src: string` contract normalizes it to `''`. The parity
 *    tests therefore compare equal on srcset-only images.
 *
 * Everything else follows the reference algorithm as written, including
 * quirks that matter (radix-less timestamp parsing, reverse lazyload scans,
 * per-check re-queries of the document).
 */

import {
  BEACON_DATA_NAME,
  CACHE_COMMENT_MARKER,
  CACHE_DEBUG_MARKER,
  CACHE_TIMESTAMP_PATTERN,
  CPCSS_MARK,
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DATA_SRC,
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  DELAY_JS_VERSION_PATTERN,
  FDT_EXCLUDED_RESOURCE,
  GENERATOR_META_SELECTOR,
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  LAZYLOAD_EXCLUSIONS_LIST,
  LAZYLOAD_IFRAME_OPTIONS_PATTERN,
  LAZYLOAD_IMG_OPTIONS_PATTERN,
  LAZYLOAD_SCRIPT_PATTERN,
  LAZYLOAD_YOUTUBE_PATTERN,
  MINIFY_CSS_URL_PATTERN,
  MINIFY_JS_URL_PATTERN,
  PRELOAD_LINKS_SCRIPT_ID,
  ROCKET_CDN_DOMAIN,
  RUCSS_STYLE_SELECTOR,
  WPR_DEFER_ATTRIBUTE,
  WPR_NAME_PATTERN,
  WPR_PRELOAD_ATTRIBUTE,
  extractWprVersion,
  isDelayJSType
} from '../../wp-rocket/constants';
import type { PreloadedResources, WprDetections } from '../../wp-rocket/types';

export type CheckOptimizationFunctionPayload = {
  HTMLDocument: Document;
  pageHTML: string;
  pageScripts: Array<HTMLScriptElement>;
  pageLinkElements: Array<HTMLLinkElement>;
};
export type CheckOptimizationFunction = (payload: CheckOptimizationFunctionPayload) => {
  present: boolean;
  [k: string]: any;
};

const CheckOptimizationFunctions: Record<keyof WprDetections, CheckOptimizationFunction> = {
  wpr: wprCached,
  remove_unused_css: checkRUCSS,
  async_css: checkCPCSS,
  delay_js: checkDelayJS,
  defer_all_js: checkScriptsDeferred,
  lazyload: checkLazyLoad,
  lazyload_iframes: checkLazyLoadIframes,
  lazyload_css_bg_img: checkLLCSSBG,
  rocket_above_the_fold_optimization: checkOptimizeCriticalImages,
  minify_css: checkMinifyCSS,
  minify_js: checkMinifyJS,
  preload_links: checkPreloadLinks,
  rocket_cdn: checkRocketCDN
} as const;

function wprCached({ HTMLDocument }: CheckOptimizationFunctionPayload): WprDetections['wpr'] {
  const wpr: WprDetections['wpr'] = {
    present: false,
    cached: false,
    version: null,
    timeStamp: null
  };
  const metaTag = Array.from(
    HTMLDocument.querySelectorAll<HTMLMetaElement>(GENERATOR_META_SELECTOR)
  ).find((tag) => WPR_NAME_PATTERN.test(tag.content));
  if (metaTag?.content) {
    wpr.version = extractWprVersion(metaTag.content);
  }
  wpr.present = Boolean(wpr.version);

  let documentSibling = HTMLDocument.documentElement.nextSibling as Comment;
  while (documentSibling) {
    if (documentSibling.data && documentSibling.data.includes(CACHE_COMMENT_MARKER)) {
      wpr.present = true;
      if (documentSibling.data.includes(CACHE_DEBUG_MARKER)) {
        wpr.cached = true;
        const timeStamp = documentSibling.data.match(CACHE_TIMESTAMP_PATTERN)?.[1];
        if (timeStamp) {
          wpr.timeStamp = parseInt(timeStamp);
        }
      }
      break;
    }
    documentSibling = documentSibling.nextSibling as Comment;
  }
  return wpr;
}

function checkLLCSSBG({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['lazyload_css_bg_img'] {
  const llcssbg =
    HTMLDocument.getElementById(LAZYLOAD_BG_CONTAINER_ID) ||
    HTMLDocument.getElementById(LAZYLOAD_BG_EXCLUSION_ID);
  return { present: Boolean(llcssbg) };
}

function checkRUCSS({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['remove_unused_css'] {
  const rucss = HTMLDocument.querySelector<HTMLStyleElement>(RUCSS_STYLE_SELECTOR);
  if (rucss) return { present: true };
  return { present: false };
}

function checkCPCSS({ pageScripts }: CheckOptimizationFunctionPayload): WprDetections['async_css'] {
  const present = pageScripts.some((script) => {
    if (!script.getAttribute('src')) return script.textContent?.includes(CPCSS_MARK);
    return false;
  });
  return { present };
}

function checkDelayJS({
  pageScripts
}: CheckOptimizationFunctionPayload): WprDetections['delay_js'] {
  const delayjs: WprDetections['delay_js'] = {
    present: false,
    scripts: [],
    delayedScripts: 0,
    version: null
  };
  for (const script of pageScripts) {
    const s: any = {
      delayed: false,
      inline: false
    };
    if (!delayjs.present && !script.hasAttribute('src')) {
      if (script.textContent?.includes(DELAY_JS_CONTROLLER)) {
        delayjs.present = true;
        delayjs.version = script.textContent.match(DELAY_JS_VERSION_PATTERN)?.[1] ?? null;
      }
    }
    if (isDelayJSType(script.getAttribute('type'))) {
      delayjs.present = true;
      s.delayed = true;
      if (script.hasAttribute(DELAY_JS_SRC)) {
        s.src = script.getAttribute(DELAY_JS_SRC);
      } else {
        s.inline = true;
        // `textContent` in place of `innerText`: identical for documents
        // that never render (the runtime target reads them the same), while
        // the test runner's `innerText` collapses whitespace
        // non-conformantly.
        s.content = script.textContent;
      }
      delayjs.delayedScripts++;
    } else {
      if (script.hasAttribute('src')) {
        s.src = script.getAttribute('src');
      } else {
        s.inline = true;
        s.content = script.textContent;
      }
    }
    s.deferred = script.hasAttribute('defer');
    s.deferredByWPR = script.hasAttribute(WPR_DEFER_ATTRIBUTE);
    s.fdtExcluded = script.getAttribute(FDT_EXCLUDED_RESOURCE);
    delayjs.scripts?.push(s);
  }
  return delayjs;
}

function checkLazyLoad({
  pageScripts,
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['lazyload'] {
  let containsLazyloadScript = false;
  let containsLazyloadInlineScript = false;
  for (const script of [...pageScripts].reverse()) {
    if (containsLazyloadScript && containsLazyloadInlineScript) break;
    const src = script.getAttribute('src');
    if (src && src.match(LAZYLOAD_SCRIPT_PATTERN)) {
      containsLazyloadScript = true;
      continue;
    }
    if (script.textContent?.match(LAZYLOAD_IMG_OPTIONS_PATTERN)) {
      containsLazyloadInlineScript = true;
    }
  }
  const isPresent = containsLazyloadScript && containsLazyloadInlineScript;
  const allImages: WprDetections['lazyload']['images'] = Array.from(
    HTMLDocument.querySelectorAll('img')
  ).map((img) => {
    const llItem: any = {
      src: img.src,
      lazyloadDetected: img.hasAttribute(DATA_LAZY_SRC) || img.hasAttribute(DATA_LAZY_SRCSET),
      excludedReasonsFound: []
    };
    llItem.src = llItem.lazyloadDetected
      ? (img.getAttribute(DATA_LAZY_SRC) ?? '')
      : (img.getAttribute(DATA_SRC) ?? img.src ?? '');
    llItem.excludedReasonsFound = LAZYLOAD_EXCLUSIONS_LIST.filter((ex) => {
      return ex !== DATA_LAZY_SRC && img.outerHTML.includes(ex);
    });
    return llItem;
  });

  return { present: Boolean(isPresent), images: allImages };
}

function checkLazyLoadIframes({
  pageScripts
}: CheckOptimizationFunctionPayload): WprDetections['lazyload_iframes'] {
  let containsLazyloadScript = false;
  let containsLazyloadInlineScript = false;
  let replaceImageScript = false;
  for (const script of [...pageScripts].reverse()) {
    if (containsLazyloadScript && containsLazyloadInlineScript) break;
    const src = script.getAttribute('src');
    if (src && src.match(LAZYLOAD_SCRIPT_PATTERN)) {
      containsLazyloadScript = true;
      continue;
    }
    if (script.textContent?.match(LAZYLOAD_IFRAME_OPTIONS_PATTERN)) {
      containsLazyloadInlineScript = true;
    }
    if (script.textContent?.match(LAZYLOAD_YOUTUBE_PATTERN)) {
      replaceImageScript = true;
    }
  }
  const isPresent = containsLazyloadScript && containsLazyloadInlineScript;
  const replaceImage = isPresent && replaceImageScript;

  return { present: isPresent, replaceImage };
}

function checkMinifyCSS({
  pageLinkElements
}: CheckOptimizationFunctionPayload): WprDetections['minify_css'] {
  const isPresent = pageLinkElements.some((link) => {
    if (link.rel === 'stylesheet') {
      if (link.href?.match(MINIFY_CSS_URL_PATTERN)) {
        return true;
      }
    }
    return false;
  });
  return isPresent ? { present: true } : { present: false };
}

function checkMinifyJS({
  pageScripts
}: CheckOptimizationFunctionPayload): WprDetections['minify_js'] {
  const isPresent = pageScripts.some((script) => {
    if (script.getAttribute('src')) {
      if (script.src?.match(MINIFY_JS_URL_PATTERN)) {
        return true;
      }
    }
    return false;
  });
  return isPresent ? { present: true } : { present: false };
}

function checkPreloadLinks({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['preload_links'] {
  const preloadLinks = { present: false };
  if (HTMLDocument.querySelector(`#${PRELOAD_LINKS_SCRIPT_ID}`)) {
    preloadLinks.present = true;
  }
  return preloadLinks;
}

function checkRocketCDN({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['rocket_cdn'] {
  const prefetchElements = Array.from(
    HTMLDocument.querySelectorAll<HTMLLinkElement>('link[rel="dns-prefetch"]')
  );
  if (prefetchElements.length === 0) return { present: false };
  for (const link of prefetchElements) {
    if (link.href?.includes(ROCKET_CDN_DOMAIN)) {
      return { present: true };
    }
  }
  return { present: false };
}

function checkScriptsDeferred({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['defer_all_js'] {
  const scripts = Array.from(
    HTMLDocument.querySelectorAll<HTMLScriptElement>(`script[${WPR_DEFER_ATTRIBUTE}]`)
  )
    .map(
      (script: HTMLScriptElement) =>
        script.getAttribute(DELAY_JS_SRC) ?? script.getAttribute('src') ?? ''
    )
    .filter((src) => Boolean(src));
  if (scripts.length > 0) {
    return { present: true, scripts };
  }
  return { present: false, scripts: [] };
}

function checkOptimizeCriticalImages({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['rocket_above_the_fold_optimization'] {
  const beacon = HTMLDocument.querySelector(`script[data-name="${BEACON_DATA_NAME}"]`);
  if (beacon) {
    return { present: true, beacon: true };
  }
  const preloadedImagesLinks = HTMLDocument.querySelectorAll<HTMLLinkElement>(
    `link[${WPR_PRELOAD_ATTRIBUTE}][as="image"]`
  );
  if (preloadedImagesLinks.length > 0) {
    const preloadedImagesURL = Array.from(preloadedImagesLinks).map((link) => link.href ?? '');
    return { present: true, beacon: false, preloadedImages: preloadedImagesURL };
  }
  return { present: false, beacon: false };
}

export function checkPreloadedResources(HTMLDocument: Document): PreloadedResources {
  const preloadedResourcesLinks = HTMLDocument.querySelectorAll<HTMLLinkElement>(
    `link[${WPR_PRELOAD_ATTRIBUTE}]`
  );
  if (preloadedResourcesLinks.length === 0) {
    return { present: false };
  }
  const resourcesURLs = Array.from(preloadedResourcesLinks).map((link) => ({
    href: link.href,
    type: link.as ?? ''
  }));
  return { present: true, resources: resourcesURLs };
}

export default CheckOptimizationFunctions;

/**
 * One full detection pass, replicating the reference orchestration exactly:
 * fresh document queries per check, then the presence-propagation rule.
 */
export function runReferenceDetection(pageHTML: string): {
  wprDetections: WprDetections;
  preloadedResources: PreloadedResources;
} {
  const HTMLDocument = new DOMParser().parseFromString(pageHTML, 'text/html');
  const pageScripts = Array.from(HTMLDocument.querySelectorAll('script'));
  const pageLinkElements = Array.from(HTMLDocument.querySelectorAll('link'));
  const wprDetections: any = {};
  for (const [name, func] of Object.entries(CheckOptimizationFunctions) as [
    keyof WprDetections,
    CheckOptimizationFunction
  ][]) {
    wprDetections[name] = func({ pageHTML, HTMLDocument, pageScripts, pageLinkElements });
  }
  const preloadedResources = checkPreloadedResources(HTMLDocument);
  if (wprDetections.wpr) {
    const temp = wprDetections as WprDetections;
    if (!temp.wpr.present) {
      for (const [key, value] of Object.entries(temp)) {
        if (key === 'defer_all_js' || key === 'wpr') continue;
        if (value.present) {
          temp.wpr.present = true;
          break;
        }
      }
    }
  }
  return { wprDetections: wprDetections as WprDetections, preloadedResources };
}
