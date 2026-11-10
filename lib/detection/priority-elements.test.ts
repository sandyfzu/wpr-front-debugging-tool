/**
 * Priority Elements subsystem tests: per-check evidence rules over tiny
 * inline documents (every true/false/adversarial branch the corpus
 * fixtures do not isolate), the config-parse degrade matrix, and the
 * propagation rule the beacon row joins.
 */
import { describe, expect, it } from 'vitest';
import { parsePage } from './parse-page';
import { runDetection } from './run-detection';
import {
  detectAutoPreloadFonts,
  detectAutomaticLazyRendering,
  detectBeacon,
  detectOptimizeCriticalImages,
  detectPreconnectExternalDomains,
  parseBeaconConfig
} from './priority-elements';
import { BEACON_CONFIG_LIMITS } from '../wp-rocket/constants';

function page(html: string) {
  return parsePage(html);
}

/** A plugin-realistic config body with the given status + payload overrides. */
function configScript(status: unknown, payload: Record<string, unknown> = {}): string {
  const body = JSON.stringify({
    ajax_url: 'https://example.com/wp-admin/admin-ajax.php',
    nonce: 'abc123',
    url: 'https://example.com/',
    is_mobile: false,
    width_threshold: 1600,
    height_threshold: 700,
    delay: 500,
    debug: false,
    status,
    ...payload
  });
  return `<script>var rocket_beacon_data = ${body}</script>`;
}

const BEACON_TAG =
  '<script data-name="wpr-wpr-beacon" src=\'https://example.com/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js\' async></script>';

describe('detectBeacon', () => {
  it('anchors on the marker attribute', () => {
    const parsed = page(`<body>${BEACON_TAG}</body>`);
    expect(detectBeacon(parsed, null)).toEqual({
      present: true,
      status: null,
      isMobile: null
    });
  });

  it('falls back to the assets-path src, min-agnostic', () => {
    for (const src of [
      'https://example.com/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js',
      'https://example.com/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.js'
    ]) {
      expect(
        detectBeacon(page(`<body><script src="${src}" async></script></body>`), null).present
      ).toBe(true);
    }
    // A foreign script URL must not assert.
    expect(
      detectBeacon(page('<body><script src="/assets/js/other.js"></script></body>'), null).present
    ).toBe(false);
  });

  it('merges a parsed config; a degraded config keeps the tag evidence', () => {
    const configPage = page(`<body>${configScript({ atf: true })}${BEACON_TAG}</body>`);
    const config = parseBeaconConfig(configPage);
    expect(detectBeacon(configPage, config)).toEqual({
      present: true,
      status: { atf: true },
      isMobile: false
    });
    expect(detectBeacon(configPage, null)).toEqual({
      present: true,
      status: null,
      isMobile: null
    });
  });

  it('a config without a beacon tag is not the row (the tag is the evidence)', () => {
    const parsed = page(`<body>${configScript({ atf: true })}</body>`);
    expect(detectBeacon(parsed, parseBeaconConfig(parsed))).toEqual({
      present: false,
      status: null,
      isMobile: null
    });
  });
});

describe('parseBeaconConfig', () => {
  it('parses the full plugin shape, mapping is_mobile → isMobile', () => {
    const parsed = page(
      `<body>${configScript(
        { atf: true, lrc: true, preload_fonts: false, preconnect_external_domain: true },
        {
          elements: 'img, video, picture, p, main',
          preconnect_external_domain_elements: ['link', 'script', 'iframe'],
          preconnect_external_domain_exclusions: ['fonts.example.com'],
          preload_fonts_exclusions: ['/fonts/'],
          processed_extensions: ['woff2', 'woff'],
          external_font_exclusions: ['fonts.gstatic.com']
        }
      )}</body>`
    );
    expect(parseBeaconConfig(parsed)).toEqual({
      status: { atf: true, lrc: true, preload_fonts: false, preconnect_external_domain: true },
      isMobile: false,
      elements: 'img, video, picture, p, main',
      preconnect_external_domain_elements: ['link', 'script', 'iframe'],
      preconnect_external_domain_exclusions: ['fonts.example.com'],
      preload_fonts_exclusions: ['/fonts/'],
      processed_extensions: ['woff2', 'woff'],
      external_font_exclusions: ['fonts.gstatic.com']
    });
  });

  it('parses the JavaScript-literal shape (prettified served pages)', () => {
    // The corpus's real prettified captures: single-quoted keys and strings,
    // JSON-style escapes (\/), unquoted numbers/null, one nested object —
    // served pages whose HTML was rewritten; the plugin's own emission is
    // strict JSON, this shape must parse to the same values.
    const parsed = page(
      `<script>
      var rocket_beacon_data = {
        'ajax_url': 'https:\\/\\/example.com\\/wp-admin\\/admin-ajax.php',
        'nonce': '93b04da79c',
        'url': 'https:\\/\\/example.com\\/landing-page',
        'is_mobile': false,
        'width_threshold': 1600,
        'height_threshold': 700,
        'delay': 500,
        'debug': null,
        'status': { 'atf': true, 'lrc': true, 'preconnect_external_domain': true },
        'elements': 'img, video',
        'preconnect_external_domain_elements': ['link', 'script', 'iframe'],
        'preconnect_external_domain_exclusions': [
          'static.cloudflareinsights.com',
          'rel="profile"'
        ]
      };
    </script>`
    );
    expect(parseBeaconConfig(parsed)).toEqual({
      status: { atf: true, lrc: true, preconnect_external_domain: true },
      isMobile: false,
      elements: 'img, video',
      preconnect_external_domain_elements: ['link', 'script', 'iframe'],
      preconnect_external_domain_exclusions: ['static.cloudflareinsights.com', 'rel="profile"']
    });
  });

  it('an own `__proto__` key anywhere in the status map degrades the config', () => {
    // JSON.parse creates __proto__ as an own property; preserving it would
    // read through the inherited setter (a null value would even clear the
    // rebuilt object's prototype). Hostile → wholesale degrade, both engines.
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {"status":{"__proto__":"evil","lrc":true}}</script>')
      )
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {"status":{"__proto__":null,"lrc":true}}</script>')
      )
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page(
          '<script>var rocket_beacon_data = {"status":{"__proto__":{"x":1},"lrc":true}}</script>'
        )
      )
    ).toBeNull();
  });

  it('the config text is bounded before parsing (no hostile JSON materialization)', () => {
    const big = '"' + 'x'.repeat(BEACON_CONFIG_LIMITS.text + 1) + '"';
    expect(
      parseBeaconConfig(page(`<script>var rocket_beacon_data = {"elements": ${big}}</script>`))
    ).toBeNull();
  });

  it('the feature-comment collection is capped (hostile comment padding)', () => {
    // parsePage's cap: beyond it feature comments stop being collected (they
    // are corroboration only — never the engine's primary evidence).
    const many = Array.from({ length: 400 }, (_, i) => `<!-- wpr_pad${String(i)} -->`).join('');
    const comments = page(many).comments;
    expect(comments.length).toBe(256);
  });

  it('the first config script wins, hostile or not', () => {
    const parsed = page(
      '<script>var rocket_beacon_data = {"status": bad</script>' +
        '<script>var rocket_beacon_data = {"status": {"atf": true}}</script>'
    );
    expect(parseBeaconConfig(parsed)).toBeNull();
  });

  it('the literal parser fails structural violations of its bounded subset', () => {
    const html = (literal: string) =>
      parseBeaconConfig(page(`<script>var rocket_beacon_data = ${literal}</script>`));
    // Unknown escape sequence.
    expect(html(`{ 'a': 'bad\\qescape' }`)).toBeNull();
    // Unterminated string.
    expect(html(`{ 'a': 'open' }`.replace("open'", 'open'))).toBeNull();
    // Trailing content after the value is not config.
    expect(html(`{ 'a': 'x' } other()`)).toBeNull();
    // Nesting beyond the cap.
    expect(html(`{ 'a': [[[[[['deep']]]]]] }`)).toBeNull();
    // Non-finite/absent numbers.
    expect(html(`{ 'a': - }`)).toBeNull();
  });

  it('tolerates a trailing semicolon and unknown primitive status keys', () => {
    const html =
      '<script>var rocket_beacon_data = {"status":{"atf":true,"future_feature":true},"is_mobile":true};</script>';
    const parsed = page(html);
    expect(parseBeaconConfig(parsed)).toEqual({
      status: { atf: true, future_feature: true },
      isMobile: true
    });
  });

  it('an empty status map is valid (no feature enabled)', () => {
    expect(parseBeaconConfig(page(`<body>${configScript({})}</body>`))).toEqual({
      status: {},
      isMobile: false
    });
  });

  it('absent status/is_mobile keep the rest of the config usable', () => {
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"elements":"img"}</script>'))
    ).toEqual({ status: null, isMobile: null, elements: 'img' });
  });

  it('degrades wholesale on malformed JSON or non-object JSON', () => {
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"status":</script>'))
    ).toBeNull();
    expect(parseBeaconConfig(page('<script>var rocket_beacon_data = null</script>'))).toBeNull();
    expect(parseBeaconConfig(page('<script>var rocket_beacon_data = [1,2]</script>'))).toBeNull();
    // Code appended after the JSON is not config.
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"a":1}; evil()</script>'))
    ).toBeNull();
  });

  it('degrades on status violations: wrong type, non-boolean known key, hostile unknown key', () => {
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"status":true}</script>'))
    ).toBeNull();
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"status":{"atf":"yes"}}</script>'))
    ).toBeNull();
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"status":{"lrc":[1]}}</script>'))
    ).toBeNull();
    // An oversized unknown-key string is hostile, not a future feature.
    const oversized = 'x'.repeat(BEACON_CONFIG_LIMITS.status.chars + 1);
    expect(
      parseBeaconConfig(
        page(`<script>var rocket_beacon_data = {"status":{"future":"${oversized}"}}</script>`)
      )
    ).toBeNull();
    // A structured unknown-key value is noise/hostile — degrade, never carry.
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"status":{"future":[1]}}</script>'))
    ).toBeNull();
  });

  it('preserves bounded unknown status values (string, number, null) and caps the key count', () => {
    const parsed = page(
      '<script>var rocket_beacon_data = {"status":{"future":"kept","count":7,"nil":null},"is_mobile":false}</script>'
    );
    expect(parseBeaconConfig(parsed)?.status).toEqual({
      future: 'kept',
      count: 7,
      nil: null
    });
    const many = Object.fromEntries(
      Array.from({ length: BEACON_CONFIG_LIMITS.status.keys + 1 }, (_, i) => [
        `k${String(i)}`,
        true
      ])
    );
    expect(
      parseBeaconConfig(
        page(`<script>var rocket_beacon_data = {"status":${JSON.stringify(many)}}</script>`)
      )
    ).toBeNull();
  });

  it('degrades on payload violations (elements type/size, list shapes, items)', () => {
    expect(
      parseBeaconConfig(page('<script>var rocket_beacon_data = {"elements":42}</script>'))
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page(
          `<script>var rocket_beacon_data = {"elements":"${'x'.repeat(BEACON_CONFIG_LIMITS.elements + 1)}"}</script>`
        )
      )
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {"preload_fonts_exclusions":"not-a-list"}</script>')
      )
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {"processed_extensions":["ok", 5]}</script>')
      )
    ).toBeNull();
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {"processed_extensions":[""]}</script>')
      )
    ).toBeNull();
    const tooMany = Array.from({ length: BEACON_CONFIG_LIMITS.lists.count + 1 }, () => 'x');
    expect(
      parseBeaconConfig(
        page(
          `<script>var rocket_beacon_data = {"external_font_exclusions":${JSON.stringify(tooMany)}}</script>`
        )
      )
    ).toBeNull();
  });

  it('reads a list with holes (PHP array_filter keys) as its values in key order', () => {
    // `wp_json_encode` writes a filtered list whose keys are no longer 0..n-1 as an object.
    const parsed = parseBeaconConfig(
      page(
        configScript(
          { preconnect_external_domain: true },
          {
            preconnect_external_domain_elements: { '0': 'link', '2': 'iframe' },
            processed_extensions: { '10': 'woff', '2': 'woff2' },
            external_font_exclusions: {}
          }
        )
      )
    );
    expect(parsed?.preconnect_external_domain_elements).toEqual(['link', 'iframe']);
    // Numeric order, not text order ("10" sorts after "2").
    expect(parsed?.processed_extensions).toEqual(['woff2', 'woff']);
    expect(parsed?.external_font_exclusions).toEqual([]);
  });

  it('a list object with any other key, a bad item or over the count cap still degrades', () => {
    for (const list of [
      { '0': 'link', a: 'script' },
      { '-1': 'link' },
      { '01': 'link' },
      { '1.5': 'link' },
      { '1234567890123456': 'link' },
      { '0': 'link', '1': 5 },
      { '0': '' },
      { '0': ['nested'] },
      Object.fromEntries(
        Array.from({ length: BEACON_CONFIG_LIMITS.lists.count + 1 }, (_, index) => [
          String(index * 2),
          'x'
        ])
      )
    ]) {
      expect(
        parseBeaconConfig(page(configScript({}, { preload_fonts_exclusions: list }))),
        JSON.stringify(list).slice(0, 60)
      ).toBeNull();
    }
  });

  it('a literal `__proto__` key degrades the config (never a hidden prototype)', () => {
    for (const list of ["{__proto__: {'0': 'x'}}", "{__proto__: {'0': 'x'}, '1': 'a'}"]) {
      expect(
        parseBeaconConfig(
          page(
            `<script>var rocket_beacon_data = {status: {}, processed_extensions: ${list}};</script>`
          )
        ),
        list
      ).toBeNull();
    }
    expect(
      parseBeaconConfig(
        page('<script>var rocket_beacon_data = {__proto__: {status: {}}};</script>')
      )
    ).toBeNull();
  });

  it('a list with holes in the literal shape reads the same', () => {
    const parsed = parseBeaconConfig(
      page(
        "<script>var rocket_beacon_data = {status: {}, preconnect_external_domain_elements: {'0': 'link', '2': 'iframe'}};</script>"
      )
    );
    expect(parsed?.preconnect_external_domain_elements).toEqual(['link', 'iframe']);
  });

  it('a config script whose text merely mentions the variable elsewhere does not match', () => {
    // The pattern is anchored to the assignment; other mentions stay inert.
    const parsed = page('<script>if (window.rocket_beacon_data) { init(); }</script>');
    expect(parseBeaconConfig(parsed)).toBeNull();
  });
});

describe('detectOptimizeCriticalImages', () => {
  it('collects attributed image preloads in doc order — including beside the beacon', () => {
    const parsed = page(
      `<html><head>
        <link rel="preload" data-rocket-preload as="image" href="https://s.com/hero.webp" fetchpriority="high">
        <link rel="preload" data-rocket-preload as="image" href="https://s.com/hero.avif" imagesrcset="https://s.com/hero.avif 1x" imagesizes="100vw" fetchpriority="high">
        <link rel="preload" data-rocket-preload as="image" imagesrcset="https://s.com/src-only.avif" fetchpriority="high">
        <link data-rocket-preload href="https://s.com/app.js" as="script">
        <script data-name="wpr-wpr-beacon" src="/wp-rocket/assets/js/wpr-beacon.min.js"></script>
      </head></html>`
    );
    // The '' entry for the srcset-only hint is the P1 engine's collection,
    // pinned here (an absent href resolves to '').
    expect(detectOptimizeCriticalImages(parsed)).toEqual({
      present: true,
      lcpComment: false,
      preloadedImages: ['https://s.com/hero.webp', 'https://s.com/hero.avif', '']
    });
    expect(detectBeacon(parsed, null).present).toBe(true);
  });

  it('the feature comment is corroboration, carried either way', () => {
    const withComment = page('<html><body>x</body></html><!-- wpr_oci -->');
    expect(detectOptimizeCriticalImages(withComment)).toEqual({
      present: false,
      lcpComment: true
    });
    // hrefs are the resolved property (relative URLs resolve against the
    // document's base — the contract every link-href list shares).
    const appliedWithComment = page(
      '<html><head><link data-rocket-preload href="https://s.com/lcp.jpg" as="image"></head><body>x</body></html><!-- wpr_oci -->'
    );
    expect(detectOptimizeCriticalImages(appliedWithComment)).toEqual({
      present: true,
      lcpComment: true,
      preloadedImages: ['https://s.com/lcp.jpg']
    });
  });

  it('only as="image" (exact) counts', () => {
    expect(
      detectOptimizeCriticalImages(page('<link data-rocket-preload href="/x.jpg" AS="IMAGE">'))
    ).toEqual({
      present: false,
      lcpComment: false
    });
  });
});

describe('detectAutomaticLazyRendering', () => {
  it('applied: converted elements set presence, the style corroborates', () => {
    const parsed = page(
      `<html><head><style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style></head>
      <body><div data-wpr-lazyrender="1"></div><div data-wpr-lazyrender="1"></div></body></html>`
    );
    expect(detectAutomaticLazyRendering(parsed)).toEqual({
      present: true,
      lazyRenderElements: 2,
      inlineCssPresent: true,
      locationHashes: 0
    });
  });

  it('collecting: hashes alone are reported but never assert', () => {
    const parsed = page(
      '<div data-rocket-location-hash="abc"><span data-rocket-location-hash="def"></span></div>'
    );
    expect(detectAutomaticLazyRendering(parsed)).toEqual({
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: false,
      locationHashes: 2
    });
  });

  it('a style without converted elements does not assert', () => {
    const parsed = page(
      '<style id="rocket-lazyrender-inline-css">[data-wpr-lazyrender] {content-visibility: auto;}</style>'
    );
    expect(detectAutomaticLazyRendering(parsed)).toEqual({
      present: false,
      lazyRenderElements: 0,
      inlineCssPresent: true,
      locationHashes: 0
    });
  });
});

describe('detectAutoPreloadFonts', () => {
  it('collects attributed font preloads', () => {
    const parsed = page(
      `<html><head>
        <link rel="preload" as="font" href="https://s.com/fonts/a.woff2" crossorigin data-rocket-preload>
        <link rel="preload" as="font" href="https://s.com/fonts/b.woff2" crossorigin data-rocket-preload>
        <link rel="preload" as="style" href="https://s.com/x.css" data-rocket-preload>
      </head></html>`
    );
    expect(detectAutoPreloadFonts(parsed)).toEqual({
      present: true,
      fonts: ['https://s.com/fonts/a.woff2', 'https://s.com/fonts/b.woff2']
    });
  });

  it('unattributed font preloads (manual pre-3.19 or third-party) never assert', () => {
    const parsed = page(
      `<html><head>
        <link rel="preload" as="font" href="https://s.com/manual.woff2" crossorigin>
        <link rel="preload" as="font" href="https://cdn.thirdparty.com/x.woff2">
      </head></html>`
    );
    expect(detectAutoPreloadFonts(parsed)).toEqual({ present: false, fonts: [] });
  });

  it('only as="font" (exact) counts', () => {
    const parsed = page('<link rel="preload" AS="FONT" href="/x.woff2" data-rocket-preload>');
    expect(detectAutoPreloadFonts(parsed)).toEqual({ present: false, fonts: [] });
  });
});

describe('detectPreconnectExternalDomains', () => {
  it('collects both variants; the preconnect variant counts separately', () => {
    const parsed = page(
      `<html><head>
        <link data-rocket-prefetch href="https://example.org" rel="dns-prefetch">
        <link data-rocket-prefetch href="https://example.com" rel="dns-prefetch">
        <link href="https://fonts.gstatic.com" rel="preconnect" crossorigin data-rocket-preconnect>
        <link href="https://fonts.gstatic.com" rel="preconnect" crossorigin data-rocket-preconnect>
      </head></html>`
    );
    // Resolved hrefs: a bare-origin URL normalizes with a trailing slash
    // (matching the plugin's own esc_url emission).
    expect(detectPreconnectExternalDomains(parsed)).toEqual({
      present: true,
      domains: ['https://example.org/', 'https://example.com/', 'https://fonts.gstatic.com/'],
      preconnectCount: 2
    });
  });

  it('a bare dns-prefetch hint (RocketCDN included) asserts nothing here', () => {
    const parsed = page('<link rel="dns-prefetch" href="https://cdn.rocketcdn.me">');
    expect(detectPreconnectExternalDomains(parsed)).toEqual({
      present: false,
      domains: [],
      preconnectCount: 0
    });
  });

  it('the two feature rows coexist when a RocketCDN hint carries the attribution', () => {
    const result = runDetection(
      '<link data-rocket-prefetch href="https://cdn.rocketcdn.me" rel="dns-prefetch">'
    );
    expect(result.detections.preconnect_external_domains).toEqual({
      present: true,
      source: 'footprint',
      domains: ['https://cdn.rocketcdn.me/'],
      preconnectCount: 0
    });
    expect(result.detections.rocket_cdn).toEqual({ present: true, source: 'footprint' });
  });

  it('an empty href proves no domain but still counts the variant', () => {
    // Empty-href variants: the variant link counts, the (absent) domain does not.
    const parsed = page('<link data-rocket-preconnect rel="preconnect" crossorigin>');
    expect(detectPreconnectExternalDomains(parsed)).toEqual({
      present: false,
      domains: [],
      preconnectCount: 1
    });
  });
});

describe('presence propagation — the Priority Elements rows imply WP Rocket', () => {
  it('a beacon-only page (features pending, zero applied markers) is a WP Rocket page', () => {
    const result = runDetection(`<html><body>${BEACON_TAG}</body></html>`);
    expect(result.detections.priority_elements_beacon.present).toBe(true);
    expect(result.detections.wpr.present).toBe(true);
  });

  it('attributed hints alone imply presence too', () => {
    const result = runDetection('<link data-rocket-prefetch href="https://example.org">');
    expect(result.detections.preconnect_external_domains.present).toBe(true);
    expect(result.detections.wpr.present).toBe(true);
  });
});

describe('detectBeacon — served URL on Delay JS-rewritten tags', () => {
  // No `data-name`: the URL fallback alone decides (a tag whose marker
  // attribute another optimizer dropped).
  const path = '/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js';
  it.each([
    ['delayed', `data-rocket-src="https://s.com${path}"`, true],
    ['plain', `src="https://s.com${path}"`, true],
    ['both attributes: the delayed URL wins', `src="/other.js" data-rocket-src="${path}"`, true],
    ['both attributes: a foreign delayed URL', `src="${path}" data-rocket-src="/other.js"`, false],
    ['empty data-rocket-src falls back to src', `data-rocket-src="" src="${path}"`, true],
    ['valueless data-rocket-src falls back to src', `data-rocket-src src="${path}"`, true],
    ['empty data-rocket-src alone', 'data-rocket-src=""', false],
    ['relative delayed URL', `data-rocket-src="${path}"`, true]
  ])('%s', (_case, attrs, matches) => {
    const parsed = page(`<body><script type="rocketlazyloadscript" ${attrs}></script></body>`);
    expect(detectBeacon(parsed, null).present).toBe(matches);
  });
});
