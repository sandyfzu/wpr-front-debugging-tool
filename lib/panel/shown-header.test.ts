/**
 * The shown form of a header row: secret-bearing values withheld (a
 * Set-Cookie keeps its cookie name only), URL values reduced, every other
 * row passed through.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED } from '../redaction/rule';
import { shownHeader } from './shown-header';

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
