import { describe, expect, it } from 'vitest';
import {
  asTypeLabel,
  preloadedInventory,
  preloadedNotes,
  samePreloadedRow
} from './preloaded-view';

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

describe('samePreloadedRow', () => {
  it('compares URL and type', () => {
    const a = { id: 0, href: 'https://a/b', type: 'font' };
    expect(samePreloadedRow(a, { ...a })).toBe(true);
    expect(samePreloadedRow(a, { ...a, href: 'https://a/c' })).toBe(false);
    expect(samePreloadedRow(a, { ...a, type: 'image' })).toBe(false);
  });
});

describe('preloadedNotes', () => {
  const resource = { href: 'https://a/b', type: 'font' };
  it('notes the cap only with the mark and a list at its cap', () => {
    const full = Array.from({ length: 5000 }, () => resource);
    expect(preloadedNotes({ present: true, resources: full, truncated: true })).toEqual([
      'The list was capped at the first 5,000 resources; counts cover these rows.'
    ]);
    expect(preloadedNotes({ present: true, resources: full })).toEqual([]);
    expect(preloadedNotes({ present: true, resources: [resource], truncated: true })).toEqual([]);
    expect(preloadedNotes({ present: false })).toEqual([]);
  });
});
