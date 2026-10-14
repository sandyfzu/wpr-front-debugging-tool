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
  });

  it('trims separator whitespace without inventing names', () => {
    expect(sampleCookieNames('  a=1 ;  b  =2;c=3')).toEqual(['a', 'b', 'c']);
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
});
