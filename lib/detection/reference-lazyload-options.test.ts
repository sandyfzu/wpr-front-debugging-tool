/**
 * The reference engine's options-blob regexes against the port's linear
 * scanner: the same rule, two independent readings.
 */
import { describe, expect, it } from 'vitest';
import { LAZYLOAD_IFRAME_SELECTOR, LAZYLOAD_IMG_SELECTOR } from '../wp-rocket/constants';
import { hasLazyloadOptions } from '../wp-rocket/lazyload-options';
import { LAZYLOAD_IFRAME_OPTIONS_PATTERN, LAZYLOAD_IMG_OPTIONS_PATTERN } from './reference/engine';

const IMG = [LAZYLOAD_IMG_SELECTOR];
const IFRAME = [LAZYLOAD_IFRAME_SELECTOR];

describe('reference options-blob patterns', () => {
  it.each([
    ['minified', 'window.lazyLoadOptions=[{elements_selector:"img[data-lazy-src]"}]', true],
    ['readable', 'window.lazyLoadOptions = [{\n    elements_selector: "img[data-lazy-src]"', true],
    ['a property of the global', 'window.lazyLoadOptions.img = "img[data-lazy-src]"', false],
    ['the selector below a value', 'window.lazyLoadOptions={}\nimg[data-lazy-src]', false]
  ])('reads the %s form', (_name, text, expected) => {
    expect(LAZYLOAD_IMG_OPTIONS_PATTERN.test(text)).toBe(expected);
  });

  it('reads the iframe selector on its own pattern', () => {
    const text = 'window.lazyLoadOptions={...};iframe[data-lazy-src]{...}';
    expect(LAZYLOAD_IFRAME_OPTIONS_PATTERN.test(text)).toBe(true);
    expect(LAZYLOAD_IMG_OPTIONS_PATTERN.test(text)).toBe(false);
  });

  it('agree with the port scanner over a seeded random corpus', () => {
    const tokens = [
      'window.lazyLoadOptions',
      'window.lazyLoadOptionsX',
      '=',
      '==',
      ' ',
      '\t',
      '\n',
      '\r',
      '\u2028',
      '[',
      '{',
      '}',
      ';',
      'x',
      '.img',
      LAZYLOAD_IMG_SELECTOR,
      LAZYLOAD_IFRAME_SELECTOR
    ];
    // Deterministic LCG: a failure reproduces on every run.
    let seed = 0x2024;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    let matches = 0;
    for (let sample = 0; sample < 5000; sample += 1) {
      const length = 1 + (next() % 14);
      const text = Array.from({ length }, () => tokens[next() % tokens.length]).join('');
      const img = hasLazyloadOptions(text, IMG);
      expect(img, JSON.stringify(text)).toBe(LAZYLOAD_IMG_OPTIONS_PATTERN.test(text));
      expect(hasLazyloadOptions(text, IFRAME), JSON.stringify(text)).toBe(
        LAZYLOAD_IFRAME_OPTIONS_PATTERN.test(text)
      );
      if (img) matches += 1;
    }
    // The corpus must exercise both outcomes, or the agreement proves nothing.
    expect(matches).toBeGreaterThan(25);
    expect(matches).toBeLessThan(4950);
  });
});
