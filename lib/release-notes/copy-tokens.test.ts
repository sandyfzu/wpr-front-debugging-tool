/**
 * Copy placeholders: found in order, filled when known, left visible when not.
 */
import { describe, expect, it } from 'vitest';
import { fillTokens, tokensIn } from './copy-tokens';

const VALUES = { paletteShortcut: 'Alt+K', devtoolsShortcut: 'F12' } as const;

describe('tokensIn', () => {
  it('lists every placeholder in order, known or not', () => {
    expect(tokensIn('Press {paletteShortcut} or {devtoolsShortcut}, not {other}')).toEqual([
      'paletteShortcut',
      'devtoolsShortcut',
      'other'
    ]);
    expect(tokensIn('No tokens here, {not one} {1}')).toEqual([]);
  });
});

describe('fillTokens', () => {
  it('fills known tokens, every occurrence', () => {
    expect(fillTokens('{paletteShortcut} then {paletteShortcut}; {devtoolsShortcut}', VALUES)).toBe(
      'Alt+K then Alt+K; F12'
    );
  });

  it('leaves unknown tokens as written', () => {
    expect(fillTokens('Press {unknown}', VALUES)).toBe('Press {unknown}');
  });

  it('returns plain text unchanged', () => {
    expect(fillTokens('Plain', VALUES)).toBe('Plain');
  });
});
