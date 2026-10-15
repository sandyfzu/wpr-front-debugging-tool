/**
 * The shown form of a header row: rows the capture withheld read as the
 * marker (a Set-Cookie with its kept cookie name), and unflagged rows still
 * run through the shared rule — a payload that bypassed the capture leaks
 * nothing either.
 */
import { describe, expect, it } from 'vitest';
import { REDACTED } from '../redaction/rule';
import { buildHeadersViewModel } from './headers-view-model';
import { shownHeader } from './shown-header';
import { redactPageHeaders } from '../redaction/headers';
import { PLANTED, PLANTED_RAW_HEADERS } from '../redaction/planted-secrets.fixtures';

describe('shownHeader — rows withheld at capture', () => {
  it('reads a withheld Set-Cookie as its cookie name plus the marker', () => {
    expect(shownHeader({ name: 'Set-Cookie', value: 'sid', hint: null, redacted: true })).toEqual({
      name: 'Set-Cookie',
      value: `sid=${REDACTED}`,
      hint: null,
      redacted: true
    });
  });

  it('reads a withheld row without a cookie name as the bare marker, hint dropped', () => {
    expect(shownHeader({ name: 'Authorization', value: null, hint: 'x', redacted: true })).toEqual({
      name: 'Authorization',
      value: REDACTED,
      hint: null,
      redacted: true
    });
  });

  it('never re-processes a withheld row (the marker is not read as a cookie value)', () => {
    const shown = shownHeader({ name: 'Set-Cookie', value: 'sid', hint: null, redacted: true });
    expect(shownHeader({ ...shown, value: 'sid', redacted: true }).value).toBe(`sid=${REDACTED}`);
  });

  it('shows the capture-redacted planted headers without a single secret', () => {
    const model = buildHeadersViewModel(redactPageHeaders(PLANTED_RAW_HEADERS));
    const shown = [...model.caching, ...model.other].map(shownHeader);
    expect(JSON.stringify(shown)).not.toContain(PLANTED);
    expect(shown.filter((row) => row.redacted)).toHaveLength(8);
    expect(shown).toContainEqual({
      name: 'Set-Cookie',
      value: `wordpress_logged_in_ab=${REDACTED}`,
      hint: null,
      redacted: true
    });
  });

  it('shows an unredacted (old) planted capture without a single secret either', () => {
    const model = buildHeadersViewModel(PLANTED_RAW_HEADERS);
    const shown = [...model.caching, ...model.other].map(shownHeader);
    expect(JSON.stringify(shown)).not.toContain(PLANTED);
  });
});

describe('shownHeader — unflagged rows (defence in depth)', () => {
  it.each(['set-cookie', 'Set-Cookie', 'SET-COOKIE2'])(
    'keeps only the cookie name of %s',
    (name) => {
      const shown = shownHeader({
        name,
        value: 'k=v; Path=/; HttpOnly',
        hint: null,
        redacted: false
      });
      expect(shown).toEqual({ name, value: `k=${REDACTED}`, hint: null, redacted: true });
    }
  );

  it.each(['NAMELESSSECRETTOKEN', 'tok; Path=/'])(
    'withholds a nameless Set-Cookie (%s) entirely',
    (value) => {
      const shown = shownHeader({ name: 'Set-Cookie', value, hint: null, redacted: false });
      expect(shown.value).toBe(REDACTED);
      expect(JSON.stringify(shown)).not.toContain(value.split(';')[0]);
    }
  );

  it('withholds credential and token values, hint included', () => {
    expect(
      shownHeader({ name: 'Authorization', value: 'Bearer abc.def', hint: 'x', redacted: false })
    ).toEqual({
      name: 'Authorization',
      value: REDACTED,
      hint: null,
      redacted: true
    });
    expect(
      shownHeader({ name: 'x-wp-nonce', value: '1a2b3c', hint: null, redacted: false }).value
    ).toBe(REDACTED);
  });

  it('withholds a folded Set-Cookie whose first cookie is nameless', () => {
    const shown = shownHeader({
      name: 'set-cookie',
      value: 'SECRET\nname=v',
      hint: null,
      redacted: false
    });
    expect(shown.value).toBe(REDACTED);
    expect(JSON.stringify(shown)).not.toContain('SECRET');
  });

  it('keeps a URL-valued header visible with its secret query values reduced', () => {
    expect(
      shownHeader({
        name: 'location',
        value: 'https://a.example/n?token=abc',
        hint: null,
        redacted: false
      })
    ).toEqual({
      name: 'location',
      value: 'https://a.example/n?token=[redacted]',
      hint: null,
      redacted: false
    });
  });

  it('passes every other header (and valueless rows) through', () => {
    const row = { name: 'cache-control', value: 'max-age=0', hint: 'hint', redacted: false };
    expect(shownHeader(row)).toEqual(row);
    const valueless = { name: 'set-cookie', value: null, hint: null, redacted: false };
    expect(shownHeader(valueless)).toEqual(valueless);
  });
});
