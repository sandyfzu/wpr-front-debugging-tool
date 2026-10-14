/**
 * The redaction rule: every exact name and every name fragment redacts (any
 * casing, headers and query names alike), ordinary names pass, `Set-Cookie`
 * keeps a cookie name only when one is well-formed, and page URLs are
 * rebuilt without credentials, fragment or sensitive query values.
 */
import { describe, expect, it } from 'vitest';
import {
  isSensitiveName,
  REDACTED,
  REDACTED_PARAM,
  shownHeader,
  reduceHeaderValue,
  redactHeaderValue,
  redactUrl
} from './redaction';

describe('isSensitiveName', () => {
  it.each([
    'cookie',
    'Set-Cookie',
    'SET-COOKIE2',
    'Authorization',
    'proxy-authorization',
    'X-Debug-Token',
    'x-debug-token-link',
    'key',
    '_wpnonce',
    'nonce',
    'preview_nonce',
    'token',
    'code',
    'state',
    'sig'
  ])('redacts the exact name %s', (name) => {
    expect(isSensitiveName(name)).toBe(true);
  });

  it.each([
    ['token', 'X-Csrf-Token'],
    ['secret', 'X-Client-Secret'],
    ['session', 'X-Session-Id'],
    ['auth', 'X-Auth-User'],
    ['nonce', 'X-WP-Nonce'],
    ['signature', 'X-Amz-Signature'],
    ['api-key', 'X-Api-Key'],
    ['api_key', 'x_api_key'],
    ['apikey', 'ApiKey'],
    ['csrf', 'X-CSRF'],
    ['xsrf', 'X-XSRF'],
    ['password', 'X-Password-Hint'],
    ['passwd', 'X-Passwd'],
    ['credential', 'X-Credentials'],
    ['jwt', 'X-JWT'],
    ['hmac', 'X-Hmac'],
    ['bearer', 'X-Bearer'],
    ['private', 'X-Private-Key'],
    ['pwd', 'X-Pwd'],
    ['pass word', 'X-Pass'],
    ['pass word (query)', 'user_pass'],
    ['sig word', 'X-Sig'],
    ['trailing key', 'X-Access-Key'],
    ['trailing key (the exemptions are exact names)', 'x-edge-cache-key'],
    ['trailing key (query)', 'license_key'],
    ['sid word', 'x-sid'],
    ['ticket word', 'x-ticket'],
    ['otp word', 'x-otp'],
    ['hash word', 'hash'],
    ['email word', 'email'],
    ['login word', 'user_login'],
    ['login word (alone)', 'login'],
    ['+ as separator', 'api+key'],
    ['space as separator', 'api key']
  ])('redacts names carrying the %s fragment (%s)', (_fragment, name) => {
    expect(isSensitiveName(name)).toBe(true);
  });

  // One name per fragment that carries ONLY that fragment, so dropping any
  // single alternative from the rule fails its own row.
  it.each([
    ['token', 'x-token-id'],
    ['secret', 'x-client-secret'],
    ['session', 'x-session'],
    ['auth', 'x-auth'],
    ['nonce', 'x-nonce-value'],
    ['signature', 'x-signature'],
    ['api-key', 'x-api-key-id'],
    ['apikey', 'x-apikey'],
    ['csrf', 'x-csrf'],
    ['xsrf', 'x-xsrf'],
    ['password', 'x-password'],
    ['passwd', 'x-passwd'],
    ['credential', 'x-credential'],
    ['jwt', 'x-jwt-id'],
    ['hmac', 'x-hmac-id'],
    ['bearer', 'x-bearer'],
    ['private', 'x-private'],
    ['pwd', 'x-pwd'],
    ['pass word', 'x-pass-id'],
    ['sig word', 'x-sig-id'],
    ['sid word', 'x-sid-id'],
    ['ticket word', 'x-ticket-id'],
    ['otp word', 'x-otp-id'],
    ['hash word', 'x-hash-id'],
    ['email word', 'x-email-id'],
    ['login word', 'x-login-id'],
    ['trailing key word', 'x-access-key'],
    ['exact cookie, trimmed', ' Cookie ']
  ])('redacts the isolated %s case (%j)', (_fragment, name) => {
    expect(isSensitiveName(name)).toBe(true);
  });

  it.each([
    'Server',
    'Cache-Control',
    'age',
    'X-Powered-By',
    'Content-Type',
    'X-Rocket-Cache',
    'Link',
    'X-Request-Id',
    'x-keyword',
    'surrogate-key',
    'Surrogate-Key',
    'cache-key',
    'X-Cache-Key',
    ' x-cache-key ',
    'WWW-Authenticate',
    'nowprocket',
    'page',
    'keyword',
    'passage',
    'signal',
    'compass',
    'author',
    'Author',
    'passive',
    'passport',
    'monkey',
    'turnkey',
    'statement',
    'postcode',
    'sidebar',
    'hashtag',
    'emails_sent',
    'loginless'
  ])('passes the ordinary name %s', (name) => {
    expect(isSensitiveName(name)).toBe(false);
  });
});

describe('redactHeaderValue', () => {
  it('passes ordinary values through untouched', () => {
    expect(redactHeaderValue('Server', 'nginx')).toEqual({ redacted: false, value: 'nginx' });
  });

  it('redacts every sensitive non-Set-Cookie value without a name', () => {
    expect(redactHeaderValue('Cookie', 'a=1; b=2')).toEqual({ redacted: true, cookieName: null });
    expect(redactHeaderValue('Authorization', 'Bearer x')).toEqual({
      redacted: true,
      cookieName: null
    });
  });

  it('keeps a well-formed Set-Cookie name, trimmed', () => {
    expect(redactHeaderValue('set-cookie', ' sid = abc; Path=/')).toEqual({
      redacted: true,
      cookieName: 'sid'
    });
  });

  it.each([
    ['NAMELESSSECRETTOKEN', 'a bare value (no =)'],
    ['tok; Path=/', 'attributes before any = (first segment has none)'],
    ['=orphan', 'an empty name'],
    ['', 'an empty value']
  ])('keeps nothing of %j — %s', (value) => {
    expect(redactHeaderValue('Set-Cookie', value)).toEqual({ redacted: true, cookieName: null });
  });

  it.each([
    ['SECRET\nname=v', 'a folded value whose first cookie is nameless'],
    ['  ; a=b', 'a blank first segment']
  ])('keeps nothing of %j — %s', (value) => {
    expect(redactHeaderValue('Set-Cookie', value)).toEqual({ redacted: true, cookieName: null });
  });

  it('names the first cookie of a folded or attribute-laden value only', () => {
    expect(redactHeaderValue('Set-Cookie', 'a=1; Path=/\nb=2')).toEqual({
      redacted: true,
      cookieName: 'a'
    });
    expect(redactHeaderValue('Set-Cookie', 'token=x=y==; Path=/')).toEqual({
      redacted: true,
      cookieName: 'token'
    });
  });

  it.each(['set-cookie2', 'Set-Cookie2', ' SET-COOKIE '])(
    'treats %j as a Set-Cookie (cookie name kept)',
    (name) => {
      expect(redactHeaderValue(name, 'wp=abc; HttpOnly')).toEqual({
        redacted: true,
        cookieName: 'wp'
      });
    }
  );

  it('reduces URL-valued headers instead of passing them raw', () => {
    expect(redactHeaderValue('Location', 'https://a.example/next?token=abc&p=1')).toEqual({
      redacted: false,
      value: `https://a.example/next?token=${REDACTED_PARAM}&p=1`
    });
  });

  it('names the redaction markers once', () => {
    expect(REDACTED).toBe('(value redacted)');
    expect(REDACTED_PARAM).toBe('[redacted]');
  });
});

describe('embedded URLs', () => {
  it('follows exactly one level of URL-in-a-parameter (the bound that keeps it finite)', () => {
    const inner = `https://b.example/?token=${encodeURIComponent('DEEP')}`;
    const middle = `https://a.example/?next=${encodeURIComponent(inner)}&token=MID`;
    const outer = `https://o.example/?go=${encodeURIComponent(middle)}`;
    const reduced = redactUrl(outer) ?? '';
    const level1 = decodeURIComponent(new URL(reduced).searchParams.get('go') ?? '');
    // The first embedded level is reduced…
    expect(level1).toContain(`token=${REDACTED_PARAM}`);
    expect(level1).not.toContain('MID');
    // …and its own embedded URL is left as written (no second descent).
    expect(new URL(level1).searchParams.get('next')).toBe(inner);
  });

  it('leaves a parameter that only looks like a URL untouched', () => {
    expect(redactUrl('https://a.example/?next=ftp%3A%2F%2Fx%2F%3Ftoken%3Dt')).toBe(
      'https://a.example/?next=ftp%3A%2F%2Fx%2F%3Ftoken%3Dt'
    );
  });
});

describe('decoding depth', () => {
  it('reads a doubly encoded separator in a parameter name (two decoding passes)', () => {
    expect(redactUrl('https://a.example/?api%252Bkey=SECRET')).toBe(
      `https://a.example/?api%252Bkey=${REDACTED_PARAM}`
    );
    expect(redactUrl('https://a.example/?api%25252Bkey=SECRET')).toBe(
      `https://a.example/?api%25252Bkey=${REDACTED_PARAM}`
    );
  });
});

describe('redactUrl', () => {
  it.each([
    [
      'drops credentials and fragment, redacts sensitive params',
      'https://user:pw@host.test/?preview_nonce=X&key=Y#access_token=Z',
      'https://host.test/?preview_nonce=[redacted]&key=[redacted]'
    ],
    [
      'keeps support-relevant params and valueless flags',
      'https://a.test/shop/?nowprocket&page=2',
      'https://a.test/shop/?nowprocket&page=2'
    ],
    [
      'redacts every listed query name',
      'http://a.test/?_wpnonce=1&nonce=2&token=3&code=4&state=5&sig=6&ok=7',
      'http://a.test/?_wpnonce=[redacted]&nonce=[redacted]&token=[redacted]&code=[redacted]&state=[redacted]&sig=[redacted]&ok=7'
    ],
    [
      'matches fragment names and encoded/plus-spaced names',
      'https://a.test/?access_token=1&my%5Fpwd=2&api+key=3',
      'https://a.test/?access_token=[redacted]&my%5Fpwd=[redacted]&api+key=[redacted]'
    ],
    [
      'compares a malformed escape as written',
      'https://a.test/?%zztoken=1&q=%zz',
      'https://a.test/?%zztoken=[redacted]&q=%zz'
    ],
    [
      'redacts a value under an empty name',
      'https://a.test/?=S&ok=1',
      'https://a.test/?=[redacted]&ok=1'
    ],
    [
      'splits on ; as well as &, keeping each separator',
      'https://ex.com/?x=1;token=S&key=K;page=2',
      'https://ex.com/?x=1;token=[redacted]&key=[redacted];page=2'
    ],
    [
      'redacts a long bare value whole, keeps short flags',
      'https://a.test/?nowprocket&abcdefghijklmnopqrstuvwx&ok',
      'https://a.test/?nowprocket&[redacted]&ok'
    ],
    [
      'redacts a JWT-shaped bare value whole',
      'https://a.test/?eyJh.eyJz.c2ln',
      'https://a.test/?[redacted]'
    ],
    [
      'keeps a 23-character bare value (below the token length)',
      'https://a.test/?abcdefghijklmnopqrstuvw',
      'https://a.test/?abcdefghijklmnopqrstuvw'
    ],
    [
      'decodes names fully (encoded +, double-encoded _)',
      'https://a.test/?api%2Bkey=1&access%255Ftoken=2',
      'https://a.test/?api%2Bkey=[redacted]&access%255Ftoken=[redacted]'
    ],
    [
      'keeps WordPress ?author=1 but redacts author_token',
      'https://a.test/?author=1&author_token=T',
      'https://a.test/?author=1&author_token=[redacted]'
    ],
    [
      'redacts ;jsessionid= path parameters, keeps other path segments',
      'https://a.test/shop;jsessionid=ABC/item;color=red/x',
      'https://a.test/shop;jsessionid=[redacted]/item;color=red/x'
    ],
    ['normalises a bare host', 'https://A.TEST', 'https://a.test/'],
    ['drops an empty fragment', 'https://a.test/#', 'https://a.test/'],
    [
      'strips newlines and tabs (no injected markdown lines)',
      'https://x.test/a\nb\t?q=1\n',
      'https://x.test/ab?q=1'
    ],
    [
      'drops an injected heading that the parser reads as a fragment',
      'https://x.test/\n## h',
      'https://x.test/'
    ],
    [
      'percent-encodes other controls and bidi characters',
      'https://x.test/a\u0007b‮c',
      'https://x.test/a%07b%E2%80%AEc'
    ]
  ])('%s', (_label, raw, expected) => {
    expect(redactUrl(raw)).toBe(expected);
  });

  it.each(['', 'not a url', '/relative', 'javascript:alert(1)', 'ftp://a.test/', 'data:,x'])(
    'answers null for the non-http(s) input %j',
    (raw) => {
      expect(redactUrl(raw)).toBeNull();
    }
  );
});

describe('reduceHeaderValue', () => {
  it.each([
    [
      'location',
      'https://a.example/n?token=t&p=1',
      `https://a.example/n?token=${REDACTED_PARAM}&p=1`
    ],
    ['Location', 'https://u:pw@a.example/', 'https://a.example/'],
    [' location ', 'https://a.example/?token=t', `https://a.example/?token=${REDACTED_PARAM}`],
    ['content-location', '/n?_wpnonce=x', `/n?_wpnonce=${REDACTED_PARAM}`],
    ['location', '//cdn.example/a.js?sig=1', `//cdn.example/a.js?sig=${REDACTED_PARAM}`],
    ['location', '/cb#access_token=abc', '/cb'],
    ['location', 'javascript:alert(1)', REDACTED_PARAM],
    ['location', 'http://[bad', REDACTED_PARAM],
    ['refresh', '5; url=/n?token=t', `5; url=/n?token=${REDACTED_PARAM}`],
    [
      'Refresh',
      "0;URL='https://a.example/?key=k'",
      `0;URL='https://a.example/?key=${REDACTED_PARAM}'`
    ],
    ['refresh', '3, /n?session=s', `3, /n?session=${REDACTED_PARAM}`],
    ['refresh', 'url=/n?token=t', `url=/n?token=${REDACTED_PARAM}`],
    ['refresh', ' URL = "/n?token=t"', ` URL = "/n?token=${REDACTED_PARAM}"`],
    ['location', 'next?token=x', `next?token=${REDACTED_PARAM}`],
    ['location', 'a/b/../c?token=x&p=1#frag', `a/b/../c?token=${REDACTED_PARAM}&p=1`],
    ['location', '?token=x', `?token=${REDACTED_PARAM}`],
    ['x-redirect-to', '/next?nonce=n', `/next?nonce=${REDACTED_PARAM}`],
    [
      'X-Pingback',
      'https://a.example/xmlrpc.php?key=k',
      `https://a.example/xmlrpc.php?key=${REDACTED_PARAM}`
    ],
    [
      'location',
      '/login?redirect_to=https%3A%2F%2Fa.example%2Fadmin%3Ftoken%3DSECRET&x=1',
      `/login?redirect_to=${encodeURIComponent(`https://a.example/admin?token=${REDACTED_PARAM}`)}&x=1`
    ],
    ['link', '</a.css?token=x', `<${REDACTED_PARAM}`],
    [
      'link',
      '<https://a.example/x.css>; rel=preload, </b?token=SECRET',
      `<https://a.example/x.css>; rel=preload, <${REDACTED_PARAM}`
    ],
    [
      'link',
      '</a.css>; rel=preload; anchor="/page?token=x"',
      `</a.css>; rel=preload; anchor="/page?token=${REDACTED_PARAM}"`
    ],
    [
      'link',
      '</a.jpg>; rel=preload; imagesrcset="https://a.example/a.jpg?sig=s 1x, https://a.example/b.jpg 2x"',
      `</a.jpg>; rel=preload; imagesrcset="https://a.example/a.jpg?sig=${REDACTED_PARAM} 1x, https://a.example/b.jpg 2x"`
    ],
    ['link', '</a.css>; anchor=/p?token=x', `</a.css>; anchor=/p?token=${REDACTED_PARAM}`],
    ['www-authenticate', 'Basic realm="WordPress", charset="UTF-8"', 'Basic realm="WordPress"'],
    [
      'WWW-Authenticate',
      'Digest realm="api", nonce="SECRETNONCE", opaque="OPAQUE", qop="auth"',
      'Digest realm="api"'
    ],
    ['www-authenticate', 'Negotiate YIIBhwYGKwYBBQUCoIIBezCCAXegAw', `Negotiate ${REDACTED}`],
    ['www-authenticate', 'NTLM TlRMTVNTUAACAAAADAAMADgAAAAFgo', `NTLM ${REDACTED}`],
    [
      'www-authenticate',
      'Bearer realm="x", error="invalid_token", Negotiate',
      'Bearer realm="x", Negotiate'
    ],
    [
      'www-authenticate',
      'Newauth realm="apps", type=1, title="Login, please", Basic realm="simple"',
      'Newauth realm="apps", Basic realm="simple"'
    ],
    ['www-authenticate', 'Custom SECRETTOKEN68==', 'Custom'],
    ['www-authenticate', 'realm="orphan", Basic', 'Basic'],
    ['www-authenticate', 'Digest realm="a", qop = "auth"', 'Digest realm="a"'],
    ['www-authenticate', 'Basic , , Digest realm=r, nonce=n', 'Basic, Digest realm=r'],
    ['www-authenticate', ' ', ''],
    [
      'link',
      '</a.css?token=x>; rel=preload, <https://a.example/b.js>; rel=preload',
      `</a.css?token=${REDACTED_PARAM}>; rel=preload, <https://a.example/b.js>; rel=preload`
    ]
  ])('reduces %s: %j', (name, value, expected) => {
    expect(reduceHeaderValue(name, value)).toBe(expected);
  });

  it.each([
    ['location', 'https://a.example'],
    ['location', '/plain/path?page=2'],
    ['location', ''],
    ['refresh', '5'],
    ['www-authenticate', 'Basic'],
    ['www-authenticate', 'Negotiate'],
    ['location', '#top'],
    ['location', '#access_token=kept-bare-fragment'],
    ['location', 'next?page=2'],
    ['location', '/login?redirect_to=https%3A%2F%2Fa.example%2Fadmin'],
    ['location', '/login?redirect_to=http%3A%2F%2F%5Bbad'],
    ['link', '<https://a.example/x.css>; rel=preload'],
    ['x-redirect-by', 'WordPress'],
    ['x-other', 'https://a.example/?token=kept-not-a-url-header']
  ])('keeps %s %j exactly as sent', (name, value) => {
    expect(reduceHeaderValue(name, value)).toBe(value);
  });
});

describe('shownHeader', () => {
  it.each(['set-cookie', 'Set-Cookie', 'SET-COOKIE2'])(
    'keeps only the cookie name of %s',
    (name) => {
      const shown = shownHeader({ name, value: 'k=v; Path=/; HttpOnly', hint: null });
      expect(shown).toEqual({ name, value: `k=${REDACTED}`, hint: null, redacted: true });
    }
  );

  it.each(['NAMELESSSECRETTOKEN', 'tok; Path=/'])(
    'withholds a nameless Set-Cookie (%s) entirely',
    (value) => {
      const shown = shownHeader({ name: 'Set-Cookie', value, hint: null });
      expect(shown.value).toBe(REDACTED);
      expect(JSON.stringify(shown)).not.toContain(value.split(';')[0]);
    }
  );

  it('withholds credential and token values, hint included', () => {
    expect(shownHeader({ name: 'Authorization', value: 'Bearer abc.def', hint: 'x' })).toEqual({
      name: 'Authorization',
      value: REDACTED,
      hint: null,
      redacted: true
    });
    expect(shownHeader({ name: 'x-wp-nonce', value: '1a2b3c', hint: null }).value).toBe(REDACTED);
  });

  it('withholds a folded Set-Cookie whose first cookie is nameless', () => {
    const shown = shownHeader({ name: 'set-cookie', value: 'SECRET\nname=v', hint: null });
    expect(shown.value).toBe(REDACTED);
    expect(JSON.stringify(shown)).not.toContain('SECRET');
  });

  it('keeps a URL-valued header visible with its secret query values reduced', () => {
    expect(
      shownHeader({ name: 'location', value: 'https://a.example/n?token=abc', hint: null })
    ).toEqual({
      name: 'location',
      value: 'https://a.example/n?token=[redacted]',
      hint: null,
      redacted: false
    });
  });

  it('passes every other header (and valueless rows) through', () => {
    const row = { name: 'cache-control', value: 'max-age=0', hint: 'hint' };
    expect(shownHeader(row)).toEqual({ ...row, redacted: false });
    const valueless = { name: 'set-cookie', value: null, hint: null };
    expect(shownHeader(valueless)).toEqual({ ...valueless, redacted: false });
  });
});
