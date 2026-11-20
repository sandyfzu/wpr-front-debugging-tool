/** The detail code wrap rule. */
import { describe, expect, it } from 'vitest';
import { DETAIL_WRAP_MIN_LINE_LENGTH, opensWrapped } from './detail-code';

const LIMIT = DETAIL_WRAP_MIN_LINE_LENGTH;

describe('opensWrapped', () => {
  it('keeps short and formatted code unwrapped', () => {
    expect(opensWrapped('')).toBe(false);
    expect(opensWrapped('window.a = 1;')).toBe(false);
    expect(opensWrapped('a\n\nb\n')).toBe(false);
    expect(opensWrapped(Array.from({ length: 500 }, () => 'x'.repeat(80)).join('\n'))).toBe(false);
  });

  it('wraps a line just past the limit, never one at it', () => {
    expect(opensWrapped('x'.repeat(LIMIT))).toBe(false);
    expect(opensWrapped('x'.repeat(LIMIT + 1))).toBe(true);
  });

  it('finds a long line anywhere: first, middle, last, after a trailing newline-free end', () => {
    const long = 'y'.repeat(LIMIT + 1);
    expect(opensWrapped(`${long}\nshort`)).toBe(true);
    expect(opensWrapped(`short\n${long}\nshort`)).toBe(true);
    expect(opensWrapped(`short\nshort\n${long}`)).toBe(true);
  });

  it('measures each line on its own (a newline right at the limit is not one long line)', () => {
    expect(opensWrapped(`${'a'.repeat(LIMIT)}\n${'b'.repeat(LIMIT)}`)).toBe(false);
  });

  it('wraps a minified one-liner of any size', () => {
    expect(opensWrapped('(()=>{'.repeat(40_000))).toBe(true);
  });
});
