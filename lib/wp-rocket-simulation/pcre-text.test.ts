/** PCRE's `\s` (no UTF) and ASCII-caseless literals, as the scanners test them. */
import { describe, expect, it } from 'vitest';
import { asciiCaselessAt, isSpaceAt, skipSpaces, skipSpacesBack } from './pcre-text';

describe('isSpaceAt / skipSpaces / skipSpacesBack', () => {
  it('reads exactly tab, LF, VT, FF, CR and space as `\\s`', () => {
    expect(['\t', '\n', '\v', '\f', '\r', ' '].every((char) => isSpaceAt(char, 0))).toBe(true);
    for (const char of ['\u0085', ' ', ' ', 'a', '\0']) {
      expect(isSpaceAt(char, 0), JSON.stringify(char)).toBe(false);
    }
  });

  it('is false out of range', () => {
    expect([isSpaceAt(' ', -1), isSpaceAt(' ', 1)]).toEqual([false, false]);
  });

  it('skips a run forward and backward', () => {
    const text = 'a \t\nb\r\v c';
    expect(skipSpaces(text, 1)).toBe(4);
    expect(skipSpaces(text, 0)).toBe(0);
    expect(skipSpaces(text, 9)).toBe(9);
    expect(skipSpacesBack(text, 8)).toBe(5);
    expect(skipSpacesBack(text, 9)).toBe(9);
    expect(skipSpacesBack(text, 4)).toBe(1);
    expect(skipSpacesBack(text, 0)).toBe(0);
  });
});

describe('asciiCaselessAt', () => {
  it('folds ASCII letters only', () => {
    expect(asciiCaselessAt('xSCRIPT', 1, 'script')).toBe(true);
    expect(asciiCaselessAt('ScRiPt', 0, 'script')).toBe(true);
    // `@` is `` ` `` minus 0x20: never a letter's other case.
    expect(asciiCaselessAt('@', 0, '`')).toBe(false);
    // Non-ASCII never folds onto ASCII (U+017F uppercases to `S`).
    expect(asciiCaselessAt('ſcript', 0, 'script')).toBe(false);
  });

  it('is false past either end', () => {
    expect(asciiCaselessAt('scrip', 0, 'script')).toBe(false);
    expect(asciiCaselessAt('script', -1, 'script')).toBe(false);
  });
});
