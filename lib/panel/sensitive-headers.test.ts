/**
 * The sensitive-header rule: every exact name and every name fragment
 * redacts (any casing), ordinary headers pass, and `Set-Cookie` keeps a
 * cookie name only when one is well-formed — the two broken shapes (no `=`,
 * attributes before any `=`) keep nothing.
 */
import { describe, expect, it } from 'vitest';
import { isSensitiveHeader, REDACTED, redactHeaderValue } from './sensitive-headers';

describe('isSensitiveHeader', () => {
  it.each([
    'cookie',
    'Set-Cookie',
    'SET-COOKIE2',
    'Authorization',
    'proxy-authorization',
    'X-Debug-Token',
    'x-debug-token-link'
  ])('redacts the exact credential name %s', (name) => {
    expect(isSensitiveHeader(name)).toBe(true);
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
    ['credential', 'X-Credentials']
  ])('redacts names carrying the %s fragment (%s)', (_fragment, name) => {
    expect(isSensitiveHeader(name)).toBe(true);
  });

  it.each(['Server', 'Cache-Control', 'age', 'X-Powered-By', 'Content-Type', 'X-Rocket-Cache'])(
    'passes the ordinary header %s',
    (name) => {
      expect(isSensitiveHeader(name)).toBe(false);
    }
  );
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

  it('names the redaction marker once', () => {
    expect(REDACTED).toBe('(value redacted)');
  });
});
