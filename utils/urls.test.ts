import { describe, expect, it } from 'vitest';
import {
  NEW_TAB_FEATURES,
  PLACEHOLDER_BASE_URL,
  isHttpOrigin,
  isHttpUrl,
  parseHttpUrl,
  parseUrl,
  resolveHttpUrl
} from './urls';

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

describe('parseHttpUrl', () => {
  it('returns the parsed URL for http and https (scheme case does not matter)', () => {
    expect(parseHttpUrl('http://example.com/a?b=1#f')).toEqual(
      new URL('http://example.com/a?b=1#f')
    );
    expect(parseHttpUrl('HTTPS://example.com/path')?.href).toBe('https://example.com/path');
  });

  it('returns null for non-HTTP(S) schemes and anything that is not an absolute URL', () => {
    for (const raw of [
      'javascript:alert(1)',
      'data:text/html,<h1>x</h1>',
      'chrome://settings',
      'file:///tmp/page.html',
      'ftp://example.com',
      '/relative?a=1',
      'not a url',
      ''
    ]) {
      expect(parseHttpUrl(raw), raw).toBeNull();
    }
  });
});

describe('resolveHttpUrl', () => {
  const BASE = 'https://a.test/shop/page/?x=1';
  it('resolves relative, root-relative and protocol-relative URLs against the base', () => {
    expect(resolveHttpUrl('js/a.js?ver=1', BASE)).toBe('https://a.test/shop/page/js/a.js?ver=1');
    expect(resolveHttpUrl('/wp-content/a.js', BASE)).toBe('https://a.test/wp-content/a.js');
    expect(resolveHttpUrl('//cdn.test/a.js', BASE)).toBe('https://cdn.test/a.js');
    expect(resolveHttpUrl('http://b.test/a.js', BASE)).toBe('http://b.test/a.js');
  });

  it('refuses other schemes, an unusable base and unparsable input', () => {
    expect(resolveHttpUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(resolveHttpUrl('data:text/javascript,1', BASE)).toBeNull();
    expect(resolveHttpUrl('a.js', null)).toBeNull();
    expect(resolveHttpUrl('a.js', 'about:blank')).toBeNull();
    expect(resolveHttpUrl('a.js', 'not a url')).toBeNull();
    expect(resolveHttpUrl('http://[bad', BASE)).toBeNull();
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

describe('isHttpOrigin', () => {
  it('accepts canonical http(s) origins, ports included', () => {
    expect(isHttpOrigin('https://example.com')).toBe(true);
    expect(isHttpOrigin('http://127.0.0.1:8493')).toBe(true);
    expect(isHttpOrigin('https://xn--bcher-kva.example')).toBe(true);
  });

  it('rejects anything that is not its own canonical origin', () => {
    for (const raw of [
      '',
      'example.com',
      'https://example.com/',
      'https://example.com/path',
      'https://example.com?q=1',
      'HTTPS://example.com',
      'https://Example.com',
      'https://example.com:443',
      ' https://example.com',
      'https://user@example.com',
      'file:///etc/hosts',
      'chrome-extension://abc',
      'null'
    ]) {
      expect(isHttpOrigin(raw), raw).toBe(false);
    }
  });
});

describe('PLACEHOLDER_BASE_URL', () => {
  it('is an https URL on a reserved host, keeping a protocol-relative URL’s own host and path', () => {
    expect(parseHttpUrl(PLACEHOLDER_BASE_URL)?.hostname).toBe('document.invalid');
    expect(new URL('/a/b.js', PLACEHOLDER_BASE_URL).href).toBe('https://document.invalid/a/b.js');
    expect(new URL('//cdn.test/a.js', PLACEHOLDER_BASE_URL).href).toBe('https://cdn.test/a.js');
  });
});

describe('NEW_TAB_FEATURES', () => {
  it('cuts both the opener handle and the referrer', () => {
    expect(NEW_TAB_FEATURES.split(',').sort()).toEqual(['noopener', 'noreferrer']);
  });
});
