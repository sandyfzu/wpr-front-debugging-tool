/**
 * Source-list URL matching, rule by rule (the browser receipts for each
 * rule are rows of `lazyload-csp.receipts.test.ts`).
 */
import { describe, expect, it } from 'vitest';
import { pathPartMatches, schemePartMatches, sourceListAllowsUrl } from './csp-source-match';
import type { SimulationCspBrowser } from './spec';

/** Whether `list` admits `url` from a document at `self`. */
function allows(
  list: string,
  url: string,
  self = 'http://site.test/p',
  browser: SimulationCspBrowser = 'chromium',
  upgradeAsHttps = false
): boolean {
  const tokens = list.split(' ').filter((token) => token !== '');
  return sourceListAllowsUrl(tokens, new URL(url), new URL(self), browser, upgradeAsHttps);
}

const RT = 'https://cdn.test/wp/js/lazyload.min.js';

describe('schemePartMatches', () => {
  it.each([
    ['http', 'http', true],
    ['HTTP', 'https', true],
    ['https', 'http', false],
    ['ws', 'https', false],
    ['wss', 'https', false],
    ['ftp', 'https', false]
  ] as const)('%s admits %s: %s', (source, url, expected) => {
    expect(schemePartMatches(source, url)).toBe(expected);
  });

  it('admits an http URL by https only when upgraded as https', () => {
    expect(schemePartMatches('HTTPS', 'http', true)).toBe(true);
    expect(schemePartMatches('wss', 'http', true)).toBe(false);
    expect(schemePartMatches('ws', 'http', true)).toBe(false);
  });
});

describe('pathPartMatches', () => {
  it.each([
    ['/', '', true],
    ['/', '/a/b', true],
    ['/a/', '/a/b/c.js', true],
    ['/a', '/a/b', false],
    ['/a/b/c.js', '/a/b/c.js', true],
    ['/a/b/c.js/', '/a/b/c.js', false],
    ['/A/', '/a/b', false],
    ['/a%2D/', '/a-/b', true],
    ['/a%zz/', '/a%zz/b', true],
    ['/a/b/c/', '/a/b', false]
  ] as const)('%s admits %s: %s', (source, path, expected) => {
    expect(pathPartMatches(source, path)).toBe(expected);
  });
});

describe('sourceListAllowsUrl', () => {
  it('matches nothing from an empty list, `none` or keywords alone', () => {
    expect(allows('', RT)).toBe(false);
    expect(allows("'none'", RT)).toBe(false);
    expect(allows("'unsafe-inline' 'strict-dynamic' 'nonce-a' 'sha256-AAAA'", RT)).toBe(false);
  });

  it('reads `*` as any http(s) URL, or one of the document’s scheme', () => {
    expect(allows('*', RT)).toBe(true);
    expect(allows('*', 'ftp://cdn.test/x.js')).toBe(false);
    expect(allows('*', 'ftp://cdn.test/x.js', 'ftp://site.test/p')).toBe(true);
  });

  it('reads `self` with its secure upgrades', () => {
    expect(allows("'SELF'", 'http://site.test/x.js')).toBe(true);
    expect(allows("'self'", 'https://site.test/x.js')).toBe(true);
    expect(allows("'self'", 'http://site.test/x.js', 'https://site.test/p')).toBe(false);
    expect(allows("'self'", 'https://site.test/x.js', 'http://site.test:8080/p')).toBe(false);
    expect(allows("'self'", 'https://site.test:8080/x.js', 'http://site.test:8080/p')).toBe(true);
    expect(allows("'self'", RT)).toBe(false);
  });

  it('reads scheme sources', () => {
    expect(allows('https:', RT)).toBe(true);
    expect(allows('HTTP:', RT)).toBe(true);
    expect(allows('https:', 'http://cdn.test/x.js')).toBe(false);
  });

  it('matches hosts exactly (caseless), `*` any, `*.suffix` a domain under it', () => {
    expect(allows('CDN.test', RT)).toBe(true);
    expect(allows('cdn.test.', RT)).toBe(false);
    expect(allows('*.test', RT)).toBe(true);
    expect(allows('*.cdn.test', RT)).toBe(false);
    expect(allows('*.cdn.test', 'https://a.b.cdn.test/x.js')).toBe(true);
    expect(allows('https://*', RT)).toBe(true);
    expect(allows('cdn.*.test', RT)).toBe(false);
  });

  it('matches IPv4 hosts exactly, never by a wildcard suffix; IPv6 sources are invalid', () => {
    expect(allows('127.0.0.1:8950', 'http://127.0.0.1:8950/x.js')).toBe(true);
    expect(allows('*.0.0.1:8950', 'http://127.0.0.1:8950/x.js')).toBe(false);
    expect(allows('*:8950', 'http://127.0.0.1:8950/x.js')).toBe(true);
    expect(allows('[::1]:8950', 'http://[::1]:8950/x.js')).toBe(false);
    expect(allows('*', 'http://[::1]:8950/x.js')).toBe(true);
  });

  it('refuses invalid hosts and ports', () => {
    expect(allows('cdn_x.test', 'https://cdn_x.test/x.js')).toBe(false);
    expect(allows('cdn%2Etest', RT)).toBe(false);
    expect(allows('https://cdn.test:', RT)).toBe(false);
  });

  it('drops a query or fragment after the host on Firefox only (Chromium drops the source)', () => {
    for (const source of ['cdn.test?x', 'cdn.test#x', 'cdn.test:443?x', 'https://cdn.test?x/y']) {
      expect(allows(source, RT, undefined, 'chromium')).toBe(false);
      expect(allows(source, RT, undefined, 'firefox')).toBe(true);
    }
  });

  it('never matches an http(s) URL by a WebSocket scheme', () => {
    for (const source of ['ws:', 'wss:', 'ws://cdn.test', 'wss://cdn.test']) {
      expect(allows(source, RT)).toBe(false);
    }
  });

  it('takes a schemeless host source’s scheme from the document', () => {
    expect(allows('cdn.test', RT)).toBe(true);
    expect(allows('cdn.test', 'http://cdn.test/x.js', 'https://site.test/p')).toBe(false);
    expect(allows('cdn.test', 'ftp://cdn.test/x.js')).toBe(false);
  });

  it('matches ports: none = the default, `*` any, a number the effective port', () => {
    expect(allows('cdn.test', 'https://cdn.test:8080/x.js')).toBe(false);
    expect(allows('cdn.test:*', 'https://cdn.test:8080/x.js')).toBe(true);
    expect(allows('cdn.test:443', RT)).toBe(true);
    expect(allows('cdn.test:8080', RT)).toBe(false);
    expect(allows('https://cdn.test', 'https://cdn.test:443/x.js')).toBe(true);
    expect(allows('cdn.test:443', 'http://cdn.test/x.js')).toBe(false);
  });

  it('upgrades port 80 to the https default: Chromium with the scheme upgrade, Firefox always', () => {
    for (const browser of ['chromium', 'firefox'] as const) {
      expect(allows('http://cdn.test:80', RT, undefined, browser)).toBe(true);
      expect(allows('cdn.test:80', RT, undefined, browser)).toBe(true);
      expect(allows('http://cdn.test:80', 'https://cdn.test:8080/x.js', undefined, browser)).toBe(
        false
      );
    }
    expect(allows('https://cdn.test:80', RT, undefined, 'chromium')).toBe(false);
    expect(allows('https://cdn.test:80', RT, undefined, 'firefox')).toBe(true);
    expect(allows('cdn.test:80', RT, 'https://site.test/p', 'chromium')).toBe(false);
    expect(allows('cdn.test:80', RT, 'https://site.test/p', 'firefox')).toBe(true);
  });

  it('Chromium: with the scheme upgraded, only 80 or 443 admit the https default port', () => {
    const at8080 = 'https://site.test:8080/x.js';
    expect(allows('http://site.test:8080', at8080)).toBe(false);
    expect(allows('site.test:8080', at8080)).toBe(false);
    expect(allows('http://site.test:*', at8080)).toBe(true);
    expect(allows("'self'", at8080, 'http://site.test:8080/p')).toBe(true);
    expect(allows('http://site.test:443', 'https://site.test/x.js')).toBe(true);
    expect(allows('http://site.test:443', 'https://site.test:8443/x.js')).toBe(false);
    expect(allows('http://site.test:80', 'https://site.test:80/x.js')).toBe(false);
    expect(allows('https://site.test:8080', at8080)).toBe(true);
    expect(allows('site.test:8080', at8080, 'https://site.test/p')).toBe(true);
  });

  it('Firefox: an equal port admits the upgraded scheme', () => {
    const at8080 = 'https://site.test:8080/x.js';
    expect(allows('http://site.test:8080', at8080, undefined, 'firefox')).toBe(true);
    expect(allows('site.test:8080', at8080, undefined, 'firefox')).toBe(true);
    expect(allows('http://site.test:80', 'https://site.test:80/x.js', undefined, 'firefox')).toBe(
      true
    );
  });

  it('reads a leading-zero port as its number on Chromium, never matching on Firefox', () => {
    expect(allows('cdn.test:0443', RT)).toBe(true);
    expect(allows('site.test:00080', 'http://site.test/x.js')).toBe(true);
    expect(allows('site.test:08080', 'http://site.test:8080/x.js')).toBe(true);
    expect(allows('cdn.test:0443', RT, undefined, 'firefox')).toBe(false);
    expect(allows('site.test:00080', 'http://site.test/x.js', undefined, 'firefox')).toBe(false);
    expect(allows('site.test:08080', 'http://site.test:8080/x.js', undefined, 'firefox')).toBe(
      false
    );
    expect(allows('cdn.test:0443 cdn.test', RT, undefined, 'firefox')).toBe(true);
    expect(allows('cdn.test:0', RT, undefined, 'firefox')).toBe(false);
  });

  it('Firefox under upgrade-insecure-requests: an http URL matches as https, its port kept', () => {
    const http = 'http://site.test/x.js';
    const ff = (list: string, url = http, self = 'http://site.test/p') =>
      allows(list, url, self, 'firefox', true);
    expect(ff('https:')).toBe(true);
    expect(ff('https://site.test')).toBe(true);
    expect(ff('https://site.test:80')).toBe(true);
    expect(ff('https://site.test:443')).toBe(false);
    expect(ff('https://site.test:8080', 'http://site.test:8080/x.js')).toBe(true);
    expect(ff('wss://site.test')).toBe(false);
    expect(ff('wss:')).toBe(false);
    expect(ff("'self'", http, 'https://site.test/p')).toBe(true);
    expect(ff("'self'", 'http://site.test:8080/x.js', 'https://site.test/p')).toBe(false);
    expect(ff('https:', 'http://127.0.0.1/x.js')).toBe(true);
    expect(allows('https:', http, undefined, 'firefox')).toBe(false);
    expect(allows("'self'", http, 'https://site.test/p', 'firefox')).toBe(false);
  });

  it('matches paths, dropping a query or fragment after one', () => {
    expect(allows('https://cdn.test/wp/', RT)).toBe(true);
    expect(allows('https://cdn.test/wp', RT)).toBe(false);
    expect(allows('https://cdn.test/wp/?x', RT)).toBe(true);
    expect(allows('https://cdn.test/wp/#x', RT)).toBe(true);
    expect(allows('https://cdn.test/WP/', RT)).toBe(false);
    expect(allows('https://cdn.test/', RT)).toBe(true);
    expect(allows('https://cdn.test/a%20b/', 'https://cdn.test/a%20b/x.js')).toBe(true);
  });

  it('matches when any source does, `none` beside others ignored', () => {
    expect(allows("'none' https://cdn.test", RT)).toBe(true);
    expect(allows("'self' other.test https:", RT)).toBe(true);
  });
});
