/** Unit tests for the WCAG contrast math. */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#000000', '#000000')).toBe(1);
  });

  it('is symmetric for opaque colors and case-insensitive', () => {
    expect(contrastRatio('#4F46E5', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#4f46e5'),
      10
    );
  });

  it('composites a translucent foreground over the background first', () => {
    // Fully transparent = the background itself; half white over black = #808080-ish.
    expect(contrastRatio('#ffffff00', '#123456')).toBe(1);
    expect(contrastRatio('#ffffff80', '#000000')).toBeCloseTo(
      contrastRatio('#808080', '#000000'),
      1
    );
  });

  it('throws naming a malformed color or a translucent background', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow('"#fff" is not a #rrggbb');
    expect(() => contrastRatio('red', '#000000')).toThrow('"red"');
    expect(() => contrastRatio('#000000', '#ffffff80')).toThrow('"#ffffff80" must be opaque');
  });
});
