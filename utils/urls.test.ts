import { describe, expect, it } from 'vitest';
import { isHttpUrl, parseUrl } from './urls';

describe('parseUrl', () => {
  it('parses absolute URLs', () => {
    expect(parseUrl('https://example.com/a?b=1#f')).toEqual(new URL('https://example.com/a?b=1#f'));
  });

  it('returns null for anything that is not an absolute URL', () => {
    expect(parseUrl('')).toBeNull();
    expect(parseUrl('example.com')).toBeNull();
    expect(parseUrl('://missing-scheme')).toBeNull();
    expect(parseUrl('https://')).toBeNull();
    expect(parseUrl('1https://example.com')).toBeNull();
  });

  it('ignores leading/trailing whitespace (WHATWG rules)', () => {
    expect(parseUrl('  https://example.com  ')?.pathname).toBe('/');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https (scheme case does not matter)', () => {
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('HTTPS://example.com/path?q=1')).toBe(true);
  });

  it('rejects every non-HTTP(S) scheme, including browser-internal and script ones', () => {
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'chrome://settings',
      'chrome-extension://abcdef/background.js',
      'ftp://example.com',
      'example.com',
      'not a url',
      ''
    ]) {
      expect(isHttpUrl(raw), raw).toBe(false);
    }
  });
});
