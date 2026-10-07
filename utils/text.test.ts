import { describe, expect, it } from 'vitest';
import { capitalize } from './text';

describe('capitalize', () => {
  it('uppercases the first character, preserving the rest', () => {
    expect(capitalize('wpr')).toBe('Wpr');
    expect(capitalize('delay js')).toBe('Delay js');
    expect(capitalize('ALREADY uppercase')).toBe('ALREADY uppercase');
  });

  it('leaves an empty string empty', () => {
    expect(capitalize('')).toBe('');
  });

  it('treats leading whitespace as the first character (parity with the ported algorithm)', () => {
    expect(capitalize(' value')).toBe(' value');
  });
});
