import { describe, expect, it } from 'vitest';
import { asTypeLabel, preloadedInventory } from './preloaded-view';

describe('preloadedInventory', () => {
  it('reads an absent feature as "none" (the engine reports no list when nothing is preloaded)', () => {
    expect(preloadedInventory({ present: false })).toBe('none');
    expect(preloadedInventory({ present: false, resources: [] })).toBe('none');
  });

  it('reads a present feature without a list as "not collected"', () => {
    expect(preloadedInventory({ present: true })).toBe('not-collected');
  });

  it('reads an empty collected list as "none" and a non-empty one as rows', () => {
    expect(preloadedInventory({ present: true, resources: [] })).toBe('none');
    expect(
      preloadedInventory({ present: true, resources: [{ href: 'https://a/b', type: 'font' }] })
    ).toBe('rows');
  });
});

describe('asTypeLabel', () => {
  it.each([
    ['image', 'image'],
    ['IMAGE', 'image'],
    [' Font ', 'font'],
    ['', null],
    ['   ', null]
  ])('%j → %j', (type, expected) => {
    expect(asTypeLabel(type)).toBe(expected);
  });
});
