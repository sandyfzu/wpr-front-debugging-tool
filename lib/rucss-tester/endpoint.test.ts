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
  it('puts the page address encoded, then ?<seconds>', () => {
    expect(buildRucssEndpointUrl(BASE)).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2Fpage%2F?1700000000`
    );
  });

  it('keeps a multi-parameter page address whole: one url value a standard parser reads back', () => {
    const built = buildRucssEndpointUrl({
      ...BASE,
      pageUrl: 'https://example.com/?p=1&q=2&mobile=1&home',
      home: true
    });
    expect(built).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2F%3Fp%3D1%26q%3D2%26mobile%3D1%26home%261700000000&home`
    );
    const params = new URL(built).searchParams;
    expect(params.get('url')).toBe('https://example.com/?p=1&q=2&mobile=1&home&1700000000');
    // The page's own `mobile`/`home` parameters never read as the service's flags.
    expect([...params.keys()]).toEqual(['url', 'home']);
  });

  /** The page address the service decodes from a built request. */
  const decodedPage = (pageUrl: string): string | null =>
    new URL(buildRucssEndpointUrl({ ...BASE, pageUrl })).searchParams.get('url');

  it('joins the seconds to a page without a query as `?<seconds>` (the literal, live-verified form)', () => {
    expect(buildRucssEndpointUrl(BASE)).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2Fpage%2F?1700000000`
    );
    expect(decodedPage(BASE.pageUrl)).toBe('https://example.com/page/?1700000000');
  });

  it('joins the seconds to a page query as one more parameter, never into its last value', () => {
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/?lang=fr' })).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2F%3Flang%3Dfr%261700000000`
    );
    const page = new URL(decodedPage('https://example.com/?lang=fr') ?? '');
    expect(page.searchParams.get('lang')).toBe('fr');
    expect([...page.searchParams.keys()]).toEqual(['lang', '1700000000']);
    // A valueless parameter keeps its name.
    expect(decodedPage('https://example.com/?amp')).toBe('https://example.com/?amp&1700000000');
  });

  it('keeps a query parameter with an empty value empty', () => {
    expect(decodedPage('https://example.com/p?a=1&lang=')).toBe(
      'https://example.com/p?a=1&lang=&1700000000'
    );
  });

  it('reads a bare trailing `?` (empty query) as no query: its `?` opens the seconds', () => {
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/p?' })).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2Fp%3F1700000000`
    );
    expect(decodedPage('https://example.com/p?#top')).toBe('https://example.com/p?1700000000');
  });

  /** A non-empty query that ends in a raw `?`, its decoded page and the page's own parameters. */
  const rawTrailingQuestionMark: readonly (readonly [
    string,
    string,
    readonly (readonly [string, string])[]
  ])[] = [
    ['https://example.com/p?q=what?', 'https://example.com/p?q=what?&1700000000', [['q', 'what?']]],
    [
      'https://example.com/p?a=1&b=?',
      'https://example.com/p?a=1&b=?&1700000000',
      [
        ['a', '1'],
        ['b', '?']
      ]
    ],
    ['https://example.com/p??', 'https://example.com/p??&1700000000', [['?', '']]]
  ];

  it.each(rawTrailingQuestionMark)(
    'joins the seconds to %s as one more parameter, never into its raw trailing `?`',
    (pageUrl, expected, pageParams) => {
      const decoded = decodedPage(pageUrl);
      expect(decoded).toBe(expected);
      // The page's own values stay intact; the seconds are their own parameter.
      expect([...new URL(decoded ?? '').searchParams]).toEqual([...pageParams, ['1700000000', '']]);
    }
  );

  it('never reads an encoded `?` in the path as a query', () => {
    expect(decodedPage('https://example.com/a%3Fb')).toBe('https://example.com/a%3Fb?1700000000');
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
    ).toBe(`${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%261700000000&mobile`);
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://example.com/#' })).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2F?1700000000`
    );
  });

  it('never sends page credentials to the service (user, password, or both)', () => {
    expect(
      buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://user:pw@example.com/p?a=1#x', home: true })
    ).toBe(`${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2Fp%3Fa%3D1%261700000000&home`);
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://user@example.com/' })).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%2F?1700000000`
    );
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'https://:pw@example.com:8443/' })).toBe(
      `${RUCSS_ENDPOINT}?url=https%3A%2F%2Fexample.com%3A8443%2F?1700000000`
    );
  });

  it('accepts http pages and serializes the URL canonically', () => {
    expect(buildRucssEndpointUrl({ ...BASE, pageUrl: 'HTTP://Example.COM' })).toBe(
      `${RUCSS_ENDPOINT}?url=http%3A%2F%2Fexample.com%2F?1700000000`
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
