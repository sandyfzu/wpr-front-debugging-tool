/**
 * The export redaction: the notice comes first, header rows go through the
 * header rule (capture-withheld rows final), and every other page-derived
 * value is walked — sensitive-named fields replaced, URLs and keyed string
 * literals scrubbed — with the contract's own structure left intact.
 */
import { describe, expect, it } from 'vitest';
import { makeReportData } from '../panel/support-report.fixtures';
import type { DelayedScriptRecord, FdtData } from '../wp-rocket/types';
import { redactPageHeaders } from './headers';
import { EXPORT_REDACTION_NOTICE, redactPageDataForExport, scrubText } from './page-data';
import {
  PLANTED,
  PLANTED_INLINE_BODIES,
  PLANTED_OPTIONS,
  PLANTED_RAW_HEADERS
} from './planted-secrets.fixtures';
import { isSensitiveName } from './rule';

/** A page whose every free-text corner carries a planted secret. */
function plantedPage(pageHeaders: FdtData['pageHeaders']): FdtData {
  const base = makeReportData({ pageHeaders });
  return {
    ...base,
    wprDetections: {
      ...base.wprDetections,
      delay_js: {
        present: true,
        version: null,
        delayedScripts: PLANTED_INLINE_BODIES.length + 1,
        scripts: [
          ...PLANTED_INLINE_BODIES.map((content) => ({
            inline: true,
            content,
            delayed: true,
            deferred: false,
            deferredByWPR: false,
            fdtExcluded: null,
            minifyAttribute: false
          })),
          {
            inline: false,
            src: 'https://a.example/s.js?ver=2&amp;nonce=PLANTED_SRC_NONCE',
            delayed: true,
            deferred: false,
            deferredByWPR: true,
            fdtExcluded: null,
            minifyAttribute: false
          }
        ]
      },
      defer_all_js: {
        present: true,
        scripts: ['https://a.example/s.js?ver=1&token=PLANTED_SRC#PLANTED_HASH'],
        deferredScripts: 1
      }
    },
    preloadedResources: {
      present: true,
      resources: [
        { href: 'https://u:PLANTED_CRED@a.example/f.woff2?sig=PLANTED_SIG', type: 'font' }
      ]
    },
    diagnoserData: {
      noRocketData: {
        constants: { WP_ROCKET_KEY: 'PLANTED_LICENSE', WP_ROCKET_EMAIL: 'PLANTED@a.example' },
        server_info: { web_server: 'nginx' },
        imagify: PLANTED_OPTIONS
      },
      rocketData: {
        options: {
          consumer_key: { option_name: 'consumer_key', get_rocket_option: { value: 'PLANTED_CK' } },
          secret_key: { option_name: 'secret_key', get_rocket_option: { value: 'PLANTED_SK' } },
          cdn: { option_name: 'cdn', get_rocket_option: { value: 1 }, filters: {} }
        },
        post_meta_excluded_options: {}
      }
    }
  };
}

describe('redactPageDataForExport', () => {
  it('withholds every inline script body, keeping its length, src and flags', () => {
    const exported = redactPageDataForExport(plantedPage(null));
    const scripts = (exported['wprDetections'] as FdtData['wprDetections']).delay_js
      .scripts as unknown[];
    expect(scripts.slice(0, PLANTED_INLINE_BODIES.length)).toEqual(
      PLANTED_INLINE_BODIES.map((body) => ({
        inline: true,
        content: { withheld: true, length: body.length },
        delayed: true,
        deferred: false,
        deferredByWPR: false,
        fdtExcluded: null,
        minifyAttribute: false
      }))
    );
    // An external script keeps its src (reduced) and every flag, no content key.
    expect(scripts.at(-1)).toEqual({
      inline: false,
      src: 'https://a.example/s.js?ver=2&amp;nonce=[redacted]',
      delayed: true,
      deferred: false,
      deferredByWPR: true,
      fdtExcluded: null,
      minifyAttribute: false
    });
    expect(EXPORT_REDACTION_NOTICE.note).toContain('inline script bodies are withheld');
  });

  it('withholds camelCase and salt/PKCE-named options, keeping the evidence ones', () => {
    const json = JSON.stringify(redactPageDataForExport(plantedPage(null)));
    expect(json).not.toContain(PLANTED);
    expect(json).toContain('"minify_css_key":"5f1a2b3c4d5e6"');
    expect(json).toContain('"cdn_state":"enabled"');
    expect(json).toContain('"licenseKey":"[redacted]"');
  });

  it('redacts every occurrence of a repeated sensitive key (the memoised rule)', () => {
    const exported = redactPageDataForExport({
      ...makeReportData(),
      diagnoserData: {
        noRocketData: { a: { apiKey: 'PLANTED_FIRST' }, b: { apiKey: 'PLANTED_SECOND' } },
        rocketData: null
      }
    });
    expect(JSON.stringify(exported)).not.toContain(PLANTED);
  });

  it('never reads a key of the contract itself as sensitive', () => {
    const contractKeys = [
      ...'allScriptsLoaded as async_css atf auto_preload_fonts automatic_lazy_rendering bypassAttested cacheMarkerFound cached capturedAt constants content cookieName criticalStyle cookies defer_all_js deferred deferredByWPR deferredScripts delay_js delayed delayedScripts diagnoserData dns_prefetch domains elements excludedReasonsFound external_font_exclusions fdtExcluded filters fonts get_rocket_option headers hints hintsTruncated href image_dimensions images imagify inline inlineCssPresent isMobile lazyload lazyload_css_bg_img lazyload_iframes lazyloadDetected lazyRenderElements lcpComment locationHashes lrc mark minifyAttribute minify_concatenate_js minify_css minify_js mobile_cache name names noRocketData option_name options originalType pageHeaders pageHeadersTruncated php_memory_limit post_meta_excluded_options preconnect_external_domain preconnect_external_domain_elements preconnect_external_domain_exclusions preconnect_external_domains preconnectCount preload_fonts preload_fonts_exclusions preload_links preload_rucss_parameters preload_rucss_tasks preloadedImages preloadedResources present priority_elements_beacon processed_extensions querystrings redacted rel remove_unused_css replaceImage resources rocket_above_the_fold_optimization rocket_cdn rocketData scripts self_hosted_fonts server_info server_load source src status targets timeStamp truncated type undefinedReferencesOnPage user_agent value variant version web_server wp_max_memory_limit wp_memory_limit wpr wpr_diagnoser_version wpr_plugin wprDetections withheld length redaction applied note'.split(
        ' '
      )
    ];
    expect(contractKeys.filter((key) => isSensitiveName(key))).toEqual([]);
  });

  it('heads the document with the redaction notice', () => {
    const exported = redactPageDataForExport(makeReportData());
    expect(Object.keys(exported)[0]).toBe('redaction');
    expect(exported.redaction).toBe(EXPORT_REDACTION_NOTICE);
    expect(EXPORT_REDACTION_NOTICE.note).toMatch(/withheld/);
  });

  it.each([
    ['capture-redacted', redactPageHeaders(PLANTED_RAW_HEADERS)],
    ['raw (an old payload)', PLANTED_RAW_HEADERS]
  ])('carries no planted secret with %s headers', (_label, headers) => {
    const json = JSON.stringify(redactPageDataForExport(plantedPage(headers)));
    expect(json).not.toContain(PLANTED);
  });

  it('keeps the evidence: header names, cookie name, ordinary values and options', () => {
    const exported = redactPageDataForExport(plantedPage(redactPageHeaders(PLANTED_RAW_HEADERS)));
    expect(exported['pageHeaders']).toEqual(redactPageHeaders(PLANTED_RAW_HEADERS));
    const json = JSON.stringify(exported);
    expect(json).toContain('"web_server":"nginx"');
    expect(json).toContain('"consumer_key":"[redacted]"');
    expect(json).toContain('"cdn":{"option_name":"cdn"');
    expect(json).toContain('https://a.example/s.js?ver=1&token=[redacted]');
  });

  it('leaves a secret-free page structurally identical (bar the notice)', () => {
    const data = makeReportData();
    const { redaction, ...rest } = redactPageDataForExport(data);
    expect(redaction).toBe(EXPORT_REDACTION_NOTICE);
    expect(rest).toEqual(data);
  });

  it('keeps a page-provided __proto__ key as data, never as the prototype', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":"PLANTED_PROTO"}}') as Record<
      string,
      unknown
    >;
    const exported = redactPageDataForExport({
      ...makeReportData(),
      diagnoserData: { noRocketData: hostile, rocketData: null }
    });
    const slot = (exported['diagnoserData'] as { noRocketData: object }).noRocketData;
    expect(Object.getPrototypeOf(slot)).toBe(Object.prototype);
    expect(Object.hasOwn(slot, '__proto__')).toBe(true);
  });

  it('leaves the input untouched', () => {
    const data = plantedPage(PLANTED_RAW_HEADERS);
    const before = JSON.stringify(data);
    redactPageDataForExport(data);
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe('scrubText', () => {
  it.each([
    // An `&`-led pair in a relative URL, a long sensitive name, an encoded name.
    ['/rel?a=1&token=t', '/rel?a=1&token=[redacted]'],
    ['/rel?a=1&access_token=t', '/rel?a=1&access_token=[redacted]'],
    ['/rel?%74oken=t', '/rel?%74oken=[redacted]'],
    // HTML-escaped `&` stays part of the URL: no fake fragment, escape kept.
    [
      'https://a.example/p?a=1&#038;nonce=n&#038;b=2',
      'https://a.example/p?a=1&#038;nonce=[redacted]&#038;b=2'
    ],
    ['https://a.example/p?a=1&amp;b=2', 'https://a.example/p?a=1&amp;b=2'],
    ['https://a.example/p?a=1&#38;b=2#frag', 'https://a.example/p?a=1&#38;b=2'],
    ['https://a.example/p?a=1&#x26;sig=s#f', 'https://a.example/p?a=1&#x26;sig=[redacted]'],
    ['https://a.example/p?a=1&#X0026;b=2', 'https://a.example/p?a=1&#X0026;b=2'],
    // `key`/`code`/`state` values are withheld whatever they look like
    // (a lowercase-only token reads exactly like an identifier).
    ['{key:"methodName"}', '{key:"[redacted]"}'],
    ['{"state":"abcdefghijklmnop","code":"value"}', '{"state":"[redacted]","code":"[redacted]"}'],
    ['{"state":"af0ifjsldkj9","code":"4/0AX4XfWh"}', '{"state":"[redacted]","code":"[redacted]"}'],
    ['{"nonce":"methodName"}', '{"nonce":"[redacted]"}'],
    [
      '{"userEmail":"a@b.c","accessKey":"k"}',
      '{"userEmail":"[redacted]","accessKey":"[redacted]"}'
    ],
    ['plain text', 'plain text'],
    ['img, .hero > picture', 'img, .hero > picture'],
    ['https://a.example/p?x=1', 'https://a.example/p?x=1'],
    ['https://a.example/p?nonce=n&x=1', 'https://a.example/p?nonce=[redacted]&x=1'],
    ['/rel?token=t', '/rel?token=[redacted]'],
    ['https:\\/\\/a.example\\/?key=k', 'https:\\/\\/a.example\\/?key=[redacted]'],
    ['{"nonce":"n1","ok":"v"}', '{"nonce":"[redacted]","ok":"v"}'],
    ["x = { 'api-key' : 'k' }", "x = { 'api-key' : '[redacted]' }"],
    ['auth_token="a\\"b"; next="c"', 'auth_token="[redacted]"; next="c"'],
    ['a == "nonce"', 'a == "nonce"'],
    ['monkey = "banana"', 'monkey = "banana"']
  ])('scrubs %j', (text, scrubbed) => {
    expect(scrubText(text)).toBe(scrubbed);
  });

  it('is idempotent', () => {
    const once = scrubText('{"nonce":"n"} https://a.example/?token=t /x?sig=s');
    expect(scrubText(once)).toBe(once);
  });

  it('stays linear over a long unterminated literal run', () => {
    const text = `${'k="v" '.repeat(20_000)}nonce="${'x'.repeat(200_000)}`;
    const started = performance.now();
    scrubText(text);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('export cost', () => {
  it('redacts a 5,000-script page well within a frame budget (bodies withheld)', () => {
    const base = plantedPage(null);
    const scripts = Array.from({ length: 5_000 }, (_, i): DelayedScriptRecord => ({
      inline: i % 2 === 0,
      ...(i % 2 === 0
        ? { content: `var c${String(i)} = {"nonce":"n"}; ${'f(a,b); '.repeat(200)}` }
        : { src: `https://s.example/p/s${String(i)}.js?ver=1.${String(i)}` }),
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      minifyAttribute: false
    }));
    const data: FdtData = {
      ...base,
      wprDetections: {
        ...base.wprDetections,
        delay_js: { present: true, version: null, delayedScripts: 5_000, scripts },
        defer_all_js: {
          present: true,
          scripts: scripts.map((script) => script.src ?? ''),
          deferredScripts: scripts.length
        }
      }
    };
    redactPageDataForExport(data); // warm-up (JIT)
    const started = performance.now();
    redactPageDataForExport(data);
    // Measured ~13 ms locally; the bound only catches a regression to the
    // per-value throwing parse (~50 ms+) with CI headroom.
    expect(performance.now() - started).toBeLessThan(150);
  });
});
