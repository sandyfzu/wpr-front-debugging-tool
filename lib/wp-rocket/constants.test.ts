/**
 * The shared constants carry behavior too: the Delay JS type predicate/selector
 * and the platform header shapes are contracts other modules rely on. Every
 * footprint string below is pinned verbatim — these literals are the
 * independent witness the detection vocabulary is checked against.
 */
import { describe, expect, it } from 'vitest';
import {
  ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB,
  BEACON_CONFIG_LIST_FIELDS,
  BEACON_CONFIG_LIMITS,
  BEACON_CONFIG_PATTERN,
  BEACON_CONFIG_TRAILING_NOISE,
  BEACON_DATA_NAME,
  BEACON_SRC_PATTERN,
  BEACON_STATUS_KEYS,
  CACHE_COMMENT_MARKERS,
  CACHE_DEBUG_MARKER,
  CACHE_TIMESTAMP_PATTERN,
  CONTEXT_MENU_IDS,
  CPCSS_MARK,
  delayJSScriptSelector,
  DATA_LAZY_SRC,
  DATA_LAZY_SRCSET,
  DATA_SRC,
  DELAY_JS_CONTROLLER,
  DELAY_JS_SRC,
  DELAY_JS_TYPE_CURRENT,
  DELAY_JS_TYPE_OLD,
  DELAY_JS_VERSION_PATTERN,
  extractWprVersion,
  FEATURE_COMMENT_PATTERN,
  FDT_EXCLUDED_RESOURCE,
  BUILDER_MARKER_META_NAME,
  GENERATOR_META_SELECTOR,
  WPR_FEATURES_ATTRIBUTE,
  WPR_FEATURES_META_SELECTOR,
  isCacheBypassUrl,
  isDelayJSType,
  KNOWN_PLATFORMS,
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
  MINIFY_CSS_URL_PATTERN,
  MINIFY_JS_URL_PATTERN,
  MAX_CACHE_STAMP_SECONDS,
  OPTIMIZE_CRITICAL_IMAGES_COMMENT,
  parseCacheTimestampToken,
  PRELOAD_LINKS_SCRIPT_ID,
  ROCKET_CDN_DOMAIN,
  ROCKET_PREFETCH_ATTRIBUTE,
  ROCKET_PRECONNECT_ATTRIBUTE,
  RUCSS_STYLE_SELECTOR,
  URL_PATTERNS,
  WPR_DEFER_ATTRIBUTE,
  withCacheBypass,
  INLINE_WRAP_OPEN,
  INLINE_WRAP_CLOSE
} from './constants';
import { PANEL_SEARCH_ACTIONS } from './types';

describe('delay-js constants', () => {
  it('exposes both type values and the predicate covers them', () => {
    expect(DELAY_JS_TYPE_OLD).toBe('rocketlazyloadscript');
    expect(DELAY_JS_TYPE_CURRENT).toBe('text/rocketlazyloadscript');
    expect(isDelayJSType(DELAY_JS_TYPE_OLD)).toBe(true);
    expect(isDelayJSType(DELAY_JS_TYPE_CURRENT)).toBe(true);
    expect(isDelayJSType('')).toBe(false);
  });

  it('builds the delayed-script attribute selector', () => {
    const selector = delayJSScriptSelector();
    expect(selector).toBe(
      'script[type="rocketlazyloadscript"], script[type="text/rocketlazyloadscript"]'
    );
    // The selector must actually match delayed markup in a parsed document.
    const doc = new DOMParser().parseFromString(
      `<html><body>
        <script type="rocketlazyloadscript"></script>
        <script type="text/rocketlazyloadscript"></script>
        <script type="text/javascript"></script>
      </body></html>`,
      'text/html'
    );
    expect(doc.querySelectorAll(selector).length).toBe(2);
  });

  it('pins the controller markers and version pattern', () => {
    expect(DELAY_JS_CONTROLLER).toBe('RocketLazyLoadScripts');
    expect('this.v="2.0.4";'.match(DELAY_JS_VERSION_PATTERN)?.[1]).toBe('2.0.4');
    expect('other code'.match(DELAY_JS_VERSION_PATTERN)).toBeNull();
  });
});

describe('lazyload footprint vocabulary', () => {
  it('pins the image attributes', () => {
    expect(DATA_SRC).toBe('data-src');
    expect(DATA_LAZY_SRC).toBe('data-lazy-src');
    expect(DATA_LAZY_SRCSET).toBe('data-lazy-srcset');
  });

  it('pins the script and options-blob patterns', () => {
    expect(
      LAZYLOAD_SCRIPT_PATTERN.test(
        'https://x/wp-content/plugins/wp-rocket/assets/js/lazyload/17.0/lazyload.min.js'
      )
    ).toBe(true);
    expect(LAZYLOAD_SCRIPT_PATTERN.test('https://x/js/app.js')).toBe(false);
    expect(
      LAZYLOAD_IMG_OPTIONS_PATTERN.test('window.lazyLoadOptions={...};img[data-lazy-src]{...}')
    ).toBe(true);
    expect(
      LAZYLOAD_IFRAME_OPTIONS_PATTERN.test(
        'window.lazyLoadOptions={...};iframe[data-lazy-src]{...}'
      )
    ).toBe(true);
    expect(
      LAZYLOAD_YOUTUBE_PATTERN.test('function lazyLoadThumb(a){}function lazyLoadYoutubeIframe()')
    ).toBe(true);
  });

  it('holds all 24 historic exclusion entries', () => {
    expect(LAZYLOAD_EXCLUSIONS_LIST.length).toBe(24);
    expect(LAZYLOAD_EXCLUSIONS_LIST[0]).toBe('data-src');
    expect(LAZYLOAD_EXCLUSIONS_LIST.at(-1)).toBe('data-wpr-fdt-excluded');
  });
});

describe('other feature footprints', () => {
  it('pins the reserved ids, markers and anchors', () => {
    expect(RUCSS_STYLE_SELECTOR).toBe('style#wpr-usedcss');
    expect(CPCSS_MARK).toBe('wprRemoveCPCSS');
    expect(PRELOAD_LINKS_SCRIPT_ID).toBe('rocket-preload-links-js-extra');
    expect(ROCKET_CDN_DOMAIN).toBe('.rocketcdn.me');
    expect(LAZYLOAD_BG_CONTAINER_ID).toBe('wpr-lazyload-bg-container');
    expect(LAZYLOAD_BG_EXCLUSION_ID).toBe('wpr-lazyload-bg-exclusion');
    expect(BEACON_DATA_NAME).toBe('wpr-wpr-beacon');
    expect(GENERATOR_META_SELECTOR).toBe('meta[name="generator"]');
    expect(WPR_FEATURES_ATTRIBUTE).toBe('data-wpr-features');
    expect(WPR_FEATURES_META_SELECTOR).toBe('meta[name="generator"][data-wpr-features]');
    expect(MINIFY_CSS_URL_PATTERN.test('https://x/wp-content/cache/min/1/abc.css?ver=1')).toBe(
      true
    );
    expect(MINIFY_JS_URL_PATTERN.test('https://x/wp-content/cache/min/1/abc.js?ver=1')).toBe(true);
    expect(MINIFY_CSS_URL_PATTERN.test('https://x/style.css')).toBe(false);
  });

  it('pins the Priority Elements vocabulary', () => {
    // Beacon: marker attribute value + min-agnostic src fallback.
    expect(BEACON_SRC_PATTERN.test('/wp-rocket/assets/js/wpr-beacon.min.js')).toBe(true);
    expect(BEACON_SRC_PATTERN.test('/wp-rocket/assets/js/wpr-beacon.js')).toBe(true);
    expect(BEACON_SRC_PATTERN.test('/wp-rocket/assets/js/wpr-beacon-2.min.js')).toBe(false);
    expect(BEACON_SRC_PATTERN.test('/other/js/app.js')).toBe(false);
    // Inline config: assignment anchor, tolerated trailing semicolons.
    expect(BEACON_CONFIG_PATTERN.test('var rocket_beacon_data = {"a":1}')).toBe(true);
    expect(BEACON_CONFIG_PATTERN.test(' var  rocket_beacon_data=  {"a":1}')).toBe(true);
    expect(BEACON_CONFIG_PATTERN.test('window.rocket_beacon_data = {}')).toBe(false);
    expect('{"a":1}; '.replace(BEACON_CONFIG_TRAILING_NOISE, '')).toBe('{"a":1}');
    expect('{"a":1}\n;'.replace(BEACON_CONFIG_TRAILING_NOISE, '')).toBe('{"a":1}');
    // Enablement keys (plugin spellings; preconnect singular) + payload fields.
    expect(BEACON_STATUS_KEYS).toEqual([
      'atf',
      'lrc',
      'preload_fonts',
      'preconnect_external_domain'
    ]);
    expect(BEACON_CONFIG_LIST_FIELDS).toEqual([
      'preconnect_external_domain_elements',
      'preconnect_external_domain_exclusions',
      'preload_fonts_exclusions',
      'processed_extensions',
      'external_font_exclusions'
    ]);
    // Lazy-Rendering + preconnect attribution attributes.
    expect(LAZY_RENDER_ATTRIBUTE).toBe('data-wpr-lazyrender');
    expect(LAZY_RENDER_INLINE_CSS_ID).toBe('rocket-lazyrender-inline-css');
    expect(LOCATION_HASH_ATTRIBUTE).toBe('data-rocket-location-hash');
    expect(ROCKET_PREFETCH_ATTRIBUTE).toBe('data-rocket-prefetch');
    expect(ROCKET_PRECONNECT_ATTRIBUTE).toBe('data-rocket-preconnect');
    // Feature comments: the id pattern + the critical-images id.
    expect(FEATURE_COMMENT_PATTERN.test(' wpr_oci ')).toBe(true);
    expect(FEATURE_COMMENT_PATTERN.test('wpr_automatic_lazy_rendering')).toBe(true);
    expect(FEATURE_COMMENT_PATTERN.test('not a wpr_ comment')).toBe(false);
    expect(OPTIMIZE_CRITICAL_IMAGES_COMMENT).toBe('wpr_oci');
    // Config-parse caps (the contract both engines and the validator share).
    expect(BEACON_CONFIG_LIMITS).toEqual({
      text: 65_536,
      elements: 4096,
      lists: { count: 500, chars: 4096 },
      status: { keys: 32, chars: 4096 }
    });
  });

  it('pins the name/version/cache-comment markers', () => {
    expect(CACHE_COMMENT_MARKERS).toEqual([
      "This website is like a Rocket, isn't it?",
      'Cached for great performance',
      'Optimized for great performance'
    ]);
    expect(CACHE_DEBUG_MARKER).toBe('Debug: cached');
    expect('Debug: cached@1699999999'.match(CACHE_TIMESTAMP_PATTERN)?.[1]).toBe('1699999999');
    expect(extractWprVersion('WP Rocket 3.20.0.2')).toBe('3.20.0.2');
    expect(extractWprVersion('WPML 4.7.2')).toBeNull();
  });

  it('parses only a strict decimal cache stamp within the display domain', () => {
    expect(parseCacheTimestampToken('Debug: cached@1699999999')).toBe(1699999999);
    expect(parseCacheTimestampToken('Debug: cached@0')).toBe(0);
    expect(parseCacheTimestampToken(`Debug: cached@${String(MAX_CACHE_STAMP_SECONDS)}`)).toBe(
      MAX_CACHE_STAMP_SECONDS
    );
    for (const data of [
      'Debug: cached@0x10',
      'Debug: cached@-5',
      'Debug: cached@1.5',
      'Debug: cached@abc',
      'Debug: cached@',
      `Debug: cached@${String(MAX_CACHE_STAMP_SECONDS + 1)}`,
      `Debug: cached@${'9'.repeat(400)}`
    ]) {
      expect(parseCacheTimestampToken(data), data).toBeNull();
    }
  });
});

describe('platforms and ids', () => {
  it('declares the three header-detectable platforms', () => {
    expect([...KNOWN_PLATFORMS.keys()].sort()).toEqual(['Hostinger', 'Kinsta', 'WP Engine']);
    const wpEngine = KNOWN_PLATFORMS.get('WP Engine') as ReadonlyArray<{
      headerName: string;
      value?: string;
    }>;
    expect(wpEngine[0]?.headerName).toBe('X-Powered-By');
    expect(wpEngine[0]?.value).toBe('WP Engine');
    // Kinsta matches on presence alone (no expected value).
    const kinsta = KNOWN_PLATFORMS.get('Kinsta') as ReadonlyArray<{
      headerName: string;
      value?: string;
    }>;
    expect(kinsta[0]?.value).toBeUndefined();
  });

  it('keeps the alarm and menu ids stable', () => {
    expect(ALARM_ID_UPDATE_KNOWN_CONFLICTS_DB).toBe('update-known-conflicts-db');
    expect(Object.values(CONTEXT_MENU_IDS).sort()).toEqual(
      [
        'exclusionBuilder',
        'openCommandPalette',
        'openNowProcket',
        'pageUiGate',
        'psiSideBySide',
        'toggleDetectionWidget',
        'updateKnownConflictsDB',
        'wprSideBySide'
      ].sort()
    );
  });

  it("reads the cache bypass as the parameter's presence (the plugin's own check)", () => {
    expect(isCacheBypassUrl('https://example.test/?nowprocket=1')).toBe(true);
    expect(isCacheBypassUrl('https://example.test/?a=1&nowprocket=0')).toBe(true);
    expect(isCacheBypassUrl('https://example.test/?nowprocket')).toBe(true);
    expect(isCacheBypassUrl('https://example.test/?nowprocketx=1')).toBe(false);
    expect(isCacheBypassUrl('https://example.test/#nowprocket=1')).toBe(false);
    expect(isCacheBypassUrl(new URL('https://example.test/?nowprocket=1'))).toBe(true);
    // PHP's parse_str accepts array-shaped keys; the page's own bypass does too.
    for (const query of ['nowprocket[]=1', 'nowprocket[foo]=1', 'nowprocket%5B%5D=1']) {
      expect(isCacheBypassUrl(`https://example.test/?${query}`), query).toBe(true);
    }
    expect(isCacheBypassUrl('https://example.test/?nowprocket[=1')).toBe(false);
    // An unparsable URL cannot attest a bypass, and must not throw on boot.
    expect(isCacheBypassUrl('/relative?nowprocket=1')).toBe(false);
    expect(isCacheBypassUrl('not a url')).toBe(false);
  });

  it('adds the bare bypass parameter, keeping the query bytes and the fragment', () => {
    const cases: Array<[string, string]> = [
      ['https://example.test/', 'https://example.test/?nowprocket'],
      ['https://example.test/path', 'https://example.test/path?nowprocket'],
      ['https://example.test/?a=b', 'https://example.test/?a=b&nowprocket'],
      ['https://example.test/?a=b#h', 'https://example.test/?a=b&nowprocket#h'],
      ['https://example.test/p#h', 'https://example.test/p?nowprocket#h'],
      // A fragment spelling a bypass is not one: the query still gets it.
      ['https://example.test/#nowprocket', 'https://example.test/?nowprocket#nowprocket'],
      // Bare `?`/`#` (empty `search`/`hash`) and a trailing `&` keep their text.
      ['https://example.test/?', 'https://example.test/?nowprocket'],
      ['https://example.test/?#', 'https://example.test/?nowprocket#'],
      ['https://example.test/?a=b&', 'https://example.test/?a=b&nowprocket'],
      // Encoded, valueless and `+` parameters are never re-serialized.
      ['https://example.test/?q=a%20b&flag', 'https://example.test/?q=a%20b&flag&nowprocket'],
      ['https://example.test/?q=a+b&x=%2F', 'https://example.test/?q=a+b&x=%2F&nowprocket'],
      ['https://example.test/?nowprocketx=1', 'https://example.test/?nowprocketx=1&nowprocket'],
      ['http://127.0.0.1:8493/fdt/?a[]=1', 'http://127.0.0.1:8493/fdt/?a[]=1&nowprocket']
    ];
    for (const [input, expected] of cases) {
      expect(withCacheBypass(new URL(input)), input).toBe(expected);
    }
  });

  it('leaves an already-bypassed URL exactly as it is, in every accepted form', () => {
    for (const href of [
      'https://example.test/?nowprocket',
      'https://example.test/?nowprocket=1',
      'https://example.test/?a=b&nowprocket=0#h',
      'https://example.test/?nowprocket[]=1',
      'https://example.test/?nowprocket%5Bx%5D=1'
    ]) {
      const url = new URL(href);
      expect(withCacheBypass(url), href).toBe(url.href);
    }
  });

  it('answers a URL its own bypass check accepts', () => {
    for (const href of ['https://example.test/', 'https://example.test/?a=1#x']) {
      expect(isCacheBypassUrl(withCacheBypass(new URL(href))), href).toBe(true);
    }
  });

  it('reads the bypass where URLSearchParams method iterators are not iterable', () => {
    // A content-script sandbox shape: `keys()`/`values()`/`entries()` answer
    // iterator objects lacking `Symbol.iterator` — `for…of` over them throws
    // and `Array.from` silently answers empty.
    const sandboxed = (href: string): URL => {
      const url = new URL(href);
      const bareIterator = (): object => ({ next: () => ({ done: true, value: undefined }) });
      for (const method of ['keys', 'values', 'entries'] as const) {
        Object.defineProperty(url.searchParams, method, { value: bareIterator });
      }
      return url;
    };
    expect(isCacheBypassUrl(sandboxed('https://example.test/?a=1&nowprocket=1'))).toBe(true);
    expect(isCacheBypassUrl(sandboxed('https://example.test/?nowprocket[x]=1'))).toBe(true);
    expect(isCacheBypassUrl(sandboxed('https://example.test/?nowprocketx=1'))).toBe(false);
  });

  it("names the Exclusion Builder's document marker in this extension's namespace", () => {
    expect(BUILDER_MARKER_META_NAME).toBe('wpr-fdt-exclusion-builder');
    expect(GENERATOR_META_SELECTOR).not.toContain(BUILDER_MARKER_META_NAME);
  });

  it('single-sources the url patterns and search action ids', () => {
    expect(URL_PATTERNS).toEqual(['https://*/*', 'http://*/*']);
    expect(DELAY_JS_SRC).toBe('data-rocket-src');
    expect(FDT_EXCLUDED_RESOURCE).toBe('data-wpr-fdt-excluded');
    expect(WPR_DEFER_ATTRIBUTE).toBe('data-rocket-defer');
    expect(INLINE_WRAP_OPEN).toBe("window.addEventListener('DOMContentLoaded', function() {");
    expect(INLINE_WRAP_CLOSE).toBe('});');
    expect(Object.values(PANEL_SEARCH_ACTIONS).sort()).toEqual(
      ['cancelSearch', 'nextSearchResult', 'performSearch', 'previousSearchResult'].sort()
    );
  });
});
