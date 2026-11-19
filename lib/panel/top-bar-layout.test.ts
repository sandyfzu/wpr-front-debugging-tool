/** The top bar's width rule and its documented threshold. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOP_BAR_FULL_MIN_WIDTH, topBarLayout, type TopBarLayout } from './top-bar-layout';

/** Every part inline. */
const FULL: TopBarLayout = {
  showName: true,
  showExclusionsLabel: true,
  overflow: false
};

/** Name and the Exclusions label folded into "⋯", short forms. */
const COMPACT: TopBarLayout = {
  showName: false,
  showExclusionsLabel: false,
  overflow: true
};

describe('topBarLayout (panel width → what shows inline)', () => {
  it('folds below the declared threshold (UI bar L-1: 760 px)', () => {
    expect(TOP_BAR_FULL_MIN_WIDTH).toBe(760);
  });

  it.each([
    [0, COMPACT],
    [319, COMPACT],
    [320, COMPACT],
    [759, COMPACT],
    [759.99, COMPACT],
    [760, FULL],
    [760.01, FULL],
    [1079, FULL],
    [1080, FULL],
    [Number.MAX_SAFE_INTEGER, FULL]
  ] as const)('%d px', (width, layout) => {
    expect(topBarLayout(width)).toEqual(layout);
  });

  it('returns frozen shared answers (callers can compare by identity, never mutate)', () => {
    expect(topBarLayout(100)).toBe(topBarLayout(500));
    expect(topBarLayout(800)).toBe(topBarLayout(2000));
    expect(Object.isFrozen(topBarLayout(100))).toBe(true);
    expect(Object.isFrozen(topBarLayout(800))).toBe(true);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5])(
    'rejects a measuring bug (%d) naming the input',
    (width) => {
      expect(() => topBarLayout(width)).toThrow(RangeError);
      expect(() => topBarLayout(width)).toThrow(String(width));
    }
  );
});

describe('the declaring doc', () => {
  it('UI bar L-1 states the same threshold the code uses', () => {
    // The bar is the value's documented site; this pin keeps the prose and
    // the constant one rule (a recalibration must move both).
    const bar = readFileSync(join(process.cwd(), 'docs', 'ui-ux-bar.md'), 'utf8');
    const rule = bar.split('\n').find((line) => line.startsWith('- **L-1 '));
    expect(rule).toBeDefined();
    expect(rule).toContain(
      `top bar at full width from a **${String(TOP_BAR_FULL_MIN_WIDTH)} px** panel`
    );
  });
});
