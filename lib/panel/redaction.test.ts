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
  redactHeaderUrls,
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

describe('redactHeaderUrls', () => {
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
    [
      'link',
      '</a.css?token=x>; rel=preload, <https://a.example/b.js>; rel=preload',
      `</a.css?token=${REDACTED_PARAM}>; rel=preload, <https://a.example/b.js>; rel=preload`
    ]
  ])('reduces %s: %j', (name, value, expected) => {
    expect(redactHeaderUrls(name, value)).toBe(expected);
  });

  it.each([
    ['location', 'https://a.example'],
    ['location', '/plain/path?page=2'],
    ['location', ''],
    ['refresh', '5'],
    ['link', '<https://a.example/x.css>; rel=preload'],
    ['x-redirect-by', 'WordPress'],
    ['x-other', 'https://a.example/?token=kept-not-a-url-header']
  ])('keeps %s %j exactly as sent', (name, value) => {
    expect(redactHeaderUrls(name, value)).toBe(value);
  });
});
