/**
 * The page's optimization checks, each reading only parsed input
 * (`ParsedPage` — shared element lists plus the parsed document, never the
 * live window).
 *
 * Every function returns exactly the record shape `WprDetections` declares
 * for its key, and reads precisely what the page offers: raw attributes for
 * footprint presence, resolved properties where URLs are compared — the
 * distinction is documented per check, and the fixture corpus plus the
 * test-only reference implementation keep it honest. Footprint vocabulary is
 * single-sourced in `../wp-rocket/constants`.
 */

import type {
  DelayedScriptRecord,
  LazyloadImageRecord,
  PreloadedResources,
  WprDetections
} from '../wp-rocket/types';
import {
  CPCSS_MARK,
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DATA_ROCKET_STATUS,
  DATA_SRC,
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  DELAY_JS_VERSION_PATTERN,
  FDT_EXCLUDED_RESOURCE,
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  LAZYLOAD_EXCLUSIONS_LIST,
  LAZYLOAD_IFRAME_OPTIONS_PATTERN,
  LAZYLOAD_IMG_OPTIONS_PATTERN,
  LAZYLOAD_SCRIPT_PATTERN,
  LAZYLOAD_YOUTUBE_PATTERN,
  MINIFY_CSS_URL_PATTERN,
  MINIFY_JS_URL_PATTERN,
  PRELOAD_LINKS_CONFIG_MARK,
  PRELOAD_LINKS_SCRIPT_ID,
  ROCKET_CDN_DOMAIN,
  RUCSS_STYLE_SELECTOR,
  SELF_HOSTED_FONTS_ATTRIBUTE,
  SELF_HOSTED_FONTS_CACHE_PATH,
  WPR_DEFER_ATTRIBUTE,
  WPR_PRELOAD_ATTRIBUTE,
  isDelayJSType
} from '../wp-rocket/constants';
import type { ParsedPage } from './parse-page';

/** Remove Unused CSS: an inline `style` element with the reserved id. */
export function detectRemoveUnusedCss(page: ParsedPage): WprDetections['remove_unused_css'] {
  // Selector kept verbatim (also matches an SVG-embedded <style>, unlike an
  // id lookup + tag comparison).
  return { present: page.document.querySelector(RUCSS_STYLE_SELECTOR) !== null };
}

/** Load CSS asynchronously: the inline CPCSS fallback script. */
export function detectAsyncCss(page: ParsedPage): WprDetections['async_css'] {
  // The engines' falsy gate, kept for exact parity: an empty `src` attribute
  // (degenerate markup) still lets the script's text count as the fallback.
  const present = page.scripts.some(
    (script) => !script.getAttribute('src') && script.textContent.includes(CPCSS_MARK)
  );
  return { present };
}

/**
 * Delay JavaScript Execution: the delayed-script inventory plus the
 * controller's version.
 *
 * Every page script gets a record (not only delayed ones) — the panel
 * renders non-delayed scripts next to them; `delayedScripts` counts only
 * the delayed ones.
 */
export function detectDelayJs(page: ParsedPage): WprDetections['delay_js'] {
  const delayJs: WprDetections['delay_js'] = {
    present: false,
    scripts: [],
    version: null,
    delayedScripts: 0
  };
  for (const script of page.scripts) {
    // The controller's version is only read while presence is not yet set
    // (reference order); a delayed script earlier in the document hides it.
    // The same `this.v` assignment appears in the served minified bundle.
    if (!delayJs.present && !script.hasAttribute('src')) {
      const text = script.textContent;
      if (text.includes(DELAY_JS_CONTROLLER)) {
        delayJs.present = true;
        delayJs.version = text.match(DELAY_JS_VERSION_PATTERN)?.[1] ?? null;
      }
    }
    // The runtime stamps every script it processed; presence is footprint
    // evidence even when the controller itself was inlined/rewritten away.
    if (script.hasAttribute(DATA_ROCKET_STATUS)) delayJs.present = true;
    // Field insertion order matches the reference record exactly (delayed,
    // inline, then src/content, then defer markers) so serialized payloads
    // compare key-for-key.
    const delayed = isDelayJSType(script.getAttribute('type'));
    const srcSource = delayed ? script.getAttribute(DELAY_JS_SRC) : script.getAttribute('src');
    const record: DelayedScriptRecord = {
      delayed,
      inline: srcSource === null,
      ...(srcSource === null ? { content: script.textContent } : { src: srcSource }),
      deferred: script.hasAttribute('defer'),
      deferredByWPR: script.hasAttribute(WPR_DEFER_ATTRIBUTE),
      fdtExcluded: script.getAttribute(FDT_EXCLUDED_RESOURCE)
    };
    if (delayed) {
      delayJs.present = true;
      delayJs.delayedScripts += 1;
    }
    delayJs.scripts.push(record);
  }
  return delayJs;
}

/**
 * Load JavaScript deferred: every script WP Rocket attributed. Presence
 * includes inline/no-src scripts — a delayed script rewritten with
 * `data-rocket-src` keeps the attribute — while the `scripts` list carries
 * only the URLs it can name, so an inline-only page still reports `present`
 * with an empty list and `deferredScripts` counts every attributed script.
 */
export function detectDeferAllJs(page: ParsedPage): WprDetections['defer_all_js'] {
  const attributed = page.scripts.filter((script) => script.hasAttribute(WPR_DEFER_ATTRIBUTE));
  const scripts = attributed
    .map((script) => script.getAttribute(DELAY_JS_SRC) ?? script.getAttribute('src') ?? '')
    .filter((src) => src !== '');
  return { present: attributed.length > 0, scripts, deferredScripts: attributed.length };
}

/**
 * The lazyload footprint scan both lazyload checks share (reference control
 * flow, exactly): reverse script order, script-URL footprint first, then the
 * inline options blob for the check's own media type. `extraPattern` (the
 * iframes' youtube helper) is tested inside the same loop so the shared break
 * condition cuts it identically.
 *
 * @param page The parsed page.
 * @param optionsPattern The inline options-blob pattern for this check.
 * @param extraPattern Optional extra footprint detected by the same scan.
 */
function scanLazyloadFootprint(
  page: ParsedPage,
  optionsPattern: RegExp,
  extraPattern?: RegExp
): { scriptPresent: boolean; inlinePresent: boolean; extraFound: boolean } {
  let scriptPresent = false;
  let inlinePresent = false;
  let extraFound = false;
  for (const script of [...page.scripts].reverse()) {
    if (scriptPresent && inlinePresent) break;
    const src = script.getAttribute('src');
    if (src !== null && LAZYLOAD_SCRIPT_PATTERN.test(src)) {
      scriptPresent = true;
      continue;
    }
    if (optionsPattern.test(script.textContent)) {
      inlinePresent = true;
    }
    if (extraPattern !== undefined && extraPattern.test(script.textContent)) {
      extraFound = true;
    }
  }
  return { scriptPresent, inlinePresent, extraFound };
}

/**
 * LazyLoad for images: script presence + per-image state.
 *
 * The exclusion scan reproduces match-by-substring against the image's
 * serialized HTML — entries mix attribute names, class-value anchors and
 * value fragments on purpose (see the list's doc), and the serialized form
 * is read once per image because `outerHTML` re-serializes on every access.
 */
export function detectLazyload(page: ParsedPage): WprDetections['lazyload'] {
  const { scriptPresent, inlinePresent } = scanLazyloadFootprint(
    page,
    LAZYLOAD_IMG_OPTIONS_PATTERN
  );

  const images: LazyloadImageRecord[] = [...page.document.querySelectorAll('img')].map((img) => {
    const serialized = img.outerHTML;
    const lazyloadDetected = img.hasAttribute(DATA_LAZY_SRC) || img.hasAttribute(DATA_LAZY_SRCSET);
    // Display URL: the replacement attribute when lazyloaded, otherwise the
    // original candidates. (`''` over null — the resolved `src` property is
    // `''` when the attribute is absent, and `src` stays a string.)
    const src = lazyloadDetected
      ? (img.getAttribute(DATA_LAZY_SRC) ?? '')
      : (img.getAttribute(DATA_SRC) ?? img.src);
    const excludedReasonsFound = LAZYLOAD_EXCLUSIONS_LIST.filter(
      // The attribute this check classifies by is not an exclusion reason.
      (exclusion) => exclusion !== DATA_LAZY_SRC && serialized.includes(exclusion)
    );
    return { src, lazyloadDetected, excludedReasonsFound };
  });

  return { present: scriptPresent && inlinePresent, images };
}

/** LazyLoad for iframes and videos: script presence + preview replacement. */
export function detectLazyloadIframes(page: ParsedPage): WprDetections['lazyload_iframes'] {
  const { scriptPresent, inlinePresent, extraFound } = scanLazyloadFootprint(
    page,
    LAZYLOAD_IFRAME_OPTIONS_PATTERN,
    LAZYLOAD_YOUTUBE_PATTERN
  );
  const present = scriptPresent && inlinePresent;
  return { present, replaceImage: present && extraFound };
}

/** Minify CSS: `cache/min/<n>/<hash>…css` stylesheet URLs. */
export function detectMinifyCss(page: ParsedPage): WprDetections['minify_css'] {
  const present = page.links.some((link) => {
    if (link.getAttribute('rel') !== 'stylesheet') return false;
    return MINIFY_CSS_URL_PATTERN.test(link.href);
  });
  return { present };
}

/** Minify JS: `cache/min/<n>/<hash>…js` script URLs (resolved). */
export function detectMinifyJs(page: ParsedPage): WprDetections['minify_js'] {
  // The engines' falsy gate, kept for exact parity: an empty `src` attribute
  // never runs the URL check (which would otherwise resolve against the
  // document's own URL).
  const present = page.scripts.some((script) => {
    const srcAttr = script.getAttribute('src');
    if (!srcAttr) return false;
    return MINIFY_JS_URL_PATTERN.test(script.src);
  });
  return { present };
}

/**
 * Preload links: the options blob's id, or its inline config identifier
 * repeated across the page's scripts (the blob names itself more than once,
 * so a stripped/renamed id still leaves the config behind). A single
 * incidental mention never asserts the feature.
 */
export function detectPreloadLinks(page: ParsedPage): WprDetections['preload_links'] {
  if (page.document.getElementById(PRELOAD_LINKS_SCRIPT_ID) !== null) return { present: true };
  let mentions = 0;
  for (const script of page.scripts) {
    mentions += script.textContent.split(PRELOAD_LINKS_CONFIG_MARK).length - 1;
    if (mentions > 1) return { present: true };
  }
  return { present: false };
}

/** RocketCDN: a `dns-prefetch` hint pointing at the CDN domain. */
export function detectRocketCdn(page: ParsedPage): WprDetections['rocket_cdn'] {
  const present = page.links.some(
    (link) =>
      (link.getAttribute('rel') ?? '').toLowerCase() === 'dns-prefetch' &&
      link.href.includes(ROCKET_CDN_DOMAIN)
  );
  return { present };
}

/**
 * Optimize Critical Images lives in `./priority-elements` (the beacon
 * subsystem — its evidence and the beacon's are one family).
 */

/** Preloaded subresources: WP Rocket-preloaded links with their `as` type. */
export function detectPreloadedResources(page: ParsedPage): PreloadedResources {
  const preloadedLinks = page.links.filter((link) => link.hasAttribute(WPR_PRELOAD_ATTRIBUTE));
  if (preloadedLinks.length === 0) return { present: false };
  return {
    present: true,
    resources: preloadedLinks.map((link) => ({ href: link.href, type: link.as }))
  };
}

/** Lazyload for CSS background images: the reserved container element. */
export function detectLazyloadCssBgImg(page: ParsedPage): WprDetections['lazyload_css_bg_img'] {
  const container =
    page.document.getElementById(LAZYLOAD_BG_CONTAINER_ID) ??
    page.document.getElementById(LAZYLOAD_BG_EXCLUSION_ID);
  return { present: container !== null };
}

/**
 * Self-host Google Fonts: the attributed stylesheet link or the local font
 * cache path. Only a `link` is read — the inline-`style` emitter belongs to
 * the later media-coverage upgrade, and an unattributed font URL proves
 * nothing (any plugin can host a font).
 */
export function detectSelfHostedFonts(page: ParsedPage): WprDetections['self_hosted_fonts'] {
  const present = page.links.some(
    (link) =>
      link.hasAttribute(SELF_HOSTED_FONTS_ATTRIBUTE) ||
      link.href.includes(SELF_HOSTED_FONTS_CACHE_PATH)
  );
  return { present };
}

/**
 * Add missing image dimensions: declaration-only. Ordinary `width`/`height`
 * attributes are standard markup any theme/plugin emits, so they never
 * attribute the feature; with no declaration the honest answer is "no known
 * footprint", not a guess.
 */
export function detectImageDimensions(): WprDetections['image_dimensions'] {
  return { present: false };
}
