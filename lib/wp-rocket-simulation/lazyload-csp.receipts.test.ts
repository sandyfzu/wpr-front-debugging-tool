/**
 * The LazyLoad CSP check against every browser receipt: WP Rocket's real
 * hook texts and runtime under one policy setup per row, observed on
 * Chromium 156 and Firefox 155 (runtime ran, options ran, images lazy
 * loaded after a scroll, placeholders rendered) — one verdict per engine.
 * Not a row: an `https` page whose runtime URL is `http` (mixed content
 * blocks it before CSP is asked, on WP Rocket's page alike: receipts in
 * `script-request.test.ts`). Firefox requests an upgraded runtime through
 * an internal redirect the probe cannot answer, so its upgraded rows read
 * the CSP verdict from the page's violation events (none for the runtime
 * = allowed); its built-extension runs confirmed four of them end to end.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import { cspMetaPolicies } from './csp-meta';
import type { SimulationCspVerdict } from './csp-evaluation';
import { evaluateLazyloadCsp, inlineScriptText } from './lazyload-csp';
import { SIMULATION_DATA_PATH, readSimulationData } from './simulation-data';
import type { SimulationCspBrowser } from './spec';
import { SUPPORTED_WPR_VERSIONS } from '../wp-rocket/versions';

const HERE = dirname(fileURLToPath(import.meta.url));

const DATA = (() => {
  const read = readSimulationData(
    JSON.parse(readFileSync(join(HERE, '../../public', SIMULATION_DATA_PATH), 'utf8'))
  );
  if (!read.ok) throw new Error(read.problem);
  return read.data;
})();

/** The runtime's path under a site (`{RTP}` in a row's runtime URL). */
const RTP = '/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';

/** The receipts' default document URL. */
const PAGE = 'http://site.test/p';

/** One receipt's setup: document URL, runtime URL, header values, a head meta. */
interface Setup {
  readonly page?: string;
  /** Default: the page's origin + {@link RTP}. */
  readonly runtime?: string;
  readonly headers?: readonly string[];
  readonly reportOnly?: readonly string[];
  readonly meta?: string;
}

/** A receipt's outcome: lazy loading never ran, ran, or ran with broken placeholders. */
type Outcome = 'blocked' | 'allowed' | 'placeholders';

/**
 * Every receipt: [name, setup, Chromium outcome, Firefox outcome]. Hash
 * tokens: `H256` / `H384` = the options script's sha256 / sha384 source,
 * `H256U` the sha256 one without its `=` padding.
 */
const RECEIPTS: readonly (readonly [string, Setup, Outcome, Outcome])[] = [
  ['none', {}, 'allowed', 'allowed'],
  ['self-inline', { 'headers': ["script-src 'self' 'unsafe-inline'"] }, 'allowed', 'allowed'],
  ['self', { 'headers': ["script-src 'self'"] }, 'blocked', 'blocked'],
  ['inline-only', { 'headers': ["script-src 'unsafe-inline'"] }, 'blocked', 'blocked'],
  ['self-hash', { 'headers': ["script-src 'self' H256"] }, 'allowed', 'allowed'],
  ['self-hash-unpadded', { 'headers': ["script-src 'self' H256U"] }, 'allowed', 'blocked'],
  ['self-hash384', { 'headers': ["script-src 'self' H384"] }, 'allowed', 'allowed'],
  [
    'self-inline-nonce',
    { 'headers': ["script-src 'self' 'unsafe-inline' 'nonce-abc'"] },
    'blocked',
    'blocked'
  ],
  [
    'strict-dynamic',
    { 'headers': ["script-src 'self' 'unsafe-inline' 'nonce-abc' 'strict-dynamic'"] },
    'blocked',
    'blocked'
  ],
  [
    'strict-dynamic-hash',
    { 'headers': ["script-src 'self' H256 'strict-dynamic'"] },
    'blocked',
    'blocked'
  ],
  ['star', { 'headers': ["script-src * 'unsafe-inline'"] }, 'allowed', 'allowed'],
  ['default-self', { 'headers': ["default-src 'self'"] }, 'blocked', 'blocked'],
  [
    'default-self-inline',
    { 'headers': ["default-src 'self' 'unsafe-inline'"] },
    'placeholders',
    'placeholders'
  ],
  [
    'elem-over-script',
    { 'headers': ["script-src 'none'; script-src-elem 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'elem-blocks',
    { 'headers': ["script-src 'self' 'unsafe-inline'; script-src-elem 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'img-self',
    { 'headers': ["script-src 'self' 'unsafe-inline'; img-src 'self'"] },
    'placeholders',
    'placeholders'
  ],
  [
    'default-img',
    { 'headers': ["default-src 'self' 'unsafe-inline'; img-src 'self' data:"] },
    'allowed',
    'allowed'
  ],
  [
    'img-star',
    { 'headers': ["script-src 'self' 'unsafe-inline'; img-src *"] },
    'placeholders',
    'placeholders'
  ],
  [
    'style-none',
    { 'headers': ["script-src 'self' 'unsafe-inline'; style-src 'none'"] },
    'allowed',
    'allowed'
  ],
  ['meta-self', { 'meta': "script-src 'self'" }, 'blocked', 'blocked'],
  ['meta-ok', { 'meta': "script-src 'self' 'unsafe-inline'" }, 'allowed', 'allowed'],
  ['meta-img', { 'meta': "img-src 'self'" }, 'placeholders', 'placeholders'],
  ['ro-none', { 'reportOnly': ["script-src 'none'; img-src 'none'"] }, 'allowed', 'allowed'],
  [
    'two-headers',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src * 'unsafe-inline'", "script-src 'self' 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'sandbox-scripts',
    { 'headers': ["sandbox allow-scripts; script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'sandbox-scripts-star',
    { 'headers': ["sandbox allow-scripts; script-src * 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  ['sandbox-none', { 'headers': ['sandbox'] }, 'blocked', 'blocked'],
  ['empty-list', { 'headers': ['script-src'] }, 'blocked', 'blocked'],
  ['none-plus', { 'headers': ["script-src 'none' 'self' 'unsafe-inline'"] }, 'allowed', 'allowed'],
  [
    'trusted-types',
    { 'headers': ["script-src 'self' 'unsafe-inline'; require-trusted-types-for 'script'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-self',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src 'self' 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-host',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-host-upper',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src CDN.TEST 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-host-dot',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test. 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-wild',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src *.test 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-wild-self',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src *.cdn.test 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-sub',
    { 'runtime': 'https://a.cdn.test{RTP}', 'headers': ["script-src *.cdn.test 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-port-wrong',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:8080 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-port-443',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:443 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-port-star',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:* 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-port-80-https',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src http://cdn.test:80 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-path-prefix',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/wp-content/ 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-path-exact-dir',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/wp-content 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'cdn-path-file',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': [
        "script-src https://cdn.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js 'unsafe-inline'"
      ]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-path-pct',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/wp%2Dcontent/ 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-path-case',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/WP-content/ 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'cdn-scheme-http',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src http: 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-scheme-https-up',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src HTTPS: 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-http-host',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src http://cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-https-star',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src https://* 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-none-plus',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src 'none' https://cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'http-rt-https-src',
    { 'runtime': 'http://cdn.test{RTP}', 'headers': ["script-src https: 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'http-rt-schemeless-https-page',
    {
      'page': 'https://site.test/p',
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'self-upgrade',
    { 'runtime': 'https://site.test{RTP}', 'headers': ["script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'self-port',
    {
      'page': 'http://site.test:8080/p',
      'runtime': 'https://site.test{RTP}',
      'headers': ["script-src 'self' 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'self-port-same',
    {
      'page': 'http://site.test:8080/p',
      'runtime': 'https://site.test:8080{RTP}',
      'headers': ["script-src 'self' 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'ip-host',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src 127.0.0.1:8950 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'ip-host-noport',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src 127.0.0.1 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'ip-self',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'ip-star',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src *.0.0.1 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'ip-other',
    {
      'page': 'http://127.0.0.1:8950/p',
      'runtime': 'http://10.0.0.1{RTP}',
      'headers': ["script-src 10.0.0.1 'unsafe-inline' 'self'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-schemeless-80',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:80 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-https-80',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test:80 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'cdn-http-443',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src http://cdn.test:443 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-schemeless-443-http-rt',
    { 'runtime': 'http://cdn.test{RTP}', 'headers': ["script-src cdn.test:443 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-80-http-rt-8080',
    {
      'runtime': 'https://cdn.test:8080{RTP}',
      'headers': ["script-src http://cdn.test:80 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'star-port',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src *:8080 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'star-port-443',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src *:443 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'https-star-star',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src https://*:* 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-query-src',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/wp-content/?x 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-file-slash',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': [
        "script-src https://cdn.test/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js/ 'unsafe-inline'"
      ]
    },
    'blocked',
    'blocked'
  ],
  [
    'cdn-root-slash',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test/ 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'wild-mid',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.*.test 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  ['self-upper', { 'headers': ["script-src 'SELF' 'UNSAFE-INLINE'"] }, 'allowed', 'allowed'],
  [
    'cdn-wild-port',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src *.test:443 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-underscore',
    { 'runtime': 'https://cdn_x.test{RTP}', 'headers': ["script-src cdn_x.test 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'scheme-only-host',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test: 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'ipv6-host',
    { 'page': 'http://[::1]:8950/p', 'headers': ["script-src [::1]:8950 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'ipv6-self',
    { 'page': 'http://[::1]:8950/p', 'headers': ["script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'ipv6-star',
    { 'page': 'http://[::1]:8950/p', 'headers': ["script-src * 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-pct-host',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn%2Etest 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-path-pct-rt',
    {
      'runtime': 'https://cdn.test/a%20b/lazyload.min.js',
      'headers': ["script-src https://cdn.test/a%20b/ 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-path-semicolon-url',
    {
      'runtime': 'https://cdn.test/a/b;c/lazyload.min.js',
      'headers': ["script-src https://cdn.test/a/ 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'ip-star-port',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src *:8950 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'ip-bare-star',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src * 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'ip-http-star',
    { 'page': 'http://127.0.0.1:8950/p', 'headers': ["script-src http://*:* 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'cdn-noport-8080',
    { 'runtime': 'https://cdn.test:8080{RTP}', 'headers': ["script-src cdn.test 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-80-http-explicit',
    {
      'runtime': 'http://cdn.test{RTP}',
      'headers': ["script-src http://cdn.test:80 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-https-443-explicit-url',
    {
      'runtime': 'https://cdn.test:443{RTP}',
      'headers': ["script-src https://cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'cdn-https-page-80',
    {
      'page': 'https://site.test/p',
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src cdn.test:80 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'cdn-host-query',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test?x 'unsafe-inline'"] },
    'blocked',
    'allowed'
  ],
  [
    'cdn-ws-scheme',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src ws: 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-wss-scheme',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src wss: 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-ws-host',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src ws://cdn.test 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'cdn-wss-host',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src wss://cdn.test 'unsafe-inline'"]
    },
    'blocked',
    'blocked'
  ],
  [
    'cdn-host-hash',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test#x 'unsafe-inline'"] },
    'blocked',
    'allowed'
  ],
  [
    'cdn-port-query',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src cdn.test:443?x 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'cdn-host-query-path-after',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src https://cdn.test?x/y 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'localhost-host',
    { 'page': 'http://localhost:8950/p', 'headers': ["script-src localhost:8950 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  // Fix round: non-ASCII directives, leading-zero ports, upgrade-insecure-requests.
  [
    'n-idn-header',
    {
      'headers': [
        "default-src 'none'; img-src * data:; script-src 'self' 'unsafe-inline' https://bücher.de"
      ]
    },
    'blocked',
    'blocked'
  ],
  [
    'n-idn-meta',
    {
      'meta':
        "default-src 'none'; img-src * data:; script-src 'self' 'unsafe-inline' https://bücher.de"
    },
    'blocked',
    'blocked'
  ],
  ['n-none-e-header', { 'headers': ["script-src 'none' é"] }, 'allowed', 'allowed'],
  ['n-none-e-meta', { 'meta': "script-src 'none' é" }, 'allowed', 'allowed'],
  [
    'n-smartq-header',
    { 'headers': ["script-src-elem 'self' 'unsafe-inline' ‘report-sample’; script-src 'none'"] },
    'blocked',
    'blocked'
  ],
  [
    'n-smartq-meta',
    { 'meta': "script-src-elem 'self' 'unsafe-inline' ‘report-sample’; script-src 'none'" },
    'blocked',
    'blocked'
  ],
  ['n-name-header', { 'headers': ["scrïpt-src 'none'; script-src 'none'"] }, 'blocked', 'blocked'],
  [
    'n-name-runs-header',
    { 'headers': ["scrïpt-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'n-dup-header',
    { 'headers': ["script-src 'none' é; script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  ['n-dup-meta', { 'meta': "script-src 'none' é; script-src 'none'" }, 'allowed', 'blocked'],
  ['n-nbsp-header', { 'headers': ["script-src 'none' 'self'"] }, 'allowed', 'allowed'],
  ['n-nbsp-meta', { 'meta': "script-src 'none' 'self'" }, 'allowed', 'allowed'],
  ['n-sandbox-header', { 'headers': ['sandbox é'] }, 'allowed', 'allowed'],
  ['n-img-header', { 'headers': ["img-src 'self' é"] }, 'allowed', 'allowed'],
  ['n-img-ok-header', { 'headers': ["img-src 'self'"] }, 'placeholders', 'placeholders'],
  [
    'n-other-policy-header',
    { 'headers': ["script-src 'none' é", "script-src 'none'"] },
    'blocked',
    'blocked'
  ],
  [
    'n-elem-only-e-meta',
    { 'meta': "script-src 'none'; script-src-elem 'self' 'unsafe-inline' é" },
    'blocked',
    'blocked'
  ],
  [
    'p-0443',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:0443 'unsafe-inline'"] },
    'allowed',
    'blocked'
  ],
  [
    'p-00080-http',
    { 'headers': ["script-src site.test:00080 'unsafe-inline'"] },
    'allowed',
    'blocked'
  ],
  [
    'p-08080',
    {
      'page': 'http://site.test:8080/p',
      'headers': ["script-src site.test:08080 'unsafe-inline'"]
    },
    'allowed',
    'blocked'
  ],
  [
    'p-0443-meta',
    { 'runtime': 'https://cdn.test{RTP}', 'meta': "script-src cdn.test:0443 'unsafe-inline'" },
    'allowed',
    'blocked'
  ],
  [
    'p-0443-plus-ok',
    {
      'runtime': 'https://cdn.test{RTP}',
      'headers': ["script-src cdn.test:0443 cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'p-0-star',
    { 'runtime': 'https://cdn.test{RTP}', 'headers': ["script-src cdn.test:0 'unsafe-inline'"] },
    'blocked',
    'blocked'
  ],
  [
    'u-mixed-uir',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'headers': ['upgrade-insecure-requests']
    },
    'allowed',
    'allowed'
  ],
  [
    'u-mixed-uir-meta',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'meta': 'upgrade-insecure-requests'
    },
    'allowed',
    'allowed'
  ],
  ['u-http-uir', { 'headers': ['upgrade-insecure-requests'] }, 'allowed', 'allowed'],
  ['u-http-uir-meta', { 'meta': 'upgrade-insecure-requests' }, 'allowed', 'allowed'],
  ['u-http-uir-ro', { 'reportOnly': ['upgrade-insecure-requests'] }, 'allowed', 'allowed'],
  [
    'u-http-uir-8080',
    { 'page': 'http://site.test:8080/p', 'headers': ['upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-explicit80',
    { 'runtime': 'http://site.test:80{RTP}', 'headers': ['upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-other',
    { 'runtime': 'http://cdn.test{RTP}', 'headers': ['upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-self',
    { 'headers': ["upgrade-insecure-requests; script-src 'self' 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-httpsrc',
    { 'headers': ["upgrade-insecure-requests; script-src http://site.test 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-httpsrc80',
    { 'headers': ["upgrade-insecure-requests; script-src http://site.test:80 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-nosch80',
    { 'headers': ["upgrade-insecure-requests; script-src site.test:80 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-httpsonly',
    { 'headers': ["upgrade-insecure-requests; script-src https: 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-httponly',
    { 'headers': ["upgrade-insecure-requests; script-src http: 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-8080-self',
    {
      'page': 'http://site.test:8080/p',
      'headers': ["upgrade-insecure-requests; script-src 'self' 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-8080-src',
    {
      'page': 'http://site.test:8080/p',
      'headers': ["upgrade-insecure-requests; script-src http://site.test:8080 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'u-http-uir-other-src',
    {
      'runtime': 'http://cdn.test{RTP}',
      'headers': ["upgrade-insecure-requests; script-src http://cdn.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-token',
    { 'headers': ["upgrade-insecure-requests foo; script-src https: 'unsafe-inline'"] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-2nd-policy',
    { 'headers': ["script-src 'self' 'unsafe-inline'", 'upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-meta-sep',
    { 'headers': ["script-src https: 'unsafe-inline'"], 'meta': 'upgrade-insecure-requests' },
    'allowed',
    'blocked'
  ],
  [
    'u-mixed-uir-self',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'headers': ["upgrade-insecure-requests; script-src 'self' 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'u-mixed-uir-httpsrc',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'headers': ["upgrade-insecure-requests; script-src http://site.test 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ],
  [
    'u-https-rt-ok',
    { 'page': 'https://site.test/p', 'headers': ['upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-mixed-localhost',
    { 'page': 'https://site.test/p', 'runtime': 'http://localhost{RTP}' },
    'allowed',
    'allowed'
  ],
  [
    'u-mixed-127',
    { 'page': 'https://site.test/p', 'runtime': 'http://127.0.0.1{RTP}' },
    'allowed',
    'allowed'
  ],
  [
    'u-http-uir-localhost',
    { 'runtime': 'http://localhost{RTP}', 'headers': ['upgrade-insecure-requests'] },
    'allowed',
    'allowed'
  ],
  [
    'u-https80-http80src',
    {
      'page': 'https://site.test:80/p',
      'headers': ["script-src http://site.test:80 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'u-mixed-sublocal-dot',
    { 'page': 'https://site.test/p', 'runtime': 'http://a.localhost.{RTP}' },
    'allowed',
    'allowed'
  ],
  [
    'u-https-8080-http-src',
    {
      'page': 'https://site.test:8080/p',
      'headers': ["script-src http://site.test:8080 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'u-https-nosch-8080',
    {
      'runtime': 'https://site.test:8080{RTP}',
      'headers': ["script-src site.test:8080 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'u-uir-https443-src',
    { 'headers': ["upgrade-insecure-requests; script-src https://site.test:443 'unsafe-inline'"] },
    'allowed',
    'blocked'
  ],
  [
    'u-uir-https80-src',
    { 'headers': ["upgrade-insecure-requests; script-src https://site.test:80 'unsafe-inline'"] },
    'blocked',
    'allowed'
  ],
  [
    'u-uir-2pol-https',
    { 'headers': ["script-src https: 'unsafe-inline'", 'upgrade-insecure-requests'] },
    'allowed',
    'blocked'
  ],
  [
    'u-uir-meta-hdr-https',
    { 'headers': ["script-src https: 'unsafe-inline'"], 'meta': 'upgrade-insecure-requests' },
    'allowed',
    'blocked'
  ],
  [
    'u-uir-127-https',
    {
      'runtime': 'http://127.0.0.1{RTP}',
      'headers': ["upgrade-insecure-requests; script-src https: 'unsafe-inline'"]
    },
    'blocked',
    'allowed'
  ],
  [
    'u-uir-mixed-2pol-self',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'headers': ["script-src 'self' 'unsafe-inline'", 'upgrade-insecure-requests']
    },
    'allowed',
    'blocked'
  ],
  [
    'u-uir-mixed-self',
    {
      'page': 'https://site.test/p',
      'runtime': 'http://site.test{RTP}',
      'headers': ["upgrade-insecure-requests; script-src 'self' 'unsafe-inline'"]
    },
    'allowed',
    'allowed'
  ]
];

/** `'<algorithm>-<base64>'` of a text (optionally unpadded). */
function hashSource(algorithm: 'sha256' | 'sha384', text: string, padded = true): string {
  const value = createHash(algorithm).update(text, 'utf8').digest('base64');
  return `'${algorithm}-${padded ? value : value.replace(/=+$/, '')}'`;
}

/** The served page of a receipt: its head meta, if any. */
function servedPage(setup: Setup): string {
  const meta =
    setup.meta === undefined
      ? ''
      : `<meta http-equiv="Content-Security-Policy" content="${setup.meta}">`;
  return `<!doctype html><html><head><meta charset="utf-8">${meta}<title>t</title></head><body><p>x</p></body></html>`;
}

/**
 * The policy inputs as each engine's backend receives them (Firefox joins
 * repeated header lines with `, `).
 */
function cspInput(
  setup: Setup,
  browser: SimulationCspBrowser,
  replace: (value: string) => string
): SimulationCspInput | undefined {
  const lines = (name: string, values: readonly string[] | undefined) =>
    values === undefined || values.length === 0
      ? []
      : browser === 'firefox'
        ? [{ name, value: values.map(replace).join(', ') }]
        : values.map((value) => ({ name, value: replace(value) }));
  const headers = [
    ...lines('Content-Security-Policy', setup.headers),
    ...lines('Content-Security-Policy-Report-Only', setup.reportOnly)
  ];
  const { metas } = cspMetaPolicies(servedPage(setup));
  return headers.length === 0 && metas.length === 0 ? undefined : { browser, headers, metas };
}

/** The verdict a receipt's outcome names (every receipt page has placeholders). */
function verdictOf(outcome: Outcome): SimulationCspVerdict {
  if (outcome === 'blocked') return { blocked: true };
  return { blocked: false, limits: outcome === 'placeholders' ? ['placeholders'] : [] };
}

describe.each(SUPPORTED_WPR_VERSIONS.map((pin) => [pin.version] as const))(
  'evaluateLazyloadCsp — browser receipts, WP Rocket %s',
  (version) => {
    const entry = DATA.versions[version]?.lazyload;
    const optionsScript = entry === undefined ? undefined : DATA.texts[entry.optionsScript.sha256];
    if (optionsScript === undefined) throw new Error(`no LazyLoad options for ${version}`);
    const text = inlineScriptText(optionsScript);
    const tokens: Readonly<Record<string, string>> = {
      H256U: hashSource('sha256', text, false),
      H256: hashSource('sha256', text),
      H384: hashSource('sha384', text)
    };
    const replace = (value: string) =>
      value.replace(/H256U|H256|H384/g, (key) => tokens[key] ?? key);

    it.each(
      RECEIPTS.flatMap(([name, setup, chromium, firefox]) => [
        [name, 'chromium', setup, chromium] as const,
        [name, 'firefox', setup, firefox] as const
      ])
    )('%s (%s)', (_name, browser, setup, outcome) => {
      const page = setup.page ?? PAGE;
      const runtimeUrl = (setup.runtime ?? `${new URL(page).origin}{RTP}`).replace('{RTP}', RTP);
      const verdict = evaluateLazyloadCsp({
        csp: cspInput(setup, browser, replace),
        pageUrl: page,
        runtimeUrl,
        optionsScript,
        placeholders: true
      });
      expect(verdict).toEqual(verdictOf(outcome));
    });
  }
);
