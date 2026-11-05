/** The service address and request builders: exact query shape, guards, body. */
import { describe, expect, it } from 'vitest';
import {
  RUCSS_ENDPOINT,
  buildRucssEndpointUrl,
  buildRucssRequestInit,
  toUnixSeconds
} from './endpoint';

/** A plain query, overridden per case. */
const BASE = {
  pageUrl: 'https://example.com/page/',
  unixSeconds: 1_700_000_000,
  mobile: false,
  home: false
};

describe('RUCSS_ENDPOINT', () => {
  it('is the fixed HTTPS service address', () => {
    expect(RUCSS_ENDPOINT).toBe('https://mega.wp-rocket.me/support/wpr-rucss-v2.php');
  });
});

describe('toUnixSeconds', () => {
  it('floors epoch ms to seconds', () => {
    expect(toUnixSeconds(0)).toBe(0);
    expect(toUnixSeconds(1_700_000_000_999)).toBe(1_700_000_000);
  });

  it('refuses a negative or non-finite instant', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toUnixSeconds(bad)).toThrow(RangeError);
    }
  });
});

describe('buildRucssEndpointUrl', () => {
  it('puts the page address verbatim, then ?<seconds>', () => {
    expect(buildRucssEndpointUrl(BASE)).toBe(
      `${RUCSS_ENDPOINT}?url=https://example.com/page/?1700000000`
    );
  });

  it('keeps the literal second ? after a page query (unencoded)', () => {
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/?p=1&q=2' })).toBe(
      `${RUCSS_ENDPOINT}?url=https://example.com/?p=1&q=2?1700000000`
    );
  });

  it('appends the bare flags in mobile, home order', () => {
    expect(buildRucssEndpointUrl({ ...BASE, mobile: true })).toMatch(/\?1700000000&mobile$/);
    expect(buildRucssEndpointUrl({ ...BASE, home: true })).toMatch(/\?1700000000&home$/);
    expect(buildRucssEndpointUrl({ ...BASE, mobile: true, home: true })).toMatch(
      /\?1700000000&mobile&home$/
    );
  });

  it('drops the page fragment so the seconds and flags reach the service', () => {
    expect(
      buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/a?x=1#top', mobile: true })
    ).toBe(`${RUCSS_ENDPOINT}?url=https://example.com/a?x=1?1700000000&mobile`);
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/#' })).toBe(
      `${RUCSS_ENDPOINT}?url=https://example.com/?1700000000`
    );
  });

  it('never sends page credentials to the service (user, password, or both)', () => {
    expect(
      buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://user:pw@example.com/p?a=1#x', home: true })
    ).toBe(`${RUCSS_ENDPOINT}?url=https://example.com/p?a=1?1700000000&home`);
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://user@example.com/' })).toBe(
      `${RUCSS_ENDPOINT}?url=https://example.com/?1700000000`
    );
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://:pw@example.com:8443/' })).toBe(
      `${RUCSS_ENDPOINT}?url=https://example.com:8443/?1700000000`
    );
  });

  it('accepts http pages and serializes the URL canonically', () => {
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'HTTP://Example.COM' })).toBe(
      `${RUCSS_ENDPOINT}?url=http://example.com/?1700000000`
    );
  });

  it('refuses non-HTTP(S) or relative page addresses', () => {
    for (const pageUrl of [
      '',
      '/page',
      'javascript:alert(1)',
      'data:text/html,x',
      'file:///etc/passwd',
      'chrome://newtab'
    ]) {
      expect(() => buildRucssEndpointUrl({ ...BASE, pageUrl })).toThrow(RangeError);
    }
  });

  it('never echoes a refused address (credentials, path or query)', () => {
    for (const pageUrl of [
      'ftp://user:secret@host/private?token=t',
      'user:secret@host/page',
      '//user:secret@host/'
    ]) {
      expect(() => buildRucssEndpointUrl({ ...BASE, pageUrl })).toThrow(
        new RangeError('The page URL is not an absolute HTTP(S) URL')
      );
    }
  });

  it('refuses a non-integer or negative time', () => {
    for (const unixSeconds of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildRucssEndpointUrl({ ...BASE, unixSeconds })).toThrow(RangeError);
    }
  });
});

describe('buildRucssRequestInit', () => {
  it('posts JSON with { safelist } when there are entries', () => {
    expect(buildRucssRequestInit(['.a', '#b'])).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"safelist":[".a","#b"]}',
      redirect: 'follow'
    });
  });

  it('posts an empty object when the safelist is empty', () => {
    expect(buildRucssRequestInit([]).body).toBe('{}');
  });
});
