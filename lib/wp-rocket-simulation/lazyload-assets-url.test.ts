import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import {
  assetReferences,
  assetUrl,
  beaconAssetsUrl,
  exactAssetUrl,
  lazyloadAssetsUrl,
  siteAssetEvidence
} from './lazyload-assets-url';

const PAGE = 'https://example.org/blog/post/?p=1';

/**
 * WP Rocket's beacon block loading `src`, as its buffer writes it.
 *
 * @param src The tag's URL (raw attribute text).
 */
const beacon = (src: string): string =>
  `<script>var rocket_beacon_data = {}</script><script data-name="wpr-wpr-beacon" src='${src}' async></script>`;

/**
 * A page ending with `body`, then the last `</body>`.
 *
 * @param body The body's content.
 */
const page = (body: string): string => `<html><head></head><body>${body}</body></html>`;

/**
 * An asset tag of each fetching kind.
 *
 * @param url The URL.
 */
const script = (url: string): string => `<script src="${url}"></script>`;
const stylesheet = (url: string): string => `<link rel='stylesheet' href='${url}' />`;

describe('lazyloadAssetsUrl', () => {
  it.each<[string, string, string, string]>([
    [
      'the beacon tag (exact: any host, folder names)',
      page(
        `${stylesheet('https://example.org/wp-content/plugins/a/a.css')}${beacon('https://cdn.example.net/app/addons/wpr/assets/js/wpr-beacon.min.js')}`
      ),
      'https://cdn.example.net/app/addons/wpr/assets/',
      'beacon'
    ],
    [
      'an unminified beacon',
      page(beacon('http://example.org/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.js')),
      'http://example.org/wp-content/plugins/wp-rocket/assets/',
      'beacon'
    ],
    [
      'a plugin asset on the origin (over an earlier theme asset)',
      stylesheet('https://example.org/wp-content/themes/t/s.css') +
        script('https://example.org/app/wp-content/plugins/woo/a.js?ver=1'),
      'https://example.org/app/wp-content/plugins/wp-rocket/assets/',
      'plugin-asset'
    ],
    [
      'a theme asset on the origin',
      "<style>@font-face{src:url('https://example.org/wp-content/themes/t/f.woff2')}</style>",
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'theme-asset'
    ],
    [
      'a renamed content folder proven by a plugin and a theme asset',
      script('https://example.org/app/ext/plugins/woo/a.js') +
        `<img src="https://example.org/app/ext/themes/t/i.png">`,
      'https://example.org/app/ext/plugins/wp-rocket/assets/',
      'plugin-asset'
    ],
    [
      'no evidence: WordPress defaults on the page origin',
      '<img src="/wp-content/plugins/a/x.png"><img src="https://other.org/wp-content/plugins/a/x.png">',
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'default'
    ]
  ])('%s', (_name, html, url, source) => {
    expect(lazyloadAssetsUrl(html, PAGE)).toEqual({ url, source });
  });

  // URLs that are not asset references (or not under a content folder) fall through to the next source.
  it.each<[string, string, string, string]>([
    [
      'a canonical link naming a plugins path',
      `<link rel="canonical" href="https://example.org/category/plugins/seo/" />${stylesheet('https://example.org/wp-content/themes/tt/style.css')}`,
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'theme-asset'
    ],
    [
      'an og:url naming a plugins path',
      '<meta property="og:url" content="https://example.org/docs/plugins/x/y" />',
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'default'
    ],
    [
      'an anchor naming a themes path',
      '<a href="https://example.org/blog/themes/best/x">x</a>',
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'default'
    ],
    [
      'a plugins URL in page text, before a real plugin asset',
      `<p>see https://example.org/docs/plugins/wp-rocket/ for details</p>${script('https://example.org/site/wp-content/plugins/x/y.js')}`,
      'https://example.org/site/wp-content/plugins/wp-rocket/assets/',
      'plugin-asset'
    ],
    [
      'an unproven non-default folder',
      script('https://example.org//evil.org/plugins/x/y.js'),
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'default'
    ],
    [
      'a beacon lookalike in a comment after the real block',
      page(beacon('https://example.org/wp-content/plugins/wp-rocket/assets/js/wpr-beacon.min.js')) +
        `<!--${beacon('https://evil.org/js/wpr-beacon.js')}-->`,
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'beacon'
    ],
    [
      'a beacon tag not abutting the last </body>',
      `${beacon('https://evil.org/js/wpr-beacon.js')}</body><p></p></body>`,
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'default'
    ],
    [
      'an inexact beacon URL',
      page(beacon('https://example.org@evil.org/js/wpr-beacon.js')) +
        script('https://example.org/wp-content/plugins/x/y.js'),
      'https://example.org/wp-content/plugins/wp-rocket/assets/',
      'plugin-asset'
    ]
  ])('falls through: %s', (_name, html, url, source) => {
    expect(lazyloadAssetsUrl(html, PAGE)).toEqual({ url, source });
  });

  it('keeps a non-default port in the origin', () => {
    expect(lazyloadAssetsUrl('', 'http://127.0.0.1:8493/')).toEqual({
      url: 'http://127.0.0.1:8493/wp-content/plugins/wp-rocket/assets/',
      source: 'default'
    });
  });

  it.each(['about:blank', 'file:///x.html', 'example.org/', '', 'javascript:alert(1)'])(
    'throws on a page URL that is not http(s): %j',
    (pageUrl) => {
      expect(() => lazyloadAssetsUrl('', pageUrl)).toThrow('not an http(s) page URL');
    }
  );
});

describe('beaconAssetsUrl', () => {
  it.each<[string, string, string | null]>([
    [
      'the block abutting the last </body>',
      `${beacon('https://a.org/1/assets/js/wpr-beacon.min.js')}</body>${beacon('https://a.org/2/assets/js/wpr-beacon.min.js')}</body>`,
      'https://a.org/2/assets/'
    ],
    [
      'decoded entities',
      page(beacon('https://a.org/a&amp;b/assets/js/wpr-beacon.min.js')),
      'https://a.org/a&b/assets/'
    ],
    [
      'the normalized form (host case, default port, non-ASCII path)',
      page(beacon('https://A.ORG:443/é/assets/js/wpr-beacon.js')),
      'https://a.org/%C3%A9/assets/'
    ],
    ['a root assets URL', page(beacon('https://a.org/js/wpr-beacon.js')), 'https://a.org/'],
    ['an undecodable entity', page(beacon('https://a.org/&bogus;/js/wpr-beacon.js')), null],
    ['another file', page(beacon('https://a.org/assets/js/other.min.js')), null],
    ['no js folder', page(beacon('https://a.org/assets/wpr-beacon.min.js')), null],
    ['a relative URL', page(beacon('/assets/js/wpr-beacon.min.js')), null],
    ['userinfo', page(beacon('https://a.org@evil.org/js/wpr-beacon.min.js')), null],
    ['a backslash', page(beacon('https://evil.org\\@a.org/js/wpr-beacon.min.js')), null],
    ['a query', page(beacon('https://a.org/?u=/js/wpr-beacon.min.js')), null],
    ['a fragment', page(beacon('https://a.org/#/js/wpr-beacon.min.js')), null],
    ['dot segments', page(beacon('https://a.org/x/../../js/wpr-beacon.min.js')), null],
    ['an encoded dot segment', page(beacon('https://a.org/x/%2E%2e/js/wpr-beacon.min.js')), null],
    ['an encoded query', page(beacon('https://a.org/&#63;u=/js/wpr-beacon.min.js')), null],
    ['another scheme', page(beacon('ftp://a.org/js/wpr-beacon.min.js')), null],
    ['no block', page(''), null]
  ])('%s', (_name, html, expected) => {
    expect(beaconAssetsUrl(html)).toBe(expected);
  });
});

describe('exactAssetUrl', () => {
  it.each<[string, string | null]>([
    ['https://a.org/x/y.js', 'https://a.org/x/y.js'],
    ['http://a.org:8080/a..b/.x/y.js', 'http://a.org:8080/a..b/.x/y.js'],
    ['https://a.org/./y.js', null],
    ['https://a.org/x y.js', null],
    ['https://a.org/x\ty.js', null],
    ['https://:p@a.org/y.js', null],
    ['data:text/js,x', null],
    ['not a url', null]
  ])('%j', (text, expected) => {
    expect(exactAssetUrl(text)?.href ?? null).toBe(expected);
  });
});

describe('assetUrl', () => {
  it.each<[string, string | null]>([
    ['https://a.org/x/y.js?ver=1#f', 'https://a.org/x/y.js?ver=1#f'],
    ['https://a.org/x/y.js?u=../a b\\c', 'https://a.org/x/y.js?u=../a%20b\\c'],
    ['https://a.org/x/../y.js?ver=1', null],
    ['https://a.org/x\\y.js', null],
    ['https://u@a.org/y.js', null],
    ['', null]
  ])('%j', (text, expected) => {
    expect(assetUrl(text)?.href ?? null).toBe(expected);
  });

  it('rejects a query or fragment only when exact', () => {
    expect(exactAssetUrl('https://a.org/y.js?ver=1')).toBeNull();
    expect(exactAssetUrl('https://a.org/y.js#f')).toBeNull();
  });
});

describe('assetReferences', () => {
  it('reads fetched asset URLs only, in document order', () => {
    const html = [
      '<script src="https://a.org/s.js?a=1&amp;b=2"></script>',
      '<a href="https://a.org/x">x</a>',
      '<link rel="canonical" href="https://a.org/c">',
      '<link rel="Preload  stylesheet" href="https://a.org/p.css">',
      '<link rel="modulepreload" href="https://a.org/m.js">',
      '<link rel="icon" href="https://a.org/i.ico">',
      '<link href="https://a.org/no-rel.css">',
      '<img src="https://a.org/i.png">',
      '<img src="https://a.org/&bogus;.png">',
      '<script>var u = "https://a.org/in-script.js";</script>',
      `<style>a{background:url( "https://a.org/b.png" )} b{background:url(https://a.org/c.png)}</style>`,
      '<!-- <script src="https://a.org/commented.js"></script> -->',
      '<div style="background:url(https://a.org/inline.png)"></div>'
    ].join('');
    expect(assetReferences(html)).toEqual([
      'https://a.org/s.js?a=1&b=2',
      'https://a.org/p.css',
      'https://a.org/m.js',
      'https://a.org/i.png',
      'https://a.org/b.png',
      'https://a.org/c.png'
    ]);
  });
});

describe('siteAssetEvidence', () => {
  const ORIGIN = 'https://example.org';

  it.each<[string, string, string | null, string | null]>([
    ['nothing', '<p>text</p>', null, null],
    [
      'the first plugins segment of a path',
      script('https://example.org/wp-content/plugins/x/plugins/y/z.js'),
      'https://example.org/wp-content/plugins/',
      null
    ],
    [
      'a plugins folder without a file under it',
      script('https://example.org/wp-content/plugins/x'),
      null,
      null
    ],
    ['an empty folder name', script('https://example.org/wp-content/plugins//x.js'), null, null],
    [
      'a dot segment before the plugins folder',
      script('https://example.org/x/../wp-content/plugins/p/a.js'),
      null,
      null
    ],
    ['mu-plugins', script('https://example.org/wp-content/mu-plugins/x/y.js'), null, null],
    ['a query naming a plugins path', script('https://example.org/?u=/plugins/x/y.js'), null, null],
    [
      'another host sharing the prefix',
      script('https://example.org.evil/wp-content/plugins/x/a.js'),
      null,
      null
    ],
    [
      'another origin (port)',
      script('https://example.org:8443/wp-content/plugins/x/a.js'),
      null,
      null
    ],
    [
      'a non-default folder alone',
      script('https://example.org/c/plugins/p/a.js') +
        script('https://example.org/d/themes/u/s.css'),
      null,
      null
    ],
    [
      'the first accepted theme, then a plugin',
      `${stylesheet('https://example.org/x/themes/t/s.css')}${stylesheet('https://example.org/wp-content/themes/u/s.css')}${script('https://example.org/wp-content/plugins/p/a.js')}`,
      'https://example.org/wp-content/plugins/',
      'https://example.org/wp-content/'
    ]
  ])('%s', (_name, html, plugins, content) => {
    expect(siteAssetEvidence(html, ORIGIN)).toEqual({ plugins, content });
  });
});

/**
 * `unit` repeated to `bytes`.
 *
 * @param unit The repeated text.
 * @param bytes The target length.
 */
const fill = (unit: string, bytes: number): string => unit.repeat(Math.ceil(bytes / unit.length));

describe('lazyloadAssetsUrl on hostile pages', () => {
  it.each<[string, (bytes: number) => string]>([
    [
      'asset tags everywhere',
      (bytes) => fill(script('https://example.org/x/plugins/p/a.js'), bytes)
    ],
    ['one endless asset path', (bytes) => script(`https://example.org/${fill('plugins/', bytes)}`)],
    ['unclosed CSS urls', (bytes) => `<style>${fill('url(url(', bytes)}`],
    ['body ends after beacon tags', (bytes) => fill(`' async></script></body>`, bytes)],
    [
      'beacon blocks everywhere',
      (bytes) => fill(`${beacon('https://e.org/js/wpr-beacon.js')}</body>`, bytes)
    ]
  ])(
    '%s',
    (_name, build) => {
      expect(
        linearScaling(build, (html) => lazyloadAssetsUrl(html, PAGE)).violation
      ).toBeUndefined();
    },
    LINEAR_SCALING_TIMEOUT_MS
  );
});
