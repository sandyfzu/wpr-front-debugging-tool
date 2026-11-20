/** The detail layout rule and its CSS twin. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clampPaneWidth,
  DETAIL_LIST_MIN_WIDTH,
  DETAIL_PANE_DEFAULT_SHARE,
  DETAIL_PANE_KEY_STEP,
  DETAIL_PANE_MIN_CONTENT_WIDTH,
  DETAIL_PANE_MIN_WIDTH,
  detailLayout,
  isPaneShare,
  paneShareOf,
  paneWidth,
  paneWidthAfterDrag,
  paneWidthAfterMove,
  paneWidthBounds,
  splitterMove
} from './detail-layout';
import { LIST_REGULAR_MIN_CONTENT_WIDTH } from './list-tier';

describe('detailLayout (content width → pane | drill)', () => {
  it('splits at the declared threshold (UI bar L-1 `@split`: 830 px = list floor + pane floor)', () => {
    expect(DETAIL_PANE_MIN_CONTENT_WIDTH).toBe(830);
    expect(DETAIL_PANE_MIN_WIDTH).toBe(350);
    // The list beside a pane keeps its regular tier (one declaring site).
    expect(DETAIL_LIST_MIN_WIDTH).toBe(LIST_REGULAR_MIN_CONTENT_WIDTH);
    expect(DETAIL_LIST_MIN_WIDTH + DETAIL_PANE_MIN_WIDTH).toBe(DETAIL_PANE_MIN_CONTENT_WIDTH);
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

describe('paneWidthBounds', () => {
  it.each([
    [830, 350, 350],
    [830.6, 350, 350],
    [1000, 350, 520],
    [1000.9, 350, 520],
    [1844, 350, 1364]
  ])('%d px content → %d…%d', (width, min, max) => {
    expect(paneWidthBounds(width)).toEqual({ min, max });
  });

  it('never lets max drop under min (drill widths, a hidden list)', () => {
    expect(paneWidthBounds(0)).toEqual({ min: 350, max: 350 });
    expect(paneWidthBounds(600)).toEqual({ min: 350, max: 350 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects %d naming the input', (width) => {
    expect(() => paneWidthBounds(width)).toThrow(/paneWidthBounds.*content width/);
  });
});

describe('clampPaneWidth', () => {
  it.each([
    [100, 1200, 350],
    [349.4, 1200, 350],
    [500.4, 1200, 500],
    [500.5, 1200, 501],
    [719, 1200, 719],
    [720, 1200, 720],
    [900, 1200, 720],
    [500, 830, 350]
  ])('%d px in %d px content → %d', (width, content, expected) => {
    expect(clampPaneWidth(width, content)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects a non-finite width (%d)',
    (width) => {
      expect(() => clampPaneWidth(width, 1200)).toThrow(RangeError);
    }
  );
});

describe('isPaneShare', () => {
  it('accepts finite numbers strictly inside (0, 1)', () => {
    for (const share of [0.0001, 0.25, DETAIL_PANE_DEFAULT_SHARE, 0.9999]) {
      expect(isPaneShare(share)).toBe(true);
    }
  });

  it('refuses the ends, out-of-range, non-finite and non-number values', () => {
    for (const value of [
      0,
      1,
      -0.5,
      1.5,
      Number.NaN,
      Infinity,
      '0.5',
      null,
      undefined,
      {},
      [0.5]
    ]) {
      expect(isPaneShare(value)).toBe(false);
    }
  });
});

describe('paneWidth (content width × share, clamped)', () => {
  it('grows with the content width at the default share', () => {
    expect(paneWidth(830, DETAIL_PANE_DEFAULT_SHARE)).toBe(350);
    expect(paneWidth(960, DETAIL_PANE_DEFAULT_SHARE)).toBe(480);
    expect(paneWidth(1204, DETAIL_PANE_DEFAULT_SHARE)).toBe(602);
    expect(paneWidth(1844, DETAIL_PANE_DEFAULT_SHARE)).toBe(922);
  });

  it('re-clamps a stored share on a narrower panel without changing it', () => {
    // 0.8 of 1000 would leave the list 200 px: the list floor wins.
    expect(paneWidth(1000, 0.8)).toBe(1000 - DETAIL_LIST_MIN_WIDTH);
    // 0.1 of 1800 would be 180 px: the pane floor wins.
    expect(paneWidth(1800, 0.1)).toBe(DETAIL_PANE_MIN_WIDTH);
  });

  it.each([0, 1, Number.NaN, -0.2, 2])('rejects a share outside (0, 1): %d', (share) => {
    expect(() => paneWidth(1200, share)).toThrow(/paneWidth: share/);
  });

  it('rejects a bad content width', () => {
    expect(() => paneWidth(-1, 0.5)).toThrow(RangeError);
  });
});

describe('paneShareOf', () => {
  it('is the inverse of paneWidth inside the bounds', () => {
    const share = paneShareOf(600, 1200);
    expect(share).toBe(0.5);
    expect(paneWidth(1200, share)).toBe(600);
  });

  it.each([0, -1, Number.NaN, Infinity])('rejects a content width of %d', (content) => {
    expect(() => paneShareOf(300, content)).toThrow(/content width/);
  });

  it.each([0, 1200, 1300, -5, Number.NaN])(
    'rejects a width of %d outside (0, content)',
    (width) => {
      expect(() => paneShareOf(width, 1200)).toThrow(RangeError);
    }
  );
});

describe('the splitter keys', () => {
  it('maps ←/→/Home/End and ignores every other key', () => {
    expect(splitterMove('ArrowLeft')).toBe('grow');
    expect(splitterMove('ArrowRight')).toBe('shrink');
    expect(splitterMove('Home')).toBe('min');
    expect(splitterMove('End')).toBe('max');
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'PageUp', 'a', '']) {
      expect(splitterMove(key)).toBeNull();
    }
  });

  it('steps by one key step and holds at the bounds', () => {
    expect(paneWidthAfterMove('grow', 500, 1200)).toBe(500 + DETAIL_PANE_KEY_STEP);
    expect(paneWidthAfterMove('shrink', 500, 1200)).toBe(500 - DETAIL_PANE_KEY_STEP);
    expect(paneWidthAfterMove('grow', 715, 1200)).toBe(720);
    expect(paneWidthAfterMove('shrink', 355, 1200)).toBe(350);
    expect(paneWidthAfterMove('min', 600, 1200)).toBe(350);
    expect(paneWidthAfterMove('max', 400, 1200)).toBe(720);
  });

  it('has no room at the split width (both bounds are the floor)', () => {
    for (const move of ['grow', 'shrink', 'min', 'max'] as const) {
      expect(paneWidthAfterMove(move, 350, 830)).toBe(350);
    }
  });
});

describe('paneWidthAfterDrag', () => {
  it('grows the pane as the pointer moves left and shrinks it moving right, clamped', () => {
    expect(paneWidthAfterDrag(500, -100, 1200)).toBe(600);
    expect(paneWidthAfterDrag(500, 100, 1200)).toBe(400);
    expect(paneWidthAfterDrag(500, -1000, 1200)).toBe(720);
    expect(paneWidthAfterDrag(500, 1000, 1200)).toBe(350);
    expect(paneWidthAfterDrag(500, 0.4, 1200)).toBe(500);
  });

  it('re-clamps against the current content width (a panel resized mid-drag)', () => {
    expect(paneWidthAfterDrag(700, 0, 1000)).toBe(520);
  });

  it('rejects a non-finite travel', () => {
    expect(() => paneWidthAfterDrag(500, Number.NaN, 1200)).toThrow(RangeError);
  });
});
