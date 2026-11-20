import { describe, expect, it } from 'vitest';
import { COOKIE_NAME_LIMITS, sampleCookieNames } from './cookies';

describe('sampleCookieNames', () => {
  it('keeps only the names, in order (values are never read)', () => {
    const names = sampleCookieNames('wprocket=1; fallback=abc; wp-settings-2=x');
    expect(names).toEqual(['wprocket', 'fallback', 'wp-settings-2']);
  });

  it('never carries any value character (the security property)', () => {
    const raw = 'auth=secret-token-42; wprocket=1; fallback=x';
    expect(JSON.stringify(sampleCookieNames(raw))).not.toContain('secret-token-42');
    // A value that mimics another name still never appears.
    const mimic = 'ignored=wprocket; wprocket=1';
    expect(sampleCookieNames(mimic)).toEqual(['ignored', 'wprocket']);
    // The receipts' second redaction property, asserted here for real: the
    // JSON-serialized output carries no `=` — the name side ends at the
    // first `=`, so the separator can never ride into a payload.
    expect(JSON.stringify(sampleCookieNames('challenge=a=b=c'))).not.toContain('=');
  });

  it('trims separator whitespace without inventing names', () => {
    expect(sampleCookieNames('  a=1 ;  b  =2;c=3')).toEqual(['a', 'b', 'c']);
  });

  it('control characters ride a name through (pinned acceptance — the browser cannot deliver them)', () => {
    // RFC 6265's cookie-name/value grammar excludes control characters, so a
    // real `document.cookie` getter never yields one. The acceptance is
    // deliberate sibling consistency (the page-headers boundary carries
    // unprintable rows too) — pinned here and at the validator so tightening
    // it later becomes a recorded decision, never a silent one.
    expect(sampleCookieNames('na\x01me=1; \x7f=2; ok=3')).toEqual(['na\x01me', '\x7f', 'ok']);
  });

  it('skips pairs without `=` and empty names', () => {
    expect(sampleCookieNames('novalue; =empty; ok=1; =2')).toEqual(['ok']);
  });

  it('keeps the first occurrence of a name (path-scoped duplicates exist)', () => {
    expect(sampleCookieNames('wprocket=1; wprocket=2; other=3')).toEqual(['wprocket', 'other']);
  });

  it('splits on the first `=` only (a value may contain `=`)', () => {
    expect(sampleCookieNames('challenge=a=b=c')).toEqual(['challenge']);
  });

  it('drops an empty document.cookie to an empty list', () => {
    expect(sampleCookieNames('')).toEqual([]);
  });

  it('caps the list at the contract count', () => {
    const many = Array.from({ length: COOKIE_NAME_LIMITS.count + 10 }, (_, i) => `c${String(i)}=1`);
    expect(sampleCookieNames(many.join('; '))).toHaveLength(COOKIE_NAME_LIMITS.count);
  });

  it('clips a name that exceeds the contract length cap', () => {
    const longName = 'n'.repeat(COOKIE_NAME_LIMITS.name + 40);
    const parsed = sampleCookieNames(`${longName}=1; wprocket=1`);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toBe('n'.repeat(COOKIE_NAME_LIMITS.name));
  });

  it('two over-cap names sharing a clip emit that clipped name once (uniqueness)', () => {
    // An audit repro: two distinct >512-char names whose first 512
    // chars coincide must collapse to ONE payload name (first occurrence) —
    // the emitted clip is the dedupe key, never the dropped full name.
    const clip = 'n'.repeat(COOKIE_NAME_LIMITS.name);
    expect(sampleCookieNames(`${clip}A=1; ${clip}B=2`)).toEqual([clip]);
  });

  it('adversarial corpus: every emission list is unique (the contract invariant)', () => {
    // The payload contract states unique names — the invariant must hold over
    // every shape a hostile string can take, not just the repro pair. The
    // corpus: empty input, `=`-less/empty-name pairs, a quoted value
    // smuggling `;`, repeated names, a clip colliding with an exact-cap name
    // (both orders), whitespace variants, a truncated over-count list,
    // control characters, non-ASCII names, and an over-cap clip train.
    const cap = COOKIE_NAME_LIMITS.name;
    const clip = 'n'.repeat(cap);
    const countNames = (count: number, suffix = '=1'): string =>
      Array.from({ length: count }, (_, i) => `c${String(i)}${suffix}`).join('; ');
    const corpus: string[] = [
      '',
      'novalue; =a; ==x; b=1',
      'a="carol;margin=x"; c=2',
      'wprocket=1; wprocket=2; wprocket=3',
      `${clip}A=1; ${clip}B=2`,
      `${clip}=1; ${clip}extra=2`,
      `${clip}extra=1; ${clip}=2`,
      '  a  = 1 ; a=2 ;\ta\t=\t3',
      [countNames(COOKIE_NAME_LIMITS.count + 20), countNames(30, 'again=1')].join('; '),
      'na\x01me=1; \x7f=2; ok=3',
      '🍪=1; cookie=a-b-c',
      `${'x'.repeat(cap + 5)}Y=1; ${'x'.repeat(cap + 9)}Z=2; ${'x'.repeat(cap - 1)}=3`
    ];
    corpus.forEach((documentCookie, index) => {
      const names = sampleCookieNames(documentCookie);
      // Uniqueness (the invariant the audit found violated)…
      expect(
        new Set(names).size,
        `corpus[${String(index)}] emitted duplicates: ${JSON.stringify(names.slice(0, 4))}`
      ).toBe(names.length);
      // …and the contract caps still hold over every hostile shape.
      expect(names.length, `corpus[${String(index)}] count cap`).toBeLessThanOrEqual(
        COOKIE_NAME_LIMITS.count
      );
      for (const name of names) {
        expect(
          name.length,
          `corpus[${String(index)}] name cap: ${JSON.stringify(name.slice(0, 8))}…`
        ).toBeLessThanOrEqual(COOKIE_NAME_LIMITS.name);
        expect(name.length, `corpus[${String(index)}] no empty name`).toBeGreaterThan(0);
      }
    });
  });
});
