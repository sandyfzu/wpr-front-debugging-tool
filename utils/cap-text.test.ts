import { describe, expect, it } from 'vitest';
import { capText, capTitle, TITLE_MAX } from './cap-text';

describe('capText', () => {
  it.each([
    ['', 0, ''],
    ['a', 0, '…'],
    ['ab', 3, 'ab'],
    ['ab', 2, 'ab'],
    ['abc', 2, 'ab…'],
    ['a😀b', 2, 'a😀…'],
    ['😀😀', 2, '😀😀'],
    ['e\u0301x', 2, 'e\u0301…']
  ])('caps %j at %i code points', (text, max, expected) => {
    expect(capText(text, max)).toBe(expected);
  });

  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid limit %s',
    (max) => {
      expect(() => capText('text', max)).toThrow(RangeError);
      expect(() => capText('text', max)).toThrow(String(max));
    }
  );
});

describe('capTitle', () => {
  it.each([0, 1, 299, 300, 301])('preserves or caps %i emoji code points', (length) => {
    const text = '😀'.repeat(length);
    const expected = length > 300 ? `${'😀'.repeat(300)}…` : text;
    expect(TITLE_MAX).toBe(300);
    expect(capTitle(text)).toBe(expected);
    expect(capTitle(text).isWellFormed()).toBe(true);
  });

  it('bounds a large data URL without changing its source', () => {
    const text = `data:image/svg+xml,${'x'.repeat(100000)}`;
    expect(capTitle(text)).toBe(`${text.slice(0, 300)}…`);
    expect(text).toHaveLength(100019);
  });
});
