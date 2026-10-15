/**
 * Capture-time header redaction: every sensitive class withheld or reduced
 * (Set-Cookie keeps its cookie name only, folded values included), the
 * exempt caching headers left intact, already withheld rows final, and a
 * planted secret never surviving the list.
 */
import { describe, expect, it } from 'vitest';
import { redactPageHeader, redactPageHeaders } from './headers';
import { PLANTED, PLANTED_RAW_HEADERS } from './planted-secrets.fixtures';

describe('redactPageHeader', () => {
  it.each([
    ['Set-Cookie', 'sid=abc; Path=/; HttpOnly', 'sid'],
    ['set-cookie', 'first=a; Path=/\nsecond=b', 'first'],
    ['SET-COOKIE2', ' spaced = v', 'spaced']
  ])('keeps only the cookie name of %s %j', (name, value, cookieName) => {
    expect(redactPageHeader({ name, value })).toEqual({ name, redacted: true, cookieName });
  });

  it.each(['NAMELESS', 'SECRET\nname=v', '=v', 'tok; Path=/'])(
    'withholds a nameless Set-Cookie (%j) entirely',
    (value) => {
      expect(redactPageHeader({ name: 'Set-Cookie', value })).toEqual({
        name: 'Set-Cookie',
        redacted: true
      });
    }
  );

  it.each([
    ['Authorization', 'Bearer abc'],
    ['Proxy-Authorization', 'Basic YTpi'],
    ['Cookie', 'a=b'],
    ['X-WP-Nonce', '1a2b'],
    ['X-Api-Key', 'k'],
    ['X-Debug-Token', 'abc123'],
    ['x-csrf-token', 't']
  ])('withholds %s with no value and no cookie name', (name, value) => {
    expect(redactPageHeader({ name, value })).toEqual({ name, redacted: true });
  });

  it.each([
    ['Location', 'https://a.example/n?token=abc&ok=1', 'https://a.example/n?token=[redacted]&ok=1'],
    ['location', '/next?_wpnonce=abc#frag', '/next?_wpnonce=[redacted]'],
    ['Content-Location', 'https://u:p@a.example/x', 'https://a.example/x'],
    ['Refresh', '5; url=https://a.example/?sig=s', '5; url=https://a.example/?sig=[redacted]'],
    [
      'Link',
      '<https://a.example/?key=k>; rel=next',
      '<https://a.example/?key=[redacted]>; rel=next'
    ],
    ['WWW-Authenticate', 'Digest realm="r", nonce="n"', 'Digest realm="r"']
  ])('reduces the URL/challenge value of %s', (name, value, reduced) => {
    expect(redactPageHeader({ name, value })).toEqual({ name, value: reduced });
  });

  it.each([
    ['Surrogate-Key', 'post-1 term-2'],
    ['Cache-Key', 'k1'],
    ['X-Cache-Key', 'https://a.example/page?x=1'],
    ['Cache-Control', 'max-age=0'],
    ['X-Rocket-Nginx-Serving-Static', 'HIT'],
    ['Location', 'https://a.example/plain']
  ])('leaves exempt and ordinary %s intact', (name, value) => {
    expect(redactPageHeader({ name, value })).toEqual({ name, value });
  });

  it('keeps valueless rows valueless', () => {
    expect(redactPageHeader({ name: 'Set-Cookie' })).toEqual({ name: 'Set-Cookie' });
    // A cookie name only travels on a withheld row: a stray one is dropped.
    expect(redactPageHeader({ name: 'Set-Cookie', cookieName: 'sid' })).toEqual({
      name: 'Set-Cookie'
    });
  });

  it('is final on already withheld rows (no double processing)', () => {
    const withheld = { name: 'Set-Cookie', redacted: true, cookieName: 'sid' } as const;
    expect(redactPageHeader(withheld)).toBe(withheld);
    const once = redactPageHeaders(PLANTED_RAW_HEADERS);
    expect(redactPageHeaders(once)).toEqual(once);
  });
});

describe('redactPageHeaders', () => {
  it('drops every planted secret and keeps the rows, names and evidence', () => {
    const redacted = redactPageHeaders(PLANTED_RAW_HEADERS);
    expect(JSON.stringify(redacted)).not.toContain(PLANTED);
    expect(redacted.map((row) => row.name)).toEqual(PLANTED_RAW_HEADERS.map((row) => row.name));
    expect(redacted.filter((row) => row.redacted === true).map((row) => row.cookieName)).toEqual([
      'wordpress_logged_in_ab',
      'wp_first',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(redacted).toContainEqual({ name: 'Surrogate-Key', value: 'post-1 term-2' });
    expect(redacted).toContainEqual({ name: 'WWW-Authenticate', value: 'Digest realm="site"' });
  });
});
