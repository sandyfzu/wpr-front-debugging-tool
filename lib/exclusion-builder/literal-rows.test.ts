/**
 * WP Rocket's runtime reading of the literal features' rows: Lazyload's
 * `array_filter`, lazy rendering's joined-alternation `empty()` check, and
 * PCRE's ASCII-only case folding.
 */
import { describe, expect, it } from 'vitest';
import {
  asciiLowerCase,
  isIgnoredLazyloadRow,
  isMatchAllLazyRenderRow,
  lazyRenderRowsInert
} from './literal-rows';

describe('isIgnoredLazyloadRow', () => {
  it('ignores exactly the PHP-falsy strings `""` and `"0"`', () => {
    expect(isIgnoredLazyloadRow('')).toBe(true);
    expect(isIgnoredLazyloadRow('0')).toBe(true);
    for (const kept of [' ', '00', '0.0', ' 0', 'a'])
      expect(isIgnoredLazyloadRow(kept)).toBe(false);
  });
});

describe('lazyRenderRowsInert / isMatchAllLazyRenderRow', () => {
  it('is inert when the joined rows are `""` or `"0"` (PHP `empty()`)', () => {
    expect(lazyRenderRowsInert([])).toBe(true);
    expect(lazyRenderRowsInert([''])).toBe(true);
    expect(lazyRenderRowsInert(['0'])).toBe(true);
    // Joined with `|`, two rows are never empty.
    expect(lazyRenderRowsInert(['', ''])).toBe(false);
    expect(lazyRenderRowsInert(['0', '0'])).toBe(false);
    expect(lazyRenderRowsInert(['a'])).toBe(false);
  });

  it('flags an empty row only in a set that is not inert', () => {
    expect(isMatchAllLazyRenderRow('', [''])).toBe(false);
    expect(isMatchAllLazyRenderRow('', ['', 'zzz'])).toBe(true);
    expect(isMatchAllLazyRenderRow('', ['', ''])).toBe(true);
    expect(isMatchAllLazyRenderRow('', ['0', ''])).toBe(true);
    expect(isMatchAllLazyRenderRow('0', ['0', ''])).toBe(false);
    expect(isMatchAllLazyRenderRow(' ', [' ', 'a'])).toBe(false);
  });
});

describe('asciiLowerCase', () => {
  it('folds A–Z only, leaving every other character as is', () => {
    expect(asciiLowerCase('ID="B" ÉTÉ İ ß')).toBe('id="b" ÉtÉ İ ß');
    expect(asciiLowerCase('')).toBe('');
  });
});
