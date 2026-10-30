/**
 * The requested script URL: every row is a browser receipt (the URL the
 * page requested, or none for mixed content), observed alike on Chromium
 * 156 and Firefox 155 — except the IPv4-mapped loopback row (see below).
 */
import { describe, expect, it } from 'vitest';
import { httpsTwin, isPotentiallyTrustworthyHost, scriptRequestUrl } from './script-request';

const R = '/wp/lazyload.min.js';

/** The requested URL (serialized) or the refusal. */
function requested(url: string, page: string, upgradeInsecure: boolean): string {
  const result = scriptRequestUrl(new URL(url), new URL(page), upgradeInsecure);
  return result instanceof URL ? result.href : result;
}

describe('isPotentiallyTrustworthyHost', () => {
  it.each([
    ['localhost', true],
    ['localhost.', true],
    ['a.localhost', true],
    ['a.localhost.', true],
    ['127.0.0.1', true],
    ['127.1.2.3', true],
    ['[::1]', true],
    ['site.test', false],
    ['notlocalhost', false],
    ['localhost.site.test', false],
    ['128.0.0.1', false],
    ['[::ffff:7f00:1]', false]
  ] as const)('%s: %s', (host, expected) => {
    expect(isPotentiallyTrustworthyHost(host)).toBe(expected);
  });
});

describe('httpsTwin', () => {
  it('switches the scheme; port 80 becomes the https default, any other is kept', () => {
    expect(httpsTwin(new URL(`http://site.test${R}?a#b`)).href).toBe(`https://site.test${R}?a#b`);
    expect(httpsTwin(new URL(`http://site.test:80${R}`)).href).toBe(`https://site.test${R}`);
    expect(httpsTwin(new URL(`http://site.test:443${R}`)).href).toBe(`https://site.test${R}`);
    expect(httpsTwin(new URL(`http://site.test:8080${R}`)).href).toBe(`https://site.test:8080${R}`);
  });

  it('returns a new URL', () => {
    const url = new URL(`http://site.test${R}`);
    httpsTwin(url);
    expect(url.protocol).toBe('http:');
  });
});

describe('scriptRequestUrl — browser receipts', () => {
  it.each([
    // [name, script URL, page URL, upgrade-insecure-requests, requested]
    [
      'http page, no upgrade',
      `http://site.test${R}`,
      'http://site.test/p',
      false,
      `http://site.test${R}`
    ],
    [
      'upgrade, same host',
      `http://site.test${R}`,
      'http://site.test/p',
      true,
      `https://site.test${R}`
    ],
    [
      'upgrade keeps 8080',
      `http://site.test:8080${R}`,
      'http://site.test:8080/p',
      true,
      `https://site.test:8080${R}`
    ],
    [
      'upgrade, explicit 80',
      `http://site.test:80${R}`,
      'http://site.test/p',
      true,
      `https://site.test${R}`
    ],
    [
      'upgrade, other host',
      `http://cdn.test:8443${R}`,
      'http://site.test/p',
      true,
      `https://cdn.test:8443${R}`
    ],
    [
      'upgrade skips localhost',
      `http://localhost${R}`,
      'http://site.test/p',
      true,
      `http://localhost${R}`
    ],
    [
      'upgrade skips a.localhost',
      `http://a.localhost${R}`,
      'http://site.test/p',
      true,
      `http://a.localhost${R}`
    ],
    [
      'upgrade skips 127.1.2.3',
      `http://127.1.2.3${R}`,
      'http://site.test/p',
      true,
      `http://127.1.2.3${R}`
    ],
    ['upgrade skips [::1]', `http://[::1]${R}`, 'http://site.test/p', true, `http://[::1]${R}`],
    [
      'https page, upgrade',
      `http://site.test${R}`,
      'https://site.test/p',
      true,
      `https://site.test${R}`
    ],
    ['mixed content', `http://site.test${R}`, 'https://site.test/p', false, 'mixed-content'],
    [
      'mixed content, other host',
      `http://cdn.test${R}`,
      'https://site.test/p',
      false,
      'mixed-content'
    ],
    [
      'https page, localhost',
      `http://localhost${R}`,
      'https://site.test/p',
      false,
      `http://localhost${R}`
    ],
    [
      'https page, localhost.',
      `http://localhost.${R}`,
      'https://site.test/p',
      false,
      `http://localhost.${R}`
    ],
    [
      'https page, a.localhost.',
      `http://a.localhost.${R}`,
      'https://site.test/p',
      false,
      `http://a.localhost.${R}`
    ],
    [
      'https page, 127.0.0.1',
      `http://127.0.0.1${R}`,
      'https://site.test/p',
      false,
      `http://127.0.0.1${R}`
    ],
    ['https page, [::1]', `http://[::1]${R}`, 'https://site.test/p', false, `http://[::1]${R}`],
    [
      'http localhost page',
      `http://site.test${R}`,
      'http://localhost/p',
      false,
      `http://site.test${R}`
    ],
    ['https script', `https://site.test${R}`, 'https://site.test/p', true, `https://site.test${R}`]
  ] as const)('%s', (_name, url, page, upgrade, expected) => {
    expect(requested(url, page, upgrade)).toBe(expected);
  });

  it('refuses an IPv4-mapped loopback from an https page (Firefox blocks it; Chromium loads it)', () => {
    expect(requested(`http://[::ffff:127.0.0.1]${R}`, 'https://site.test/p', false)).toBe(
      'mixed-content'
    );
  });
});
