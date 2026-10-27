import { describe, expect, it } from 'vitest';
import { escapeRegex } from './regex';

describe('escapeRegex', () => {
  it('escapes every metacharacter so the text matches only itself', () => {
    const literal = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    const pattern = new RegExp(`^${escapeRegex(literal)}$`);
    expect(pattern.test(literal)).toBe(true);
    expect(pattern.test(literal.replace('.', 'X'))).toBe(false);
  });

  it('keeps plain path text readable', () => {
    expect(escapeRegex('wp-content/plugins/x/app.min.js')).toBe(
      'wp-content/plugins/x/app\\.min\\.js'
    );
  });

  it('stays valid under the u flag', () => {
    expect(() => new RegExp(escapeRegex('a-b/c.d'), 'u')).not.toThrow();
  });
});
