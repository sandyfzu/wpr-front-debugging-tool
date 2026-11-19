/** The top bar's measured fold: priority order, boundaries, ties, hysteresis, the room. */
import { describe, expect, it } from 'vitest';
import {
  TOP_BAR_COMPACT_FOLDED,
  TOP_BAR_FOLD_HYSTERESIS_PX,
  TOP_BAR_FOLD_ORDER,
  foldTopBar,
  sameTopBarFold,
  topBarFoldRoom,
  type TopBarFold,
  type TopBarFoldInput,
  type TopBarFoldPart
} from './top-bar-fold';

/** Every part present, 10/20/30/40/50 px in drop order (distinct sums). */
const WIDTHS: Record<TopBarFoldPart, number> = {
  address: 10,
  server: 20,
  cacheAge: 30,
  freshness: 40,
  brand: 50
};

/** The "⋯" trigger's cost in these tests. */
const MENU = 7;

/** A full-width input: every part present, no previous decision. */
function input(room: number, overrides: Partial<TopBarFoldInput> = {}): TopBarFoldInput {
  return { room, widths: WIDTHS, menuWidth: MENU, compact: false, previous: null, ...overrides };
}

describe('foldTopBar (priority order)', () => {
  it('declares the drop order once: address, server, cache age, freshness, brand', () => {
    expect(TOP_BAR_FOLD_ORDER).toEqual(['address', 'server', 'cacheAge', 'freshness', 'brand']);
  });

  it('shows everything without a menu while the sum fits (a tie fits)', () => {
    expect(foldTopBar(input(150))).toEqual({
      inline: ['address', 'server', 'cacheAge', 'freshness', 'brand'],
      folded: [],
      menu: false
    });
    expect(foldTopBar(input(1000)).menu).toBe(false);
  });

  // Each step folds one more part; the menu's own cost joins at the first fold.
  it.each([
    // [room, folded parts]
    [149, ['address']], // 140 + 7 = 147 fits
    [147, ['address']], // tie
    [146, ['address', 'server']], // 120 + 7
    [127, ['address', 'server']], // tie
    [126, ['address', 'server', 'cacheAge']], // 90 + 7
    [97, ['address', 'server', 'cacheAge']],
    [96, ['address', 'server', 'cacheAge', 'freshness']], // 50 + 7
    [57, ['address', 'server', 'cacheAge', 'freshness']],
    [56, ['address', 'server', 'cacheAge', 'freshness', 'brand']], // 0 + 7
    [7, ['address', 'server', 'cacheAge', 'freshness', 'brand']],
    [6, ['address', 'server', 'cacheAge', 'freshness', 'brand']], // nothing fits: the floor
    [-40, ['address', 'server', 'cacheAge', 'freshness', 'brand']]
  ] as const)('room %d px folds %j, in order, with the menu', (room, folded) => {
    const fold = foldTopBar(input(room));
    expect(fold.folded).toEqual(folded);
    const held: readonly TopBarFoldPart[] = folded;
    expect(fold.inline).toEqual(TOP_BAR_FOLD_ORDER.filter((part) => !held.includes(part)));
    expect(fold.menu).toBe(true);
  });

  it('folds a cheap part rather than nothing even when the menu costs more than it saves', () => {
    // address (10) alone over-fills by 3 px; folding it needs the 12 px menu:
    // 0 + 12 > 9 — no fold fits, so it folds (the floor), never overflows.
    expect(foldTopBar(input(9, { widths: { address: 10 }, menuWidth: 12 }))).toEqual({
      inline: [],
      folded: ['address'],
      menu: true
    });
  });

  it('skips a costly first fold when a later one fits (fewest drops that fit)', () => {
    // Inline: 45 > 40. Dropping address (5) alone needs the 30 px menu:
    // 40 + 30 > 40. Dropping address + server: 0 + 30 ≤ 40.
    expect(
      foldTopBar(input(40, { widths: { address: 5, server: 40 }, menuWidth: 30 })).folded
    ).toEqual(['address', 'server']);
  });

  it('treats equal widths by order alone (ties fold the earlier part)', () => {
    const fold = foldTopBar(input(28, { widths: { server: 20, freshness: 20 }, menuWidth: 8 }));
    expect(fold.folded).toEqual(['server']);
    expect(fold.inline).toEqual(['freshness']);
  });

  it('leaves absent parts out of both lists (nothing to show is never "folded")', () => {
    const fold = foldTopBar(input(0, { widths: { cacheAge: 30 } }));
    expect(fold).toEqual({ inline: [], folded: ['cacheAge'], menu: true });
    expect(foldTopBar(input(0, { widths: {} }))).toEqual({ inline: [], folded: [], menu: false });
  });

  it('counts a zero-width part as present (inline for free)', () => {
    expect(foldTopBar(input(0, { widths: { address: 0 } }))).toEqual({
      inline: ['address'],
      folded: [],
      menu: false
    });
  });
});

describe('foldTopBar (compact bar)', () => {
  it('folds the four secondaries by rule; the brand stays measured', () => {
    expect([...TOP_BAR_COMPACT_FOLDED]).toEqual(['address', 'server', 'cacheAge', 'freshness']);
    // The menu is already laid out (fixed): the brand needs only its width.
    expect(foldTopBar(input(50, { compact: true }))).toEqual({
      inline: ['brand'],
      folded: ['address', 'server', 'cacheAge', 'freshness'],
      menu: true
    });
    expect(foldTopBar(input(49, { compact: true })).inline).toEqual([]);
  });

  it('folds the four secondaries by rule even with room for every part', () => {
    // 1000 px fits all five: only the rule, never the room, folds these.
    expect(foldTopBar(input(1000, { compact: true }))).toEqual({
      inline: ['brand'],
      folded: ['address', 'server', 'cacheAge', 'freshness'],
      menu: true
    });
  });

  it('keeps the menu with nothing to fold', () => {
    expect(foldTopBar(input(500, { compact: true, widths: {} }))).toEqual({
      inline: [],
      folded: [],
      menu: true
    });
  });
});

describe('foldTopBar (hysteresis)', () => {
  /** The decision a layout reflects after folding `parts`. */
  function laidOut(...parts: TopBarFoldPart[]): TopBarFold {
    return {
      inline: TOP_BAR_FOLD_ORDER.filter((part) => !parts.includes(part)),
      folded: parts,
      menu: parts.length > 0
    };
  }

  it('returns a folded part only with the margin to spare', () => {
    const previous = laidOut('address');
    // The exact fit (150) is not enough to bring the address back…
    expect(foldTopBar(input(150, { previous })).folded).toEqual(['address']);
    expect(foldTopBar(input(150 + TOP_BAR_FOLD_HYSTERESIS_PX - 0.5, { previous })).folded).toEqual([
      'address'
    ]);
    // …the margin is.
    expect(foldTopBar(input(150 + TOP_BAR_FOLD_HYSTERESIS_PX, { previous })).folded).toEqual([]);
  });

  it('brings back as many parts as the margin allows, in reverse order', () => {
    const previous = laidOut('address', 'server', 'cacheAge');
    // 127 fits address-folded+menu exactly (no margin), 129 with the margin.
    expect(foldTopBar(input(128, { previous })).folded).toEqual(['address', 'server', 'cacheAge']);
    expect(foldTopBar(input(129, { previous })).folded).toEqual(['address', 'server']);
    expect(foldTopBar(input(149, { previous })).folded).toEqual(['address']);
  });

  it('brings every part back from the floor once the room returns', () => {
    const previous = laidOut('address', 'server', 'cacheAge', 'freshness', 'brand');
    expect(foldTopBar(input(1000, { previous }))).toEqual({
      inline: [...TOP_BAR_FOLD_ORDER],
      folded: [],
      menu: false
    });
  });

  it('never keeps a fold that no longer fits; it shows more instead', () => {
    // Inline: 45 fits 45 exactly. Keeping the address folded would need the
    // 30 px menu (40 + 30 > 45), and the margin is not there to show more:
    // the fit wins over the margin.
    const fold = foldTopBar(
      input(45, {
        widths: { address: 5, server: 40 },
        menuWidth: 30,
        previous: { inline: ['server'], folded: ['address'], menu: true }
      })
    );
    expect(fold).toEqual({ inline: ['address', 'server'], folded: [], menu: false });
  });

  it('folds at once when the room shrinks (no margin on the way down)', () => {
    expect(foldTopBar(input(146, { previous: laidOut() })).folded).toEqual(['address', 'server']);
  });

  it('decides afresh when a part new since the last decision leads the order', () => {
    // The address mounted inline after the decision that folded freshness:
    // the layout no longer matches it, so the exact fit wins (no margin).
    const previous: TopBarFold = { inline: ['brand'], folded: ['freshness'], menu: true };
    const fold = foldTopBar(
      input(100, { widths: { address: 10, freshness: 40, brand: 50 }, menuWidth: 8, previous })
    );
    expect(fold).toEqual({ inline: ['address', 'freshness', 'brand'], folded: [], menu: false });
  });
});

describe('foldTopBar (inputs)', () => {
  it.each([
    ['room', input(Number.NaN)],
    ['menuWidth', input(10, { menuWidth: -1 })],
    ['menuWidth', input(10, { menuWidth: Number.POSITIVE_INFINITY })],
    ['width of "server"', input(10, { widths: { server: -2 } })],
    ['width of "brand"', input(10, { widths: { brand: Number.NaN } })]
  ] as const)('rejects a measuring bug in %s, naming it', (name, bad) => {
    expect(() => foldTopBar(bad)).toThrow(RangeError);
    expect(() => foldTopBar(bad)).toThrow(name);
  });
});

describe('topBarFoldRoom', () => {
  it('adds back what the laid-out parts and menu take', () => {
    expect(
      topBarFoldRoom({ free: 12, inlineCost: 50, menuShown: true, menuWidth: 30, compact: false })
    ).toBe(92);
    expect(
      topBarFoldRoom({ free: -8, inlineCost: 50, menuShown: false, menuWidth: 30, compact: false })
    ).toBe(42);
  });

  it('never spends the compact bar’s fixed menu', () => {
    expect(
      topBarFoldRoom({ free: 12, inlineCost: 0, menuShown: true, menuWidth: 30, compact: true })
    ).toBe(12);
  });

  it('yields the same room for both sides of a fold (a stable decision)', () => {
    // Inline: 4 px free with the 40 px part laid out; folded: the part's 40
    // px freed, the 30 px menu laid out instead.
    const inline = topBarFoldRoom({
      free: 4,
      inlineCost: 40,
      menuShown: false,
      menuWidth: 30,
      compact: false
    });
    const folded = topBarFoldRoom({
      free: 14,
      inlineCost: 0,
      menuShown: true,
      menuWidth: 30,
      compact: false
    });
    expect(inline).toBe(folded);
  });

  it.each([
    ['free', { free: Number.NaN, inlineCost: 0, menuShown: false, menuWidth: 0, compact: false }],
    ['inlineCost', { free: 0, inlineCost: -1, menuShown: false, menuWidth: 0, compact: false }],
    ['menuWidth', { free: 0, inlineCost: 0, menuShown: false, menuWidth: -3, compact: false }]
  ] as const)('rejects a measuring bug in %s', (name, bad) => {
    expect(() => topBarFoldRoom(bad)).toThrow(name);
  });
});

describe('sameTopBarFold', () => {
  const a: TopBarFold = { inline: ['brand'], folded: ['address'], menu: true };
  it.each([
    [a, { inline: ['brand'], folded: ['address'], menu: true }, true],
    [a, { inline: ['brand'], folded: ['address'], menu: false }, false],
    [a, { inline: [], folded: ['address', 'brand'], menu: true }, false],
    [a, { inline: ['server'], folded: ['address'], menu: true }, false],
    [a, { inline: ['brand'], folded: ['server'], menu: true }, false],
    [a, null, false],
    [null, null, true]
  ] as const)('%j vs %j → %s', (left, right, same) => {
    expect(sameTopBarFold(left, right)).toBe(same);
  });
});
