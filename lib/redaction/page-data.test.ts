/**
 * The export redaction: the notice comes first, header rows go through the
 * header rule (capture-withheld rows final), and every other page-derived
 * value is walked — sensitive-named fields replaced, URLs and keyed string
 * literals scrubbed — with the contract's own structure left intact.
 */
import { describe, expect, it } from 'vitest';
import { makeReportData } from '../panel/support-report.fixtures';
import type { FdtData } from '../wp-rocket/types';
import { redactPageHeaders } from './headers';
import { EXPORT_REDACTION_NOTICE, redactPageDataForExport, scrubText } from './page-data';
import { PLANTED, PLANTED_RAW_HEADERS } from './planted-secrets.fixtures';

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
        delayedScripts: 1,
        scripts: [
          {
            inline: true,
            content:
              'var wpApiSettings = {"root":"https:\\/\\/a.example\\/wp-json\\/","nonce":"PLANTED_JSON_NONCE"};' +
              "var cfg = { api_key: 'PLANTED_SINGLE', ajax: '/admin-ajax.php?_wpnonce=PLANTED_REL' };" +
              'var secretToken = "PLANTED_ASSIGN";',
            delayed: true,
            deferred: false,
            deferredByWPR: false,
            fdtExcluded: null
          }
        ]
      },
      defer_all_js: {
        present: true,
        scripts: ['https://a.example/s.js?ver=1&token=PLANTED_SRC#PLANTED_HASH']
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
        server_info: { web_server: 'nginx' }
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
