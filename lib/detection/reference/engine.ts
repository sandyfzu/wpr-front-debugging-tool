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
 * Committed semantic deviations, applied to the reference in lockstep with
 * the port so the parity harness keeps comparing like-for-like:
 *
 * 1. The Optimize-critical-images check no longer treats shared-beacon
 *    presence as its verdict. The beacon is one signal for four features (the
 *    Priority Elements family), so applied evidence (the image preloads,
 *    regardless of the beacon) is the row's verdict, the `<!-- wpr_oci -->`
 *    comment is corroboration, and the beacon moved to the dedicated
 *    `priority_elements_beacon` row. The three further Priority Elements
 *    checks (Automatic Lazy Rendering, Preload fonts, Preconnect to external
 *    domains) and the beacon row have no original-algorithm counterpart —
 *    they are corrected-baseline implementations whose behavior this file
 *    pins for parity.
 * 2. The generator declaration's authority: a usable `data-wpr-features`
 *    decides every mapped row's presence (and its `source`) before the
 *    presence-propagation rule. The port and this reference implement the
 *    same bounded parse and verdict rule independently; the meta expectations
 *    are pinned by their own table-driven suite, not claimed as source parity.
 * 3. URL-recognized scripts (minify JS, both lazyload scans, the beacon's URL
 *    fallback) read the served URL: on a delayed tag (`type` ending in
 *    `rocketlazyloadscript`, any case — the Delay JS runtime's own selector)
 *    a non-empty `data-rocket-src` (where Delay JS moves `src`) before `src`,
 *    resolved against the document base; each check's empty-URL gate tests
 *    that served value. Side effect on undelayed pages: both lazyload scans
 *    now match the resolved `src` property instead of the raw attribute —
 *    identical for real URLs, they can differ only on degenerate paths
 *    (`..` segments, backslashes) that resolution normalizes.
 * 4. The minify attribute (`data-minify="1"`, exact) on a stylesheet link
 *    with a non-empty `href` or a served-URL script decides its minify row as footprint when the cache
 *    URL missed — only where the declaration decided nothing (`absent`) and
 *    WP Rocket was already proven before it (signature/version, generator
 *    tag, or any present row but `wpr`/`defer_all_js`, the minify rows by
 *    their URL arm only). Every script record carries the stamp
 *    (`minifyAttribute`).
 *
 * The port's contract additions (the cache-marker flag with its comment-only
 * white-label registry and strict display-domain timestamp, the defer count,
 * the self-hosted fonts row and the declaration-only image-dimensions and
 * Combine-JavaScript rows) are mirrored here so the records stay key-for-key
 * comparable.
 *
 * Everything else follows the reference algorithm as written, including
 * quirks that matter (reverse lazyload scans, per-check re-queries of the
 * document).
 */

import {
  BEACON_CONFIG_LIMITS,
  BEACON_CONFIG_LIST_FIELDS,
  BEACON_CONFIG_PATTERN,
  BEACON_CONFIG_TRAILING_NOISE,
  BEACON_DATA_NAME,
  BEACON_SRC_PATTERN,
  BEACON_STATUS_KEYS,
  CACHE_COMMENT_MARKERS,
  CACHE_DEBUG_MARKER,
  CPCSS_MARK,
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DATA_ROCKET_STATUS,
  DATA_SRC,
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  DELAY_JS_TYPE_OLD,
  DELAY_JS_VERSION_PATTERN,
  FEATURE_COMMENT_PATTERN,
  FEATURE_META_LIMITS,
  FEATURE_META_TOKENS,
  FDT_EXCLUDED_RESOURCE,
  GENERATOR_META_SELECTOR,
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  LAZYLOAD_EXCLUSIONS_LIST,
  LAZYLOAD_IFRAME_OPTIONS_PATTERN,
  LAZYLOAD_IMG_OPTIONS_PATTERN,
  LAZYLOAD_SCRIPT_PATTERN,
  LAZYLOAD_YOUTUBE_PATTERN,
  LAZY_RENDER_ATTRIBUTE,
  LAZY_RENDER_INLINE_CSS_ID,
  LOCATION_HASH_ATTRIBUTE,
  MINIFY_ATTRIBUTE,
  MINIFY_ATTRIBUTE_VALUE,
  MINIFY_CSS_URL_PATTERN,
  MINIFY_JS_URL_PATTERN,
  OPTIMIZE_CRITICAL_IMAGES_COMMENT,
  PRELOAD_LINKS_CONFIG_MARK,
  PRELOAD_LINKS_SCRIPT_ID,
  ROCKET_CDN_DOMAIN,
  ROCKET_PREFETCH_ATTRIBUTE,
  ROCKET_PRECONNECT_ATTRIBUTE,
  RUCSS_STYLE_SELECTOR,
  SELF_HOSTED_FONTS_ATTRIBUTE,
  SELF_HOSTED_FONTS_CACHE_PATH,
  WPR_DEFER_ATTRIBUTE,
  WPR_FEATURES_ATTRIBUTE,
  WPR_FEATURES_META_SELECTOR,
  WPR_NAME_PATTERN,
  WPR_PRELOAD_ATTRIBUTE,
  extractWprVersion,
  isDelayJSType,
  parseCacheTimestampToken
} from '../../wp-rocket/constants';
import type {
  BeaconFeatureStatus,
  FeatureMetaRow,
  PreloadedResources,
  WprDetections
} from '../../wp-rocket/types';

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
  self_hosted_fonts: checkSelfHostedFonts,
  image_dimensions: checkImageDimensions,
  rocket_above_the_fold_optimization: checkOptimizeCriticalImages,
  automatic_lazy_rendering: checkAutomaticLazyRendering,
  auto_preload_fonts: checkAutoPreloadFonts,
  preconnect_external_domains: checkPreconnectExternalDomains,
  priority_elements_beacon: checkPriorityElementsBeacon,
  minify_css: checkMinifyCSS,
  minify_js: checkMinifyJS,
  minify_concatenate_js: checkCombineJS,
  preload_links: checkPreloadLinks,
  rocket_cdn: checkRocketCDN
} as const;

function wprCached({ HTMLDocument }: CheckOptimizationFunctionPayload): WprDetections['wpr'] {
  const wpr: WprDetections['wpr'] = {
    present: false,
    cacheMarkerFound: false,
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

  let documentSibling = HTMLDocument.documentElement.nextSibling;
  while (documentSibling) {
    if (documentSibling instanceof Comment) {
      const data = documentSibling.data.trimStart();
      if (CACHE_COMMENT_MARKERS.some((marker) => data.startsWith(marker))) {
        wpr.present = true;
        wpr.cacheMarkerFound = true;
        if (data.includes(CACHE_DEBUG_MARKER)) {
          wpr.cached = true;
          wpr.timeStamp = parseCacheTimestampToken(data);
        }
        break;
      }
    }
    documentSibling = documentSibling.nextSibling;
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

function checkSelfHostedFonts({
  pageLinkElements
}: CheckOptimizationFunctionPayload): WprDetections['self_hosted_fonts'] {
  return {
    present: pageLinkElements.some(
      (link) =>
        link.hasAttribute(SELF_HOSTED_FONTS_ATTRIBUTE) ||
        link.href.includes(SELF_HOSTED_FONTS_CACHE_PATH)
    )
  };
}

function checkImageDimensions(): WprDetections['image_dimensions'] {
  return { present: false };
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
    version: null,
    delayedScripts: 0
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
    if (script.hasAttribute(DATA_ROCKET_STATUS)) delayjs.present = true;
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
    s.minifyAttribute = script.getAttribute(MINIFY_ATTRIBUTE) === MINIFY_ATTRIBUTE_VALUE;
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
    if (rawServedSrc(script) && resolvedServedSrc(script).match(LAZYLOAD_SCRIPT_PATTERN)) {
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
    if (rawServedSrc(script) && resolvedServedSrc(script).match(LAZYLOAD_SCRIPT_PATTERN)) {
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

/**
 * Delay JS's moved URL (deviation 3): read only on tags its runtime loads —
 * `type` ending in the delay marker, case-insensitively.
 *
 * @param script The script element.
 * @returns The `data-rocket-src` value on a delayed tag, else `null`.
 */
function delayedServedSrc(script: HTMLScriptElement): string | null {
  const type = (script.getAttribute('type') || '').toLowerCase();
  if (!type.endsWith(DELAY_JS_TYPE_OLD)) return null;
  return script.getAttribute(DELAY_JS_SRC);
}

/**
 * The served URL as written (deviation 3): a delayed tag's `data-rocket-src`
 * when non-empty, otherwise `src`.
 *
 * @param script The script element.
 * @returns The raw served URL, or `null` when the tag names none.
 */
function rawServedSrc(script: HTMLScriptElement): string | null {
  return delayedServedSrc(script) || script.getAttribute('src');
}

/**
 * The served URL resolved like the `src` property (deviation 3).
 *
 * @param script The script element.
 * @returns The absolute URL; the raw value when it does not parse.
 */
function resolvedServedSrc(script: HTMLScriptElement): string {
  const delayed = delayedServedSrc(script);
  if (!delayed) return script.src;
  try {
    return new URL(delayed, script.baseURI).href;
  } catch {
    return delayed;
  }
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
    if (rawServedSrc(script)) {
      if (resolvedServedSrc(script).match(MINIFY_JS_URL_PATTERN)) {
        return true;
      }
    }
    return false;
  });
  return isPresent ? { present: true } : { present: false };
}

function checkCombineJS(): WprDetections['minify_concatenate_js'] {
  return { present: false };
}

function checkPreloadLinks({
  HTMLDocument,
  pageScripts
}: CheckOptimizationFunctionPayload): WprDetections['preload_links'] {
  if (HTMLDocument.querySelector(`#${PRELOAD_LINKS_SCRIPT_ID}`)) return { present: true };
  let mentions = 0;
  for (const script of pageScripts) {
    mentions += (script.textContent ?? '').split(PRELOAD_LINKS_CONFIG_MARK).length - 1;
    if (mentions > 1) return { present: true };
  }
  return { present: false };
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
  const attributed = Array.from(
    HTMLDocument.querySelectorAll<HTMLScriptElement>(`script[${WPR_DEFER_ATTRIBUTE}]`)
  );
  const scripts = attributed
    .map(
      (script: HTMLScriptElement) =>
        script.getAttribute(DELAY_JS_SRC) ?? script.getAttribute('src') ?? ''
    )
    .filter((src) => Boolean(src));
  return { present: attributed.length > 0, scripts, deferredScripts: attributed.length };
}

function checkOptimizeCriticalImages({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['rocket_above_the_fold_optimization'] {
  // Applied evidence only: the image preloads, collected regardless of the
  // beacon (a partial page applies one feature while the beacon serves a
  // sibling — both signals must surface).
  const preloadedImagesLinks = HTMLDocument.querySelectorAll<HTMLLinkElement>(
    `link[${WPR_PRELOAD_ATTRIBUTE}][as="image"]`
  );
  const preloadedImagesURL = Array.from(preloadedImagesLinks).map((link) => link.href ?? '');
  const lcpComment = collectFeatureComments(HTMLDocument).includes(
    OPTIMIZE_CRITICAL_IMAGES_COMMENT
  );
  if (preloadedImagesURL.length > 0) {
    return { present: true, lcpComment, preloadedImages: preloadedImagesURL };
  }
  return { present: false, lcpComment };
}

function checkAutomaticLazyRendering({
  HTMLDocument
}: CheckOptimizationFunctionPayload): WprDetections['automatic_lazy_rendering'] {
  const lazyRenderElements = HTMLDocument.querySelectorAll(`[${LAZY_RENDER_ATTRIBUTE}]`).length;
  const locationHashes = HTMLDocument.querySelectorAll(`[${LOCATION_HASH_ATTRIBUTE}]`).length;
  const inlineCssPresent = HTMLDocument.getElementById(LAZY_RENDER_INLINE_CSS_ID) !== null;
  return { present: lazyRenderElements > 0, lazyRenderElements, inlineCssPresent, locationHashes };
}

function checkAutoPreloadFonts({
  pageLinkElements
}: CheckOptimizationFunctionPayload): WprDetections['auto_preload_fonts'] {
  const fonts = pageLinkElements
    .filter(
      (link: HTMLLinkElement) =>
        link.hasAttribute(WPR_PRELOAD_ATTRIBUTE) &&
        (link.getAttribute('rel') ?? '').toLowerCase() === 'preload' &&
        link.getAttribute('as') === 'font'
    )
    .map((link: HTMLLinkElement) => link.href)
    .filter((href: string) => href !== '');
  return { present: fonts.length > 0, fonts };
}

function checkPreconnectExternalDomains({
  pageLinkElements
}: CheckOptimizationFunctionPayload): WprDetections['preconnect_external_domains'] {
  const domains: string[] = [];
  let preconnectCount = 0;
  for (const link of pageLinkElements) {
    const prefetchVariant = link.hasAttribute(ROCKET_PREFETCH_ATTRIBUTE);
    const preconnectVariant = link.hasAttribute(ROCKET_PRECONNECT_ATTRIBUTE);
    if (!prefetchVariant && !preconnectVariant) continue;
    const href = link.href;
    if (href !== '' && !domains.includes(href)) domains.push(href);
    if (preconnectVariant) preconnectCount += 1;
  }
  return { present: domains.length > 0, domains, preconnectCount };
}

function checkPriorityElementsBeacon({
  pageScripts
}: CheckOptimizationFunctionPayload): WprDetections['priority_elements_beacon'] {
  const tagPresent = pageScripts.some(
    (script: HTMLScriptElement) => script.getAttribute('data-name') === BEACON_DATA_NAME
  );
  const srcPresent = pageScripts.some((script: HTMLScriptElement) =>
    BEACON_SRC_PATTERN.test(resolvedServedSrc(script))
  );
  if (!tagPresent && !srcPresent) {
    return { present: false, status: null, isMobile: null };
  }
  const config = parseReferenceBeaconConfig(pageScripts);
  if (config === null) {
    return { present: true, status: null, isMobile: null };
  }
  return { present: true, ...config };
}

/**
 * The inline beacon config, independently parsed over the shared vocabulary:
 * first config script in document order; JSON after the assignment with a
 * tolerated trailing `;`; any malformed/hostile part degrades the whole
 * config. Same rules, same caps, independently implemented.
 */
function parseReferenceBeaconConfig(
  pageScripts: Array<HTMLScriptElement>
): Omit<WprDetections['priority_elements_beacon'], 'present'> | null {
  for (const script of pageScripts) {
    const match = BEACON_CONFIG_PATTERN.exec(script.textContent);
    if (match === null) continue;
    const tail = script.textContent
      .slice(match[0].length)
      .replace(BEACON_CONFIG_TRAILING_NOISE, '');
    if (tail.length > BEACON_CONFIG_LIMITS.text) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(tail);
    } catch {
      try {
        parsed = parseReferenceJsLiteral(tail);
      } catch {
        return null;
      }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const config: any = { status: null, isMobile: null };
    if (parsed.status !== undefined) {
      const status = parseReferenceStatusMap(parsed.status);
      if (status === null) return null;
      config.status = status;
    }
    if (parsed.is_mobile !== undefined) {
      if (typeof parsed.is_mobile !== 'boolean') return null;
      config.isMobile = parsed.is_mobile;
    }
    if (parsed.elements !== undefined) {
      if (
        typeof parsed.elements !== 'string' ||
        parsed.elements.length > BEACON_CONFIG_LIMITS.elements
      )
        return null;
      config.elements = parsed.elements;
    }
    for (const field of BEACON_CONFIG_LIST_FIELDS) {
      if (parsed[field] === undefined) continue;
      const list = parseReferenceStringList(parsed[field]);
      if (list === null) return null;
      config[field] = list;
    }
    return config;
  }
  return null;
}

/** Known status keys must be booleans; unknown keys kept only when bounded primitives. */
function parseReferenceStatusMap(status: any): BeaconFeatureStatus | null {
  if (status === null || typeof status !== 'object' || Array.isArray(status)) return null;
  const keys = Object.keys(status);
  if (keys.length > BEACON_CONFIG_LIMITS.status.keys) return null;
  const parsed: any = {};
  for (const key of keys) {
    const value = status[key];
    // Same rule as the port: an own `__proto__` key is hostile (assignment
    // would go through the inherited setter) — the map degrades.
    if (key === '__proto__') return null;
    if ((BEACON_STATUS_KEYS as readonly string[]).includes(key)) {
      if (typeof value !== 'boolean') return null;
      parsed[key] = value;
    } else if (isReferenceBoundedPrimitive(value)) {
      parsed[key] = value;
    } else {
      return null;
    }
  }
  return parsed;
}

function isReferenceBoundedPrimitive(value: any): boolean {
  if (typeof value === 'boolean' || value === null) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= BEACON_CONFIG_LIMITS.status.chars;
  return false;
}

function parseReferenceStringList(value: any): string[] | null {
  if (!Array.isArray(value) || value.length > BEACON_CONFIG_LIMITS.lists.count) return null;
  const list: string[] = [];
  for (const item of value) {
    if (
      typeof item !== 'string' ||
      item.length < 1 ||
      item.length > BEACON_CONFIG_LIMITS.lists.chars
    ) {
      return null;
    }
    list.push(item);
  }
  return list;
}

/**
 * The JavaScript-literal fallback, independently implemented over the same
 * rules as the port's parser: bounded recursion (≤ 4 levels), ≤ 2,000
 * values, full input consumption required, JSON escape set in either quote
 * style, strict unknown-escape failure — anything else throws and the
 * config degrades.
 */
function parseReferenceJsLiteral(text: string): unknown {
  const MAX_VALUES = 2_000;
  const MAX_DEPTH = 4;
  let pos = 0;
  let values = 0;

  function fail(why: string): never {
    throw new Error(`reference literal: ${why} (at ${String(pos)})`);
  }

  function skipWs(): void {
    while (pos < text.length && /\s/.test(text.charAt(pos))) pos += 1;
  }

  function parseValue(depth: number): any {
    values += 1;
    if (values > MAX_VALUES) fail('too many values');
    if (depth > MAX_DEPTH) fail('nesting too deep');
    skipWs();
    const c = text.charAt(pos);
    if (c === '{') return parseObject(depth + 1);
    if (c === '[') return parseArray(depth + 1);
    if (c === "'" || c === '"') return parseString(c);
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    if (text.startsWith('true', pos)) {
      pos += 4;
      return true;
    }
    if (text.startsWith('false', pos)) {
      pos += 5;
      return false;
    }
    if (text.startsWith('null', pos)) {
      pos += 4;
      return null;
    }
    fail(`unexpected character ${JSON.stringify(c)}`);
  }

  function parseObject(depth: number): Record<string, unknown> {
    pos += 1;
    const object: Record<string, unknown> = {};
    skipWs();
    if (text.charAt(pos) === '}') {
      pos += 1;
      return object;
    }
    for (;;) {
      skipWs();
      const key = parseKey();
      skipWs();
      if (text.charAt(pos) !== ':') fail('expected :');
      pos += 1;
      object[key] = parseValue(depth);
      skipWs();
      if (text.charAt(pos) === ',') {
        pos += 1;
        skipWs();
        if (text.charAt(pos) === '}') {
          pos += 1;
          return object; // tolerated trailing comma
        }
        continue;
      }
      if (text.charAt(pos) === '}') {
        pos += 1;
        return object;
      }
      fail('expected , or }');
    }
  }

  function parseArray(depth: number): unknown[] {
    pos += 1;
    const array: unknown[] = [];
    skipWs();
    if (text.charAt(pos) === ']') {
      pos += 1;
      return array;
    }
    for (;;) {
      array.push(parseValue(depth));
      skipWs();
      if (text.charAt(pos) === ',') {
        pos += 1;
        skipWs();
        if (text.charAt(pos) === ']') {
          pos += 1;
          return array; // tolerated trailing comma
        }
        continue;
      }
      if (text.charAt(pos) === ']') {
        pos += 1;
        return array;
      }
      fail('expected , or ]');
    }
  }

  function parseKey(): string {
    skipWs();
    const c = text.charAt(pos);
    if (c === "'" || c === '"') return parseString(c);
    const bare = /[A-Za-z_$][A-Za-z0-9_$]*/y;
    bare.lastIndex = pos;
    const match = bare.exec(text);
    if (match === null) fail('expected key');
    pos = bare.lastIndex;
    return match[0];
  }

  function parseString(quote: string): string {
    pos += 1;
    let out = '';
    for (;;) {
      if (pos >= text.length) fail('unterminated string');
      const c = text.charAt(pos);
      if (c === quote) {
        pos += 1;
        return out;
      }
      if (c === '\\') {
        const next = text.charAt(pos + 1);
        if (next === "'" || next === '"' || next === '\\' || next === '/') {
          out += next;
          pos += 2;
          continue;
        }
        const simple: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (next === 'b' || next === 'f' || next === 'n' || next === 'r' || next === 't') {
          out += simple[next] as string;
          pos += 2;
          continue;
        }
        if (next === 'u') {
          const hex = text.slice(pos + 2, pos + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
          continue;
        }
        fail(`unknown escape \\${next}`);
      }
      out += c;
      pos += 1;
    }
  }

  function parseNumber(): number {
    const pattern = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    pattern.lastIndex = pos;
    const match = pattern.exec(text);
    if (match === null) fail('bad number');
    pos = pattern.lastIndex;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail('non-finite number');
    return value;
  }

  const value = parseValue(0);
  skipWs();
  if (pos !== text.length) fail('trailing content');
  return value;
}

/** Feature-comment ids on the page (the port's parse collects them once). */
function collectFeatureComments(HTMLDocument: Document): string[] {
  const walker = HTMLDocument.createTreeWalker(HTMLDocument, NodeFilter.SHOW_COMMENT);
  const comments: string[] = [];
  for (let node = walker.nextNode(); node !== null;) {
    const data = (node as Comment).data;
    if (FEATURE_COMMENT_PATTERN.test(data)) comments.push(data.trim());
    node = walker.nextNode();
  }
  return comments;
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

/** The declaration's parsed shape (the same caps the port enforces). */
interface ReferenceFeatureMeta {
  attributePresent: boolean;
  tokens: string[];
  degraded: boolean;
}

/** Parse the generator declaration: absent, present, or degraded by a cap. */
function parseReferenceFeatureMeta(HTMLDocument: Document): ReferenceFeatureMeta {
  const meta = HTMLDocument.querySelector<HTMLMetaElement>(WPR_FEATURES_META_SELECTOR);
  if (meta === null) return { attributePresent: false, tokens: [], degraded: false };
  const raw = meta.getAttribute(WPR_FEATURES_ATTRIBUTE) as string;
  if (raw.length > FEATURE_META_LIMITS.totalChars) {
    return { attributePresent: true, tokens: [], degraded: true };
  }
  const tokens = raw.split(/\s+/).filter((token) => token !== '');
  if (
    tokens.length > FEATURE_META_LIMITS.count ||
    tokens.some((token) => token.length > FEATURE_META_LIMITS.tokenChars)
  ) {
    return { attributePresent: true, tokens: [], degraded: true };
  }
  return { attributePresent: true, tokens, degraded: false };
}

/** `declared` / `refuted` / `absent` for one exact token (mirrors the port). */
function referenceMetaVerdict(
  meta: ReferenceFeatureMeta,
  token: string
): 'declared' | 'refuted' | 'absent' {
  if (!meta.attributePresent || meta.degraded) return 'absent';
  return meta.tokens.includes(token) ? 'declared' : 'refuted';
}

/** Apply the declaration's authority in the same order as the port. */
function applyReferenceMeta(wprDetections: WprDetections, meta: ReferenceFeatureMeta): void {
  if (meta.attributePresent) wprDetections.wpr.present = true;
  for (const row of Object.keys(FEATURE_META_TOKENS) as FeatureMetaRow[]) {
    const verdict = referenceMetaVerdict(meta, FEATURE_META_TOKENS[row]);
    const entry: any = wprDetections[row];
    if (verdict === 'declared') {
      entry.present = true;
      entry.source = 'meta';
    } else if (verdict === 'refuted') {
      entry.present = false;
      entry.source = 'meta';
    } else if (entry.present) {
      entry.source = 'footprint';
    } else {
      delete entry.source;
    }
  }
  if (!wprDetections.lazyload_iframes.present) {
    wprDetections.lazyload_iframes.replaceImage = false;
  }
}

/**
 * Deviation 4: the minify attribute, counted only on a page already proven
 * to be WP Rocket's (proof read once, before either minify row changes).
 */
function applyReferenceMinifyAttribute(
  wprDetections: WprDetections,
  meta: ReferenceFeatureMeta,
  { pageScripts, pageLinkElements }: CheckOptimizationFunctionPayload
): void {
  let proven = wprDetections.wpr.present;
  if (!proven) {
    for (const [key, value] of Object.entries(wprDetections)) {
      if (key === 'wpr' || key === 'defer_all_js') continue;
      if (value.present) {
        proven = true;
        break;
      }
    }
  }
  if (!proven) return;
  const stamped = (element: Element): boolean =>
    element.getAttribute(MINIFY_ATTRIBUTE) === MINIFY_ATTRIBUTE_VALUE;
  if (
    !wprDetections.minify_css.present &&
    referenceMetaVerdict(meta, FEATURE_META_TOKENS.minify_css) === 'absent' &&
    pageLinkElements.some(
      (link) => link.rel === 'stylesheet' && link.getAttribute('href') && stamped(link)
    )
  ) {
    wprDetections.minify_css.present = true;
    wprDetections.minify_css.source = 'footprint';
  }
  if (
    !wprDetections.minify_js.present &&
    referenceMetaVerdict(meta, FEATURE_META_TOKENS.minify_js) === 'absent' &&
    pageScripts.some((script) => rawServedSrc(script) && stamped(script))
  ) {
    wprDetections.minify_js.present = true;
    wprDetections.minify_js.source = 'footprint';
  }
}

/**
 * One full detection pass, replicating the reference orchestration exactly:
 * fresh document queries per check, the declaration's authority over the
 * footprint verdicts, then the presence-propagation rule.
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
  const meta = parseReferenceFeatureMeta(HTMLDocument);
  applyReferenceMeta(wprDetections as WprDetections, meta);
  applyReferenceMinifyAttribute(wprDetections as WprDetections, meta, {
    pageHTML,
    HTMLDocument,
    pageScripts,
    pageLinkElements
  });
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
