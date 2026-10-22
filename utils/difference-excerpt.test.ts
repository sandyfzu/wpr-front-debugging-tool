import { describe, expect, it } from 'vitest';
import { differenceExcerpts } from './difference-excerpt';

describe('differenceExcerpts', () => {
  it('returns texts that fit whole', () => {
    expect(differenceExcerpts('a*', 'a(.*)', 10)).toEqual({ left: 'a*', right: 'a(.*)' });
  });

  it('cuts long texts around their first difference, same start for both', () => {
    const typed = 'https://example.com/wp-content/plugins/my-plugin/assets/js/script-*.min.js';
    const stored = 'https://example.com/wp-content/plugins/my-plugin/assets/js/script-(.*).min.js';
    const { left, right } = differenceExcerpts(stored, typed, 40, 8);
    expect(left).toBe('…/script-(.*).min.js');
    expect(right).toBe('…/script-*.min.js');
  });

  it('keeps the head when the difference is at the start, cutting the tail', () => {
    const tail = 'x'.repeat(50);
    expect(differenceExcerpts(`a${tail}`, `b${tail}`, 10, 3)).toEqual({
      left: `a${'x'.repeat(3)}…`,
      right: `b${'x'.repeat(3)}…`
    });
  });

  it('bounds a long difference to max code points', () => {
    const { left, right } = differenceExcerpts(
      'p'.repeat(30) + 'a'.repeat(100),
      'p'.repeat(30),
      20,
      5
    );
    expect(left).toBe(`…${'p'.repeat(5)}${'a'.repeat(15)}…`);
    expect(right).toBe(`…${'p'.repeat(5)}`);
  });

  it('handles a pure append and never splits a surrogate pair', () => {
    const base = '😀'.repeat(30);
    const { left, right } = differenceExcerpts(base, `${base}!`, 10, 2);
    expect(left).toBe('…😀😀');
    expect(right).toBe('…😀😀!');
  });

  it('refuses a bad bound, naming it', () => {
    expect(() => differenceExcerpts('a', 'b', -1)).toThrow(/max must be/);
    expect(() => differenceExcerpts('a', 'b', 1, 1.5)).toThrow(/context must be/);
  });
});
