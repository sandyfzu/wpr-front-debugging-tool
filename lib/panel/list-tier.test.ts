/** The list tier rule and its CSS twin. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIST_REGULAR_MIN_CONTENT_WIDTH, listTier } from './list-tier';

describe('listTier (content width → compact | regular)', () => {
  it('splits at the declared threshold (UI bar L-1 `@regular`: 480 px)', () => {
    expect(LIST_REGULAR_MIN_CONTENT_WIDTH).toBe(480);
  });

  it.each([
    [0, 'compact'],
    [268, 'compact'],
    [479.99, 'compact'],
    [480, 'regular'],
    [830, 'regular'],
    [Number.MAX_SAFE_INTEGER, 'regular']
  ] as const)('%d px → %s', (width, tier) => {
    expect(listTier(width)).toBe(tier);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'rejects a measuring bug (%d) naming the input',
    (width) => {
      expect(() => listTier(width)).toThrow(RangeError);
      expect(() => listTier(width)).toThrow(String(width));
    }
  );
});

describe('the CSS twin', () => {
  it('declares `--container-regular` once in theme.css, equal to the JS threshold', () => {
    const css = readFileSync(join(process.cwd(), 'assets', 'css', 'theme.css'), 'utf8');
    const declarations = [...css.matchAll(/--container-regular:\s*([^;]+);/g)].map((m) => m[1]);
    expect(declarations).toEqual([`${String(LIST_REGULAR_MIN_CONTENT_WIDTH)}px`]);
  });
});
