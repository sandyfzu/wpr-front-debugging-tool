/**
 * The compiled-matcher cache: each pattern compiles once and is reused
 * across calls; compilation is case-sensitive and stateless; the cache is
 * bounded so a long-running surface cannot grow it without end.
 */
import { describe, expect, it } from 'vitest';
import { PATTERN_CACHE_LIMIT, compilePattern, compilePatternRows } from './compile';
import { ExclusionValidationError } from './errors';

describe('compilePattern', () => {
  it('compiles the pattern as a case-sensitive regular expression', () => {
    const compiled = compilePattern('wp-content/x.js');
    expect(compiled).toBeInstanceOf(RegExp);
    expect(compiled.flags).toBe('');
    expect(compiled.test('https://s.tld/wp-content/x.js?ver=1')).toBe(true);
    expect(compiled.test('https://s.tld/WP-CONTENT/x.js')).toBe(false);
  });

  it('serves the same compiled instance for the same pattern — the cache across calls', () => {
    expect(compilePattern('a.js?ver=1')).toBe(compilePattern('a.js?ver=1'));
    expect(compilePattern('a.js?ver=1')).not.toBe(compilePattern('b.js?ver=1'));
  });

  it('keeps compiled matchers stateless under repeated testing (no lastIndex drift)', () => {
    const compiled = compilePattern('main[0-9].js');
    for (const url of ['main1.js', 'main2.js', 'main3.js']) {
      expect(compiled.test(url)).toBe(true);
      expect(compiled.test(url)).toBe(true);
    }
    expect(compiled.test('nope.js')).toBe(false);
    expect(compiled.test('main1.js')).toBe(true);
  });

  it("propagates the compiler's SyntaxError for an invalid pattern", () => {
    expect(() => compilePattern('(unclosed[')).toThrow(SyntaxError);
  });

  it('evicts the oldest entry beyond the cache bound — bounded memory', () => {
    const first = compilePattern('cache-evict-first.js');
    // Fill the cache past its bound; the first pattern is the eviction victim.
    for (let i = 0; i < PATTERN_CACHE_LIMIT; i++) compilePattern(`filler-${String(i)}.js`);
    expect(compilePattern('cache-evict-first.js')).not.toBe(first);
    const retained = compilePattern(`filler-${String(PATTERN_CACHE_LIMIT - 1)}.js`);
    expect(compilePattern(`filler-${String(PATTERN_CACHE_LIMIT - 1)}.js`)).toBe(retained);
  });
});

describe('compilePatternRows', () => {
  it('compiles each row to its pattern text + matcher, in row order', () => {
    const compiled = compilePatternRows(['/js/a.js', '/js/b.*'], 'defer_all_js');
    expect(compiled.map(({ row }) => row)).toEqual(['/js/a.js', '/js/b.*']);
    expect(compiled[0]?.regex.test('https://s.tld/js/a.js')).toBe(true);
    expect(compiled[1]?.regex.test('https://s.tld/js/b.min.js')).toBe(true);
  });

  it('throws the typed error naming every invalid row of the feature', () => {
    const throws = (): unknown => compilePatternRows(['(one[', 'ok.js', '(two['], 'delay_js');
    expect(throws).toThrow(ExclusionValidationError);
    try {
      throws();
    } catch (error) {
      expect(error).toBeInstanceOf(ExclusionValidationError);
      const validationError = error as ExclusionValidationError;
      expect(validationError.invalid).toEqual([
        expect.objectContaining({ feature: 'delay_js', index: 0, row: '(one[' }),
        expect.objectContaining({ feature: 'delay_js', index: 2, row: '(two[' })
      ]);
    }
  });

  it('compiles an empty row list to an empty list', () => {
    expect(compilePatternRows([], 'automatic_lazy_rendering')).toEqual([]);
  });
});
