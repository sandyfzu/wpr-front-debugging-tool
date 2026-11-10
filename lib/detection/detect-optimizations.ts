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
  MobileCacheVariant,
  PreloadedResources,
  ResourceHint,
  ResourceHintMark,
  ResourceHintRel,
  WprDetections
} from '../wp-rocket/types';
import {
  CPCSS_MARK,
  CRITICAL_CSS_STYLE_SELECTOR,
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DATA_ROCKET_STATUS,
  DATA_SRC,
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  DELAY_JS_VERSION_PATTERN,
  DELAY_TYPE_ATTRIBUTE,
  FDT_EXCLUDED_RESOURCE,
  LAZYLOAD_BG_CONTAINER_ID,
  LAZYLOAD_BG_EXCLUSION_ID,
  LAZYLOAD_EXCLUSIONS_LIST,
  LAZYLOAD_IFRAME_OPTIONS_PATTERN,
  LAZYLOAD_IMG_OPTIONS_PATTERN,
  LAZYLOAD_SCRIPT_PATTERN,
  LAZYLOAD_YOUTUBE_PATTERN,
  MOBILE_CACHE_VARIANT_TOKENS,
  PRELOAD_LINKS_CONFIG_MARK,
  PRELOAD_LINKS_SCRIPT_ID,
  RESOURCE_HINT_MARKS,
  RESOURCE_HINT_RELS,
  ROCKET_CDN_DOMAIN,
  ROCKET_PRECONNECT_ATTRIBUTE,
  ROCKET_PREFETCH_ATTRIBUTE,
  RUCSS_STYLE_SELECTOR,
  SELF_HOSTED_FONTS_ATTRIBUTE,
  SELF_HOSTED_FONTS_CACHE_PATH,
  WPR_DEFER_ATTRIBUTE,
  WPR_PRELOAD_ATTRIBUTE,
  isDelayJSType
} from '../wp-rocket/constants';
import type { FeatureMetaEvidence } from './feature-meta';
import type { ParsedPage } from './parse-page';
import { carriesMinifyAttribute, hasMinifyFootprint } from './minify-footprint';
import { servedScriptSrc, servedScriptSrcAttribute } from './served-script-src';
import { hasAsyncCssLink, insideNoscript } from './stylesheet-links';
import { parseHttpUrl, parseUrl } from '../../utils/urls';

/** Remove Unused CSS: an inline `style` element with the reserved id. */
export function detectRemoveUnusedCss(page: ParsedPage): WprDetections['remove_unused_css'] {
  // Selector kept verbatim (also matches an SVG-embedded <style>, unlike an
  // id lookup + tag comparison).
  return { present: page.document.querySelector(RUCSS_STYLE_SELECTOR) !== null };
}

/**
 * Load CSS asynchronously: the inline CPCSS fallback script or a stylesheet
 * link carrying the async stamp (either alone decides), plus whether the
 * critical-path style was in the capture — a fact only, never the verdict
 * (the fallback script removes that style on `load`).
 */
export function detectAsyncCss(page: ParsedPage): WprDetections['async_css'] {
  // The engines' falsy gate, kept for exact parity: an empty `src` attribute
  // (degenerate markup) still lets the script's text count as the fallback.
  const present =
    page.scripts.some(
      (script) => !script.getAttribute('src') && script.textContent.includes(CPCSS_MARK)
    ) || hasAsyncCssLink(page.links);
  // `<noscript>` content is text in a live capture, so never count it here.
  const criticalStyle = [...page.document.querySelectorAll(CRITICAL_CSS_STYLE_SELECTOR)].some(
    (style) => !insideNoscript(style)
  );
  return { present, criticalStyle };
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
    // inline, then src/content, then defer markers, the exclusion marker, the
    // minify stamp and the original type) so serialized payloads compare
    // key-for-key.
    const delayed = isDelayJSType(script.getAttribute('type'));
    const originalType = delayed ? delayedOriginalType(script) : null;
    const srcSource = delayed ? script.getAttribute(DELAY_JS_SRC) : script.getAttribute('src');
    const record: DelayedScriptRecord = {
      delayed,
      inline: srcSource === null,
      ...(srcSource === null ? { content: script.textContent } : { src: srcSource }),
      deferred: script.hasAttribute('defer'),
      deferredByWPR: script.hasAttribute(WPR_DEFER_ATTRIBUTE),
      fdtExcluded: script.getAttribute(FDT_EXCLUDED_RESOURCE),
      minifyAttribute: carriesMinifyAttribute(script),
      ...(originalType === null ? {} : { originalType })
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
 * A delayed script's original `type` as the Delay JS runtime will restore
 * it: the parked attribute's value when non-empty (the runtime's own
 * truthiness test — whitespace counts), else `null` (it runs as classic).
 *
 * @param script A script whose served `type` is a Delay JS type.
 * @returns The original type, or `null` when none was parked.
 */
export function delayedOriginalType(script: Element): string | null {
  const value = script.getAttribute(DELAY_TYPE_ATTRIBUTE);
  return value === null || value === '' ? null : value;
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
    // The served URL: a delayed library (its exclusion row filtered away)
    // still counts.
    if (
      servedScriptSrcAttribute(script) !== null &&
      LAZYLOAD_SCRIPT_PATTERN.test(servedScriptSrc(script))
    ) {
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

/**
 * Minify CSS: `cache/min/<n>/<hash>…css` stylesheet URLs (async-swapped
 * stylesheet links included, `<noscript>` fallbacks never). The URL arm only —
 * an attribute-only stylesheet is resolved later by the orchestrator's proof
 * guard (the attribute alone never proves WP Rocket).
 */
export function detectMinifyCss(page: ParsedPage): WprDetections['minify_css'] {
  return { present: hasMinifyFootprint(page, 'minify_css', 'url') };
}

/**
 * Minify JS: `cache/min/<n>/<hash>…js` script URLs (resolved, served — Delay
 * JS delays minified files unless an exclusion row matches them). The URL
 * arm only, as Minify CSS.
 */
export function detectMinifyJs(page: ParsedPage): WprDetections['minify_js'] {
  return { present: hasMinifyFootprint(page, 'minify_js', 'url') };
}

/**
 * Combine JavaScript files: declaration-only. The bundle's file name is a
 * bare content digest under the minify cache — a shape any build tool can
 * serve — so it never attributes the feature; with no declaration the
 * honest answer is "undecided", never a guess from the URL.
 */
export function detectCombineJs(): WprDetections['minify_concatenate_js'] {
  return { present: false };
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
 * Prefetch DNS Requests: declaration-only — the plugin's hints are the plain
 * core `dns-prefetch` links WordPress also prints for every external host it
 * enqueues, so the verdict comes from the generator meta's authority pass
 * (`present` starts false here). The observed plain hints ride along as
 * corroboration: resolved http(s) hrefs off the page's own origin, unique,
 * first-occurrence order; hints carrying Preconnect to External Domains'
 * attribution are that row's.
 *
 * @param page The parsed page (its document URL and links).
 */
export function detectDnsPrefetch(page: ParsedPage): WprDetections['dns_prefetch'] {
  const pageOrigin = parseUrl(page.document.URL)?.origin ?? null;
  const domains = new Set<string>();
  for (const link of page.links) {
    if (
      (link.getAttribute('rel') ?? '').toLowerCase() !== 'dns-prefetch' ||
      link.hasAttribute(ROCKET_PREFETCH_ATTRIBUTE) ||
      link.hasAttribute(ROCKET_PRECONNECT_ATTRIBUTE)
    )
      continue;
    // A blank href resolves to the page itself: it names no hinted host.
    if ((link.getAttribute('href') ?? '').trim() === '') continue;
    // `href` is resolved: a scheme-less `//host` hint reads with the page's
    // scheme; any other scheme (`javascript:`, `data:`) names no host, and a
    // same-origin one (`#`, `/x`) names the page's own host, never hinted.
    const url = parseHttpUrl(link.href);
    if (url !== null && url.origin !== pageOrigin) domains.add(url.href);
  }
  return { present: false, domains: [...domains] };
}

/**
 * Separate cache files for mobile devices: declaration-only — the plugin's
 * device token follows the option, never page markup, so the verdict comes
 * from the generator meta's authority pass (`present` starts false here).
 * The variant is the declared device token.
 *
 * @param page The parsed page (its feature declaration).
 */
export function detectMobileCache(page: ParsedPage): WprDetections['mobile_cache'] {
  return { present: false, variant: mobileCacheVariant(page.featureMeta) };
}

/**
 * The device a declaration names: exactly one device token. Both
 * tokens (never a genuine render) or neither name none; a degraded
 * declaration carries no tokens, so it names none either.
 *
 * @param meta The page's parsed declaration.
 */
export function mobileCacheVariant(meta: FeatureMetaEvidence): MobileCacheVariant | null {
  const mobile = meta.tokens.includes(MOBILE_CACHE_VARIANT_TOKENS.mobile);
  const desktop = meta.tokens.includes(MOBILE_CACHE_VARIANT_TOKENS.desktop);
  if (mobile === desktop) return null;
  return mobile ? 'mobile' : 'desktop';
}

/**
 * Optimize Critical Images lives in `./priority-elements` (the beacon
 * subsystem — its evidence and the beacon's are one family).
 */

/**
 * Preloaded subresources: WP Rocket-preloaded links with their `as` type,
 * plus the page's whole resource-hint inventory ({@link resourceHints}).
 *
 * @param page The parsed page (its links).
 */
export function detectPreloadedResources(page: ParsedPage): PreloadedResources {
  const hints = resourceHints(page.links);
  const preloadedLinks = page.links.filter((link) => link.hasAttribute(WPR_PRELOAD_ATTRIBUTE));
  if (preloadedLinks.length === 0) return { present: false, hints };
  return {
    present: true,
    resources: preloadedLinks.map((link) => ({ href: link.href, type: link.as })),
    hints
  };
}

/** ASCII whitespace, the separator of a `rel` token list. */
const REL_TOKEN_SEPARATOR = /[\t\n\f\r ]+/;

/**
 * Every resource hint the links declare, document order: one row per listed
 * `rel` kind a link carries ({@link resourceHintRels}), duplicates kept (two
 * hints for one URL are two hints). Links inside `<noscript>` are skipped:
 * a live capture serializes them as text, so they never hint anything.
 *
 * @param links The page's `<link>` elements.
 */
export function resourceHints(links: readonly HTMLLinkElement[]): ResourceHint[] {
  const hints: ResourceHint[] = [];
  for (const link of links) {
    const rels = resourceHintRels(link);
    // The ancestor walk only for actual hints: it is the one non-constant test.
    if (rels.length === 0 || insideNoscript(link)) continue;
    const href = (link.getAttribute('href') ?? '').trim() === '' ? '' : link.href;
    const as = (link.getAttribute('as') ?? '').trim().toLowerCase();
    for (const rel of rels) {
      const mark = resourceHintMark(link, rel);
      hints.push(mark === undefined ? { rel, href, as } : { rel, href, as, mark });
    }
  }
  return hints;
}

/**
 * The hint kinds one link declares, in {@link RESOURCE_HINT_RELS} order:
 * its listed `rel` tokens only (ASCII case-insensitive, each once). A
 * `data-rocket-preload` marker adds no kind: every WP Rocket emitter writes
 * `rel="preload"` beside it, so a marked link without that token hints
 * nothing (the `resources` list still keeps it — it reads the marker alone).
 *
 * @param link A `<link>` element.
 */
export function resourceHintRels(link: Element): ResourceHintRel[] {
  const tokens = (link.getAttribute('rel') ?? '').toLowerCase().split(REL_TOKEN_SEPARATOR);
  return RESOURCE_HINT_RELS.filter((rel) => tokens.includes(rel));
}

/**
 * WP Rocket's stamp on one hint: the first {@link RESOURCE_HINT_MARKS} entry
 * written for this `rel` that the link carries (exact value where one is
 * required). A stamp on another `rel` is no plugin markup and counts as none.
 *
 * @param link The hint's `<link>`.
 * @param rel The hint's kind.
 * @returns The stamp, `undefined` for a plain hint.
 */
export function resourceHintMark(
  link: Element,
  rel: ResourceHintRel
): ResourceHintMark | undefined {
  return RESOURCE_HINT_MARKS.find(
    (entry) =>
      entry.rel === rel &&
      (entry.value === undefined
        ? link.hasAttribute(entry.attribute)
        : link.getAttribute(entry.attribute) === entry.value)
  )?.mark;
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
  return { present: hasSelfHostedFontLink(page) };
}

/**
 * Whether the page carries a self-hosted font link (the attributed link or
 * the font cache path) — the row's footprint and, once declared, its target.
 *
 * @param page The parsed page.
 */
export function hasSelfHostedFontLink(page: ParsedPage): boolean {
  return page.links.some(
    (link) =>
      link.hasAttribute(SELF_HOSTED_FONTS_ATTRIBUTE) ||
      link.href.includes(SELF_HOSTED_FONTS_CACHE_PATH)
  );
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
