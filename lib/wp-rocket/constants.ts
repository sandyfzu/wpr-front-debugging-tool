/**
 * Element, attribute and selector constants of WP Rocket's page footprints —
 * the single declaring site for everything both the detection engine and the
 * test-only reference engine (the parity baseline) read on a served page, plus
 * the trivial extractors over that vocabulary. Every string is pinned by the
 * literal assertions in `constants.test.ts`; consumers import from here instead
 * of re-typed copies so the vocabulary can never drift between surfaces.
 */

import { escapeRegex } from '../../utils/regex.ts';
import type { FeatureMetaRow } from './types';

/** Attribute WP Rocket uses on delayed scripts to carry the original `src`. */
export const DELAY_JS_SRC = 'data-rocket-src';

/**
 * Attribute WP Rocket parks a delayed script's original `type` value in; the
 * Delay JS runtime restores `type` from it when the script runs and removes
 * it then — except an empty value, which counts as none and may be left on
 * the executed script.
 */
export const DELAY_TYPE_ATTRIBUTE = 'data-rocket-type';

/** Attribute the Delay JS runtime stamps on scripts it has processed. */
export const DATA_ROCKET_STATUS = 'data-rocket-status';

/** Attribute marking resources excluded from local tooling processing. */
export const FDT_EXCLUDED_RESOURCE = 'data-wpr-fdt-excluded';

/**
 * `name` of the one `<meta>` the Exclusion Builder's rewrite adds to a
 * document it changed, stating per feature what it turned off or excluded
 * (content grammar: `lib/exclusion-builder/builder-marker`). This
 * extension's own `wpr-fdt-` namespace — never WP Rocket's `generator` meta.
 */
export const BUILDER_MARKER_META_NAME = 'wpr-fdt-exclusion-builder';

/**
 * `name` of the one `<meta>` a simulation adds to a document it simulated a
 * WP Rocket feature on, naming the features and the id the background drew
 * for that document (content grammar:
 * `lib/wp-rocket-simulation/simulation-marker`). Page markup is untrusted:
 * detection treats it as an authority only once the background vouches for
 * its id. Never WP Rocket's `generator` meta nor any `data-wpr-features` token.
 */
export const SIMULATION_MARKER_META_NAME = 'wpr-fdt-simulation';

/** Attribute WP Rocket adds to scripts it defers. */
export const WPR_DEFER_ATTRIBUTE = 'data-rocket-defer';

/**
 * What WP Rocket's Defer JS writes in place of every `>` of a script tag it
 * defers (a `>` inside a quoted value included).
 */
export const WPR_DEFER_STAMP = ` ${WPR_DEFER_ATTRIBUTE} defer>`;

/**
 * What WP Rocket's Defer JS puts before the body of an inline jQuery script
 * (its inline pass); {@link INLINE_WRAP_CLOSE} goes after it.
 */
export const INLINE_WRAP_OPEN = "window.addEventListener('DOMContentLoaded', function() {";

/** The closing of WP Rocket's inline-jQuery wrapper (see {@link INLINE_WRAP_OPEN}). */
export const INLINE_WRAP_CLOSE = '});';

/** Attribute marking WP Rocket-preloaded subresources on `link` elements. */
export const WPR_PRELOAD_ATTRIBUTE = 'data-rocket-preload';

/** Diagnoser script element ids: pages embed the plugin report as JSON text nodes. */
export const DIAGNOSER_NO_ROCKET_DATA_ID = 'wpr-diagnoser-no-rocket-json-data';
export const DIAGNOSER_ROCKET_DATA_ID = 'wpr-diagnoser-rocket-json-data';

/**
 * Type-attribute value on delayed scripts from WP Rocket versions before 3.20.6.
 */
export const DELAY_JS_TYPE_OLD = 'rocketlazyloadscript';

/**
 * Type-attribute value on delayed scripts from WP Rocket 3.20.6+
 * (the type became MIME-like; see the plugin changelog of that release).
 */
export const DELAY_JS_TYPE_CURRENT = `text/${DELAY_JS_TYPE_OLD}`;

/**
 * Every Delay JS type value, oldest first. Extend when the plugin introduces
 * a new variant (then update both `isDelayJSType` tests and fixtures).
 */
export const DELAY_JS_TYPES = [DELAY_JS_TYPE_OLD, DELAY_JS_TYPE_CURRENT] as const;

/**
 * Whether a `type` attribute value belongs to a WP Rocket delayed script,
 * for pages produced by old or current versions alike.
 *
 * The old value is a literal substring of the current value, so one
 * `includes` covers both without false positives: no real script type
 * contains `rocketlazyloadscript` unless it is one of ours.
 *
 * @param type Raw `type` attribute value or null/undefined.
 */
export function isDelayJSType(type: string | null | undefined): boolean {
  if (!type) return false;
  return type.includes(DELAY_JS_TYPE_OLD);
}

/**
 * CSS attribute selector matching all delayed scripts' type values, valid for
 * `querySelectorAll` (comma-separated selector groups per CSS Selectors §5.1).
 */
export function delayJSScriptSelector(): string {
  return DELAY_JS_TYPES.map((type) => `script[type="${type}"]`).join(', ');
}

/** The inline Delay JS controller announces itself in its source. */
export const DELAY_JS_CONTROLLER = 'RocketLazyLoadScripts';

/**
 * Delay JS version marker inside the controller. The served minified bundle
 * carries the same `this.v="…"` assignment, so this one pattern covers both
 * readable and minified controller shapes.
 */
export const DELAY_JS_VERSION_PATTERN = /this\.v\s*=\s*"([^"]+)"/;

/** The image's pre-lazyload source attribute candidates (match-by-substring). */
export const DATA_SRC = 'data-src';
/** The replacement attribute WP Rocket's lazyload writes back (`src` carries it). */
export const DATA_LAZY_SRC = 'data-lazy-src';
/** …and its srcset variant. */
export const DATA_LAZY_SRCSET = 'data-lazy-srcset';

/** The `id` of LazyLoad's no-JS `<style>` (inside a `<noscript>` WP Rocket prints in `wp_head`). */
export const LAZYLOAD_NOJS_STYLE_ID = 'rocket-lazyload-nojs-css';

/**
 * How WP Rocket's inline LazyLoad options script opens (no space around
 * `=`: generic vanilla-lazyload setups spell the same global their own way).
 */
export const LAZYLOAD_OPTIONS_ASSIGNMENT = 'window.lazyLoadOptions=';

/** The selector WP Rocket's options name for lazy images… */
export const LAZYLOAD_IMG_SELECTOR = `img[${DATA_LAZY_SRC}]`;
/** …and for lazy iframes. */
export const LAZYLOAD_IFRAME_SELECTOR = `iframe[${DATA_LAZY_SRC}]`;

/** Lazyload script footprint by URL — both served layouts. */
export const LAZYLOAD_SCRIPT_PATTERN =
  /(wp-rocket\/assets\/js\/lazyload\/.*\/lazyload(\.min)?\.js)/;

/** Lazyload options blob tailored per media query (`img` selector). */
export const LAZYLOAD_IMG_OPTIONS_PATTERN = new RegExp(
  `${escapeRegex(LAZYLOAD_OPTIONS_ASSIGNMENT)}(.*)${escapeRegex(LAZYLOAD_IMG_SELECTOR)}`
);
/** …and for iframes. */
export const LAZYLOAD_IFRAME_OPTIONS_PATTERN = new RegExp(
  `${escapeRegex(LAZYLOAD_OPTIONS_ASSIGNMENT)}(.*)${escapeRegex(LAZYLOAD_IFRAME_SELECTOR)}`
);
/** YouTube thumbnail replacement helper (iframe preview images). */
export const LAZYLOAD_YOUTUBE_PATTERN =
  /function lazyLoadThumb\((.*)function lazyLoadYoutubeIframe\(\)/;

/**
 * Reasons an image is excluded from lazyload detection, in historic list order.
 *
 * Semantics are match-by-substring against the image's serialized HTML, so
 * entries intentionally mix attribute names (`data-src`), class-value anchors
 * (`class="ls-l`) and value fragments (`fullurl`); consumers of this list
 * (including the devtools sidebar pane expression) must keep matching exactly
 * like that — do not "clean up" an entry without comparing against real pages.
 */
export const LAZYLOAD_EXCLUSIONS_LIST = [
  DATA_SRC,
  'data-no-lazy',
  'data-lazy-original',
  DATA_LAZY_SRC,
  'data-lazysrc',
  'data-lazyload',
  'data-bgposition',
  'data-envira-src',
  'fullurl',
  'lazy-slider-img',
  'data-srcset',
  'class="ls-l',
  'class="ls-bg',
  'soliloquy-image',
  'loading="eager"',
  'swatch-img',
  'data-height-percentage',
  'data-large_image',
  'avia-bg-style-fixed',
  'data-skip-lazy',
  'skip-lazy',
  'class="skip-lazy"',
  'image-compare__',
  FDT_EXCLUDED_RESOURCE
] as const;

/** Remove Unused CSS: the reserved id of the inline `style` element holding the used CSS. */
export const RUCSS_USED_CSS_ID = 'wpr-usedcss';

/** Remove Unused CSS: an inline `style` element with the reserved id. */
export const RUCSS_STYLE_SELECTOR = `style#${RUCSS_USED_CSS_ID}`;

/** The inline Load-CSS-asynchronously fallback script calls this function. */
export const CPCSS_MARK = 'wprRemoveCPCSS';

/**
 * Load CSS asynchronously stamps each stylesheet link it swaps to a preload
 * (`rel="preload" as="style"`, flipped back to `stylesheet` on load) with
 * this attribute; the link's `onerror` removes it, so a failed load leaves
 * no stamp.
 */
export const ASYNC_CSS_ATTRIBUTE = 'data-rocket-async';
/** The one value WP Rocket writes for {@link ASYNC_CSS_ATTRIBUTE}; any other value never counts. */
export const ASYNC_CSS_ATTRIBUTE_VALUE = 'style';

/**
 * The inline critical-path style Load CSS asynchronously prints in the head.
 * Its fallback script removes the element on `load` once the swapped
 * stylesheets have loaded, so only a capture taken before `load` sees it.
 */
export const CRITICAL_CSS_STYLE_ID = 'rocket-critical-css';

/**
 * The critical-path style element, id matched exactly: an attribute
 * selector stays case-sensitive in quirks mode (a doctype-less capture),
 * where `#id` would also match another case WP Rocket never writes.
 */
export const CRITICAL_CSS_STYLE_SELECTOR = `style[id="${CRITICAL_CSS_STYLE_ID}"]`;

/**
 * The served minify-cache directory shape — `cache/min/<site-id>/` — the atom
 * every minified-URL reader composes (the footprint check, the exclusion-path
 * recovery helper, the overlay's pick target), so the shape cannot drift.
 */
export const MINIFY_CACHE_DIR_SOURCE = 'cache\\/min\\/\\d+\\/';
/**
 * A minified-asset URL's head: the cache directory plus the word character
 * its file name starts with (the extension must follow later on the line).
 */
export const MINIFY_CACHE_HEAD_SOURCE = `${MINIFY_CACHE_DIR_SOURCE}[a-zA-Z0-9_]`;
/**
 * The attribute Minify CSS/JS (and the Combine JS bundle) stamps on every tag
 * it rewrote. It survives a site-moved cache root that the URL patterns miss,
 * but any page can write it — so detection counts it only once other
 * evidence proved WP Rocket on the page.
 */
export const MINIFY_ATTRIBUTE = 'data-minify';
/** The one value WP Rocket writes for {@link MINIFY_ATTRIBUTE}; any other value never counts. */
export const MINIFY_ATTRIBUTE_VALUE = '1';

/** Preload links: the options blob script WP Rocket prints for the feature. */
export const PRELOAD_LINKS_SCRIPT_ID = 'rocket-preload-links-js-extra';

/**
 * Preload links' inline config identifier. The options blob repeats it within
 * its own script, so a page whose script id was stripped or rewritten still
 * carries the feature when the identifier occurs more than once across the
 * page's scripts.
 */
export const PRELOAD_LINKS_CONFIG_MARK = 'RocketPreloadLinksConfig';

/**
 * Self-host Google Fonts: the attribution attribute on the stylesheet link
 * the feature emits (and, since later plugin releases, on its inline style —
 * the footprint upgrade belongs to the media coverage pass, not here).
 */
export const SELF_HOSTED_FONTS_ATTRIBUTE = 'data-wpr-hosted-gf-parameters';

/** Self-host Google Fonts: the local cache path of the rewritten stylesheet. */
export const SELF_HOSTED_FONTS_CACHE_PATH = '/cache/fonts/1/google-fonts/';

/** RocketCDN: the domain anchor a `dns-prefetch` hint points at. */
export const ROCKET_CDN_DOMAIN = '.rocketcdn.me';

/** Lazyload for CSS background images: the reserved container elements. */
export const LAZYLOAD_BG_CONTAINER_ID = 'wpr-lazyload-bg-container';
export const LAZYLOAD_BG_EXCLUSION_ID = 'wpr-lazyload-bg-exclusion';

/**
 * Automatic Lazy Rendering: attribute stamping the elements the feature
 * converted (present only on a page whose applied row was used).
 */
export const LAZY_RENDER_ATTRIBUTE = 'data-wpr-lazyrender';
/** …and the inline style id the feature adds when ≥ 1 element was converted. */
export const LAZY_RENDER_INLINE_CSS_ID = 'rocket-lazyrender-inline-css';
/**
 * Attribute carrying the render hash the plugin stamps on every render while
 * Lazy Rendering is enabled and strips once applied (or bypassed) — the
 * collecting-phase evidence for that feature.
 */
export const LOCATION_HASH_ATTRIBUTE = 'data-rocket-location-hash';

/** Prefetch-variant attribution attribute on the dns-prefetch hints the plugin emits. */
export const ROCKET_PREFETCH_ATTRIBUTE = 'data-rocket-prefetch';
/** Preconnect-variant attribution attribute (the filter variant's crossorigin hints). */
export const ROCKET_PRECONNECT_ATTRIBUTE = 'data-rocket-preconnect';

/** The measurement beacon script's marker attribute value. */
export const BEACON_DATA_NAME = 'wpr-wpr-beacon';

/**
 * Beacon script URL fallback: the assets path, min-agnostic — catches builds
 * whose tags were mutated by other optimizers and the SCRIPT_DEBUG variant
 * that drops the `.min` suffix. (Same match-by-substring shape as
 * `LAZYLOAD_SCRIPT_PATTERN`.)
 */
export const BEACON_SRC_PATTERN = /(wp-rocket\/assets\/js\/wpr-beacon(\.min)?\.js)/;

/**
 * The inline config script that precedes the beacon tag; everything after the
 * match (trailing `;`/whitespace tolerated) is the config JSON.
 */
export const BEACON_CONFIG_PATTERN = /^\s*var\s+rocket_beacon_data\s*=/;

/** Trailing semicolons/whitespace tolerated after the inline config's JSON. */
export const BEACON_CONFIG_TRAILING_NOISE = /[\s;]+$/;

/**
 * The beacon config's per-feature enablement keys, plugin-verified: a present
 * boolean key = that feature's context was allowed at injection time; an
 * absent key (or an explicit `false`) = disabled/blocked. The preconnect key
 * is singular — the plugin's own spelling.
 */
export const BEACON_STATUS_KEYS = [
  'atf',
  'lrc',
  'preload_fonts',
  'preconnect_external_domain'
] as const;

/**
 * The beacon config's array-payload fields (the plugin's own field names,
 * kept verbatim — they are the support value a config viewer renders).
 */
export const BEACON_CONFIG_LIST_FIELDS = [
  'preconnect_external_domain_elements',
  'preconnect_external_domain_exclusions',
  'preload_fonts_exclusions',
  'processed_extensions',
  'external_font_exclusions'
] as const;

/**
 * Size caps for parsing the inline beacon config (untrusted page data):
 * every violation degrades the whole config (the beacon tag stays the row's
 * evidence). Generous — real configs sit orders of magnitude below.
 */
export const BEACON_CONFIG_LIMITS = {
  /** The config JSON/literal text before parsing (bounds the parse itself). */
  text: 65_536,
  /** The comma-joined `elements` selector string. */
  elements: 4096,
  /** Each array-payload field: item count and per-item length. */
  lists: { count: 500, chars: 4096 },
  /** The `status` map: key count, and per-value length for preserved strings. */
  status: { keys: 32, chars: 4096 }
} as const;

/** A WP Rocket feature-support comment's data (`wpr_oci`, …) after trimming. */
export const FEATURE_COMMENT_PATTERN = /^\s*wpr_[a-z0-9_]+\s*$/;

/** Optimize critical images' feature comment (corroboration only — see below). */
export const OPTIMIZE_CRITICAL_IMAGES_COMMENT = 'wpr_oci';

/** The generator meta's `name` value, compared exactly (as WordPress and WP Rocket spell it). */
export const GENERATOR_META_NAME = 'generator';

/** Generator meta declaring the active optimization plugins. */
export const GENERATOR_META_SELECTOR = `meta[name="${GENERATOR_META_NAME}"]`;

/**
 * The feature-declaration attribute on that generator meta: since 3.17.2 the
 * plugin lists its active features as whitespace-separated tokens (`wpr_cdn
 * wpr_delay_js …`) on the same tag that names it. Its presence is the
 * meta-authoritative evidence class for feature verdicts; its absence (tag
 * with or without the attribute) leaves footprint evidence in charge.
 */
export const WPR_FEATURES_ATTRIBUTE = 'data-wpr-features';

/**
 * Selector for the generator meta that carries {@link WPR_FEATURES_ATTRIBUTE},
 * derived from its parts so the generator prefix can never drift from
 * {@link GENERATOR_META_SELECTOR}.
 */
export const WPR_FEATURES_META_SELECTOR = `${GENERATOR_META_SELECTOR}[${WPR_FEATURES_ATTRIBUTE}]`;

/**
 * Size caps for the untrusted feature declaration: real declarations carry
 * ≤ ~20 short tokens. A violation degrades the whole declaration (never a
 * clipped token list, whose cut could read as a refutation of a feature that
 * is actually on) — hostile input can only lose meta authority, never
 * manufacture a verdict.
 */
export const FEATURE_META_LIMITS = {
  /** Tokens per attribute. */
  count: 64,
  /** Characters per token. */
  tokenChars: 128,
  /** Characters of the whole attribute. */
  totalChars: 8_192
} as const;

/**
 * The device tokens the meta builder appends while separate mobile cache
 * files are on: the device WP Rocket's mobile detection found for the request
 * that generated the render (tablets count as mobile, while the cache file
 * name follows a separate tablet setting), never both on a genuine render.
 */
export const MOBILE_CACHE_VARIANT_TOKENS = {
  mobile: 'wpr_mobile',
  desktop: 'wpr_desktop'
} as const;

/**
 * The row↔token registry: each detection row and the exact tokens the plugin
 * declares for it (any listed token declares the row; one token for every row
 * but the mobile cache, whose two device variants share it). Verified against
 * the plugin's emitters (each feature's `add_meta_comment` argument prefixed
 * with `wpr_`, plus the option-driven tokens the meta builder appends
 * itself). Tokens the plugin emits for rows this port does not carry yet are
 * deliberately absent — mapping them to nothing would invite a wrong fallback.
 */
export const FEATURE_META_TOKENS: Readonly<Record<FeatureMetaRow, readonly string[]>> = {
  remove_unused_css: ['wpr_remove_unused_css'],
  async_css: ['wpr_async_css'],
  delay_js: ['wpr_delay_js'],
  defer_all_js: ['wpr_defer_js'],
  lazyload: ['wpr_lazyload_images'],
  lazyload_iframes: ['wpr_lazyload_iframes'],
  lazyload_css_bg_img: ['wpr_lazyload_css_bg_img'],
  self_hosted_fonts: ['wpr_host_fonts_locally'],
  image_dimensions: ['wpr_image_dimensions'],
  rocket_above_the_fold_optimization: ['wpr_oci'],
  automatic_lazy_rendering: ['wpr_automatic_lazy_rendering'],
  auto_preload_fonts: ['wpr_auto_preload_fonts'],
  preconnect_external_domains: ['wpr_preconnect_external_domains'],
  minify_css: ['wpr_minify_css'],
  minify_js: ['wpr_minify_js'],
  minify_concatenate_js: ['wpr_minify_concatenate_js'],
  preload_links: ['wpr_preload_links'],
  rocket_cdn: ['wpr_cdn'],
  mobile_cache: [MOBILE_CACHE_VARIANT_TOKENS.mobile, MOBILE_CACHE_VARIANT_TOKENS.desktop],
  // Option-derived: the domain list (stored domains + the `rocket_dns_prefetch`
  // filter, which appends the CDN CNAMEs) is non-empty, and either the CDN
  // option is off or that whole list has more than one entry.
  dns_prefetch: ['wpr_dns_prefetch']
};

/**
 * Rows whose missing token is no refutation while another row's token is
 * declared: the plugin omits the row's token on such renders even though the
 * feature may still apply, so the declaration decides nothing for it there.
 * DNS prefetch: with the CDN on, a one-entry domain list goes undeclared
 * while its hint is still printed (`wpr_cdn` is the render's CDN evidence).
 */
export const FEATURE_META_OMISSION_GUARDS: Readonly<
  Partial<Record<FeatureMetaRow, FeatureMetaRow>>
> = { dns_prefetch: 'rocket_cdn' };

/** WP Rocket's name as it formats the generator content (`WP Rocket`, `WP-Rocket`…). */
export const WPR_NAME_PATTERN = /wp\s*-?\s*rocket/i;

/** A WP Rocket version number's grammar: 1–4 dot-separated digit runs (regex source). */
export const WPR_VERSION_NUMBER_SOURCE = '[0-9]+(?:\\.[0-9]+){0,3}';

/** Version match: the name, split across optional separators, then the digits. */
export const WPR_VERSION_PATTERN = new RegExp(
  `${WPR_NAME_PATTERN.source}[/\\s:;v=]*\\s*(${WPR_VERSION_NUMBER_SOURCE})`,
  'i'
);

/**
 * WP Rocket version from a generator meta content, or null. Accepts
 * `WP Rocket 3.12`, `WP-Rocket 3.12.1.1`, `wp/rocket:3.20`… —
 * generously as WP Rocket itself formats the content variously.
 *
 * @param metaContent The generator meta's raw content.
 */
export function extractWprVersion(metaContent: string): string | null {
  return metaContent.match(WPR_VERSION_PATTERN)?.[1] ?? null;
}

/** WordPress core's name in a generator meta content (`WordPress 6.8.1`). */
export const WORDPRESS_NAME_PATTERN = /wordpress/i;

/**
 * Version match after the WordPress name: one leading digit required, then
 * digits/dots greedy, then any word tail. (The audit round's robustness
 * deviation: the parity pattern captured a bare `.` from a crafted
 * `WordPress .` — rendering a dot as a "version" reads as data; abstention
 * is the honest answer, so the digit requirement replaces raw parity here.)
 */
export const WORDPRESS_VERSION_PATTERN = new RegExp(
  `${WORDPRESS_NAME_PATTERN.source}\\s*(\\d[\\d.]*\\w*)`,
  'i'
);

/**
 * WordPress version from a generator meta content, or null.
 *
 * @param metaContent The generator meta's raw content.
 */
export function extractWordPressVersion(metaContent: string): string | null {
  return metaContent.match(WORDPRESS_VERSION_PATTERN)?.[1] ?? null;
}

/**
 * The cache comment markers WP Rocket writes after the document element.
 * The normal footer starts with the full slogan; white-label builds drop the
 * slogan and feature comments but keep one of these two footprint lines, so
 * they are the only signature a white-label page carries.
 */
export const CACHE_COMMENT_MARKERS = [
  "This website is like a Rocket, isn't it?",
  'Cached for great performance',
  'Optimized for great performance'
] as const;

/** Debug marker that marks a served cached page. */
export const CACHE_DEBUG_MARKER = 'Debug: cached';

/**
 * The debug marker's value token. The captured token is validated as a
 * strict decimal digit run by {@link parseCacheTimestampToken}; the pattern
 * only separates the token from the rest of the comment.
 */
export const CACHE_TIMESTAMP_PATTERN = /cached@(\S+)/;

/**
 * The largest cache stamp the display contract admits: 9999-12-31 23:59:59
 * UTC. A page-derived stamp outside it is not rendered as a time (expanded
 * ISO years and the platform's full range are machine concepts, not cache
 * evidence a support conversation can read).
 */
export const MAX_CACHE_STAMP_SECONDS = 253_402_300_799;

/**
 * Parse the debug comment's timestamp token. Only a complete decimal digit
 * run within {@link MAX_CACHE_STAMP_SECONDS} is accepted: `0x10`, negative,
 * fractional and overlong runs (`Infinity`) all answer null, so a crafted
 * page cannot make the panel display a made-up instant.
 *
 * @param data The matched comment's text.
 * @returns Epoch seconds, or null when the token is absent or out of domain.
 */
export function parseCacheTimestampToken(data: string): number | null {
  const token = data.match(CACHE_TIMESTAMP_PATTERN)?.[1];
  if (token === undefined || !/^\d+$/.test(token)) return null;
  const seconds = Number(token);
  if (!Number.isSafeInteger(seconds) || seconds > MAX_CACHE_STAMP_SECONDS) return null;
  return seconds;
}

/**
 * Query parameter that makes WP Rocket's `rocket_bypass()` answer true for
 * one request (`?nowprocket`). The plugin treats the parameter's presence as
 * the bypass — its PHP check compares the string value against integer 0, so
 * even `nowprocket=0` does not disable it.
 */
export const CACHE_BYPASS_QUERY_PARAM = 'nowprocket';

/**
 * Whether a URL attests a WP Rocket cache bypass. The capture knows the URL
 * it loaded; that is the only bypass evidence a served page carries by
 * itself, and it is deliberately narrow — the server-side constant cannot be
 * observed from the page.
 *
 * Keys are read as PHP registers them ({@link phpQueryKeyBase}), so every
 * spelling that sets `$_GET['nowprocket']` bypasses (`+nowprocket`,
 * `nowprocket[x]`, `nowprocket%00z`); a malformed URL cannot attest anything
 * and answers false (the content-script boot path must not throw on a
 * hostile `location.href`).
 *
 * @param url The captured page URL (absolute).
 * @returns True when the bypass parameter is present.
 */
export function isCacheBypassUrl(url: string | URL): boolean {
  let parsed: URL;
  try {
    parsed = typeof url === 'string' ? new URL(url) : url;
  } catch {
    return false;
  }
  // `forEach`, not `for…of keys()`: some content-script sandboxes hand out
  // URLSearchParams iterators without `Symbol.iterator` (iteration throws,
  // `Array.from` answers empty), and this runs on the content-script boot path.
  let bypass = false;
  parsed.searchParams.forEach((_value, key) => {
    if (phpQueryKeyBase(key) === CACHE_BYPASS_QUERY_PARAM) bypass = true;
  });
  return bypass;
}

/**
 * The top-level `$_GET` name PHP registers for one decoded query key
 * (`php_register_variable_ex`, shared by the request parser and
 * `parse_str`): leading spaces dropped (a `+` decodes to one), the key cut
 * at its first NUL, then a `[` that a later `]` closes opens an array, so
 * the name is the text before it. Anything else the name would still
 * contain (` `, `.`, an unclosed `[`) PHP rewrites to `_`; this keeps those
 * characters, which is enough here: such a name can never equal a plain
 * word like the bypass parameter, on either side. Not modeled: PHP also
 * drops a variable nested past `max_input_nesting_level` (64) or parsed
 * after `max_input_vars` (1000); both are php.ini-dependent, so such
 * adversarial URLs still read as a bypass here.
 *
 * @param key A query key as `URLSearchParams` decodes it (`+` → space, `%XX` → byte).
 * @returns The base name (empty when PHP drops the key: nothing before a `[`
 *   or a NUL, or only spaces).
 */
export function phpQueryKeyBase(key: string): string {
  let name = key.replace(/^ +/, '');
  const nulAt = name.indexOf('\0');
  if (nulAt !== -1) name = name.slice(0, nulAt);
  const openAt = name.indexOf('[');
  return openAt !== -1 && name.indexOf(']', openAt) !== -1 ? name.slice(0, openAt) : name;
}

/**
 * The URL with WP Rocket's cache bypass added: the bare `nowprocket`
 * parameter (presence is the bypass, so no value is needed) appended after
 * the existing query and before the fragment. The query is extended by
 * string, never re-serialized through `URLSearchParams`, which would
 * re-encode the page's own parameters (`%20` → `+`, `a` → `a=`) and so
 * request a different URL than the one being debugged.
 *
 * @param url The page URL (absolute).
 * @returns `url.href` unchanged when it already bypasses (any form
 *   {@link isCacheBypassUrl} accepts, `nowprocket=0` included); otherwise the
 *   href with the parameter added.
 */
export function withCacheBypass(url: URL): string {
  const href = url.href;
  if (isCacheBypassUrl(url)) return href;
  // A serialized URL's first `#` is its fragment delimiter: the query and
  // path percent-encode a literal `#`. `url.hash` is unusable here — it
  // reads empty for a bare trailing `#`.
  const hashAt = href.indexOf('#');
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : href.slice(hashAt);
  // `url.search` reads empty for a bare trailing `?`, so the separator is
  // decided from the serialized text: no `?` opens the query, a query
  // already ending in a separator (`?`, `&`) takes the parameter as is.
  const separator = !beforeHash.includes('?')
    ? '?'
    : beforeHash.endsWith('?') || beforeHash.endsWith('&')
      ? ''
      : '&';
  return `${beforeHash}${separator}${CACHE_BYPASS_QUERY_PARAM}${fragment}`;
}

/** One platform distinguishable by response headers. */
export interface KnownPlatformHeader {
  headerName: string;
  value?: string;
}

/**
 * Platforms detected from main-frame response headers. A row matches when
 * every declared header is present (and equal to the expected value, when set).
 */
export const KNOWN_PLATFORMS: ReadonlyMap<string, readonly KnownPlatformHeader[]> = new Map([
  [
    'WP Engine',
    [
      {
        headerName: 'X-Powered-By',
        value: 'WP Engine'
      }
    ]
  ],
  ['Kinsta', [{ headerName: 'X-Kinsta-Cache' }]],
  [
    'Hostinger',
    [
      {
        headerName: 'Platform',
        value: 'hostinger'
      }
    ]
  ]
]);

/** Identifier the main world substitutes for cross-origin "Script error." messages. */
export const UNDEFINED_REFERENCE_EXTERNAL_ERROR = '__EXTERNAL_ORIGIN_ERROR__';

/** Hourly KC-DB refresh alarm name (background owns firing, storage owns data). */
export const ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB = 'update-known-conflicts-db';

/** Context menu ids created by the background; click handlers must match exactly. */
export const CONTEXT_MENU_IDS = {
  wprSideBySide: 'wprSideBySide',
  psiSideBySide: 'psiSideBySide',
  updateKnownConflictsDB: 'updateKnownConflictsDB',
  /** Opens the exclusion builder overlay on the tab's page. */
  exclusionBuilder: 'exclusionBuilder',
  /** Toggles the on-page detection widget for the clicked page's origin. */
  toggleDetectionWidget: 'toggleDetectionWidget',
  /** Opens the clicked page in a new tab with the cache bypass parameter. */
  openNowProcket: 'openNowProcket',
  /** Opens the on-page command palette on the clicked page. */
  openCommandPalette: 'openCommandPalette',
  /** Turns all on-page UI off — or, while it is off, back on (the rescue). */
  pageUiGate: 'pageUiGate'
} as const;

/**
 * URL patterns the header capture listeners and content-script declarations
 * run on: every main frame over http(s). Also fed into the manifest's
 * `host_permissions` — single-sourced here so the list can never drift
 * between the manifest and the runtime listeners.
 */
export const URL_PATTERNS = ['https://*/*', 'http://*/*'] as const;
