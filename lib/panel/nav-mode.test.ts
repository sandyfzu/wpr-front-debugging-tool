/**
 * The nav form rule: the full truth table (pin × detail × width band),
 * boundaries at both thresholds, input validation, the toggle's pin
 * choice (always the opposite form, handed back to `auto` when the rule
 * agrees) and the L-1 prose pin.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOP_BAR_FULL_MIN_WIDTH } from './top-bar-layout';
import {
  NAV_PIN_DEFAULT,
  NAV_PINS,
  SIDEBAR_LABELED_MIN_WIDTH,
  isNavPin,
  navMode,
  navToggleAvailable,
  toggledNavPin,
  type NavForm,
  type NavPin
} from './nav-mode';

/** One width per band: unmeasured, under the top-bar threshold, between, from 1080. */
const BANDS = {
  zero: 0,
  narrow: TOP_BAR_FULL_MIN_WIDTH - 1,
  mid: SIDEBAR_LABELED_MIN_WIDTH - 1,
  wide: SIDEBAR_LABELED_MIN_WIDTH
} as const;

type Band = keyof typeof BANDS;

/** Expected form per pin → detail open → band. */
const TRUTH: Record<NavPin, Record<'closed' | 'open', Record<Band, NavForm>>> = {
  auto: {
    closed: { zero: 'rail', narrow: 'rail', mid: 'rail', wide: 'labeled' },
    open: { zero: 'rail', narrow: 'rail', mid: 'rail', wide: 'rail' }
  },
  labeled: {
    closed: { zero: 'rail', narrow: 'rail', mid: 'labeled', wide: 'labeled' },
    open: { zero: 'rail', narrow: 'rail', mid: 'labeled', wide: 'labeled' }
  },
  rail: {
    closed: { zero: 'rail', narrow: 'rail', mid: 'rail', wide: 'rail' },
    open: { zero: 'rail', narrow: 'rail', mid: 'rail', wide: 'rail' }
  }
};

describe('navMode', () => {
  it('follows the full truth table', () => {
    for (const pinned of NAV_PINS) {
      for (const detail of ['closed', 'open'] as const) {
        for (const band of Object.keys(BANDS) as Band[]) {
          expect(
            navMode({ shellWidth: BANDS[band], pinned, detailOpen: detail === 'open' }),
            `${pinned} / ${detail} / ${band}`
          ).toBe(TRUTH[pinned][detail][band]);
        }
      }
    }
  });

  it('switches auto exactly at the sidebar threshold (fractions included)', () => {
    const at = (shellWidth: number): NavForm =>
      navMode({ shellWidth, pinned: 'auto', detailOpen: false });
    expect(SIDEBAR_LABELED_MIN_WIDTH).toBe(1080);
    expect(at(1079)).toBe('rail');
    expect(at(1079.99)).toBe('rail');
    expect(at(1080)).toBe('labeled');
    expect(at(4000)).toBe('labeled');
  });

  it('holds a pinned labeled form down to the top bar threshold, never below', () => {
    const at = (shellWidth: number): NavForm =>
      navMode({ shellWidth, pinned: 'labeled', detailOpen: true });
    expect(at(TOP_BAR_FULL_MIN_WIDTH)).toBe('labeled');
    expect(at(TOP_BAR_FULL_MIN_WIDTH - 0.5)).toBe('rail');
  });

  it('rejects a broken width instead of picking a form', () => {
    for (const shellWidth of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => navMode({ shellWidth, pinned: 'auto', detailOpen: false })).toThrow(RangeError);
    }
  });
});

describe('isNavPin', () => {
  it('accepts the three pins only', () => {
    for (const pin of NAV_PINS) expect(isNavPin(pin)).toBe(true);
    for (const other of ['', 'Auto', 'full', null, undefined, 0, {}, ['rail']]) {
      expect(isNavPin(other)).toBe(false);
    }
    expect(NAV_PIN_DEFAULT).toBe('auto');
  });
});

describe('navToggleAvailable', () => {
  it('is true from the top bar threshold on', () => {
    expect(navToggleAvailable(0)).toBe(false);
    expect(navToggleAvailable(TOP_BAR_FULL_MIN_WIDTH - 1)).toBe(false);
    expect(navToggleAvailable(TOP_BAR_FULL_MIN_WIDTH)).toBe(true);
    expect(() => navToggleAvailable(-5)).toThrow(RangeError);
  });
});

describe('toggledNavPin', () => {
  it('always renders the opposite form wherever the toggle is available', () => {
    for (const pinned of NAV_PINS) {
      for (const detailOpen of [false, true]) {
        for (const shellWidth of [TOP_BAR_FULL_MIN_WIDTH, BANDS.mid, BANDS.wide, 1600]) {
          const input = { shellWidth, pinned, detailOpen };
          const next = toggledNavPin(input);
          expect(
            navMode({ ...input, pinned: next }),
            `${pinned} / ${String(detailOpen)} / ${String(shellWidth)}`
          ).not.toBe(navMode(input));
        }
      }
    }
  });

  it('hands the nav back to auto when the rule already yields the target', () => {
    // Wide, no detail: auto shows labeled; collapse pins the rail, expand returns to auto.
    expect(toggledNavPin({ shellWidth: 1200, pinned: 'auto', detailOpen: false })).toBe('rail');
    expect(toggledNavPin({ shellWidth: 1200, pinned: 'rail', detailOpen: false })).toBe('auto');
    // Mid width: auto shows the rail; expand pins labeled, collapse returns to auto.
    expect(toggledNavPin({ shellWidth: 900, pinned: 'auto', detailOpen: false })).toBe('labeled');
    expect(toggledNavPin({ shellWidth: 900, pinned: 'labeled', detailOpen: false })).toBe('auto');
    // Wide with a detail open: auto folded; expand pins labeled over the fold.
    expect(toggledNavPin({ shellWidth: 1200, pinned: 'auto', detailOpen: true })).toBe('labeled');
    expect(toggledNavPin({ shellWidth: 1200, pinned: 'labeled', detailOpen: true })).toBe('auto');
  });
});

describe('UI bar L-1', () => {
  it('declares the sidebar threshold this module enforces', () => {
    const bar = readFileSync(join(process.cwd(), 'docs', 'ui-ux-bar.md'), 'utf8');
    const rule = bar.split('\n').find((line) => line.startsWith('- **L-1 '));
    expect(rule).toBeDefined();
    expect(rule).toContain(
      `sidebar labeled at shell width **≥ ${String(SIDEBAR_LABELED_MIN_WIDTH)} px**`
    );
  });
});
