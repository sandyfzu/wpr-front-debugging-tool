/** The detail layout rule and its CSS twin. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DETAIL_PANE_MIN_CONTENT_WIDTH, detailLayout } from './detail-layout';

describe('detailLayout (content width → pane | drill)', () => {
  it('splits at the declared threshold (UI bar L-1 `@split`: 830 px)', () => {
    expect(DETAIL_PANE_MIN_CONTENT_WIDTH).toBe(830);
  });

  it.each([
    [0, 'drill'],
    [268, 'drill'],
    [829, 'drill'],
    [829.99, 'drill'],
    [830, 'pane'],
    [830.01, 'pane'],
    [1280, 'pane'],
    [Number.MAX_SAFE_INTEGER, 'pane']
  ] as const)('%d px → %s', (width, layout) => {
    expect(detailLayout(width)).toBe(layout);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5])(
    'rejects a measuring bug (%d) naming the input',
    (width) => {
      expect(() => detailLayout(width)).toThrow(RangeError);
      expect(() => detailLayout(width)).toThrow(String(width));
    }
  );
});

describe('the CSS twin', () => {
  it('declares `--container-split` once in theme.css, equal to the JS threshold', () => {
    // Container conditions compile to literals, so the `@split:` variant can
    // never read the constant: this pin is what keeps the two rules one rule.
    const css = readFileSync(join(process.cwd(), 'assets', 'css', 'theme.css'), 'utf8');
    const declarations = [...css.matchAll(/--container-split:\s*([^;]+);/g)].map((m) => m[1]);
    expect(declarations).toEqual([`${String(DETAIL_PANE_MIN_CONTENT_WIDTH)}px`]);
  });
});
