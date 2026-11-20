/**
 * The page-style inventory guard: exact entry shape, every cap, the count
 * bound and `total` never below the listed entries.
 */
import { describe, expect, it } from 'vitest';
import {
  PAGE_STYLE_LIMITS,
  parsePageStyleEntry,
  parsePageStylesReply,
  parseStyleInventory,
  type PageStyleEntry
} from './page-styles';

const LINK: PageStyleEntry = {
  kind: 'link',
  id: 'theme-css',
  className: '',
  href: 'https://example.com/a.css',
  media: 'all',
  preview: '',
  chars: 0
};

const INLINE: PageStyleEntry = {
  kind: 'inline',
  id: '',
  className: 'x y',
  href: '',
  media: '',
  preview: '.a{color:red}',
  chars: 13
};

describe('parsePageStyleEntry', () => {
  it('rebuilds a valid entry of either kind', () => {
    expect(parsePageStyleEntry(LINK)).toEqual(LINK);
    expect(parsePageStyleEntry(INLINE)).toEqual(INLINE);
  });

  it('refuses unknown kinds, keys, types and anything past a cap', () => {
    for (const bad of [
      { ...LINK, kind: 'script' },
      { ...LINK, extra: 1 },
      { ...LINK, chars: -1 },
      { ...LINK, chars: 1.5 },
      { ...LINK, id: 1 },
      { ...LINK, id: 'x'.repeat(PAGE_STYLE_LIMITS.idChars + 1) },
      { ...LINK, className: 'x'.repeat(PAGE_STYLE_LIMITS.classChars + 1) },
      { ...LINK, href: 'x'.repeat(PAGE_STYLE_LIMITS.hrefChars + 1) },
      { ...LINK, media: 'x'.repeat(PAGE_STYLE_LIMITS.mediaChars + 1) },
      { ...INLINE, preview: 'x'.repeat(PAGE_STYLE_LIMITS.previewChars + 1) },
      [],
      null
    ]) {
      expect(parsePageStyleEntry(bad)).toBeNull();
    }
  });

  it('never reads an inherited field', () => {
    const forged = Object.create({ kind: 'link' }) as Record<string, unknown>;
    Object.assign(forged, { ...LINK });
    delete forged.kind;
    expect(parsePageStyleEntry(forged)).toBeNull();
  });
});

describe('parsePageStylesReply', () => {
  it('rebuilds a valid reply, a cut one included', () => {
    expect(parsePageStylesReply({ styles: [LINK, INLINE], total: 2 })).toEqual({
      styles: [LINK, INLINE],
      total: 2
    });
    expect(parsePageStylesReply({ styles: [LINK], total: 9000 })?.total).toBe(9000);
    expect(parsePageStylesReply({ styles: [], total: 0 })).toEqual({ styles: [], total: 0 });
  });

  it('refuses a total below the list, too many entries, one bad entry or extra keys', () => {
    expect(parsePageStylesReply({ styles: [LINK, INLINE], total: 1 })).toBeNull();
    expect(
      parsePageStylesReply({
        styles: Array.from({ length: PAGE_STYLE_LIMITS.count + 1 }, () => LINK),
        total: PAGE_STYLE_LIMITS.count + 1
      })
    ).toBeNull();
    expect(parsePageStylesReply({ styles: [LINK, { ...INLINE, kind: 'x' }], total: 2 })).toBeNull();
    expect(parsePageStylesReply({ styles: [], total: 0, more: true })).toBeNull();
    expect(parsePageStylesReply({ styles: {}, total: 0 })).toBeNull();
    expect(parsePageStylesReply({ styles: [], total: -1 })).toBeNull();
    expect(parsePageStylesReply('nope')).toBeNull();
  });
});

describe('parseStyleInventory', () => {
  it('runs every entry through the given guard and keeps the shared reply rules', () => {
    const numbers = (item: unknown): number | null => (typeof item === 'number' ? item : null);
    expect(parseStyleInventory({ styles: [1, 2], total: 3 }, numbers)).toEqual({
      styles: [1, 2],
      total: 3
    });
    expect(parseStyleInventory({ styles: [1, 'x'], total: 2 }, numbers)).toBeNull();
    expect(parseStyleInventory({ styles: [1, 2], total: 1 }, numbers)).toBeNull();
  });

  it('admits only the extra keys a wider inventory names, and returns the shared fields', () => {
    const numbers = (item: unknown): number | null => (typeof item === 'number' ? item : null);
    const reply = { styles: [1], total: 1, snapshotId: 'x' };
    expect(parseStyleInventory(reply, numbers)).toBeNull();
    expect(parseStyleInventory(reply, numbers, ['snapshotId'])).toEqual({ styles: [1], total: 1 });
    expect(parseStyleInventory({ ...reply, other: 1 }, numbers, ['snapshotId'])).toBeNull();
  });

  it('keeps the RUCSS inventory exact: a snapshot id is not one of its keys', () => {
    expect(parsePageStylesReply({ styles: [], total: 0, snapshotId: 'a'.repeat(32) })).toBeNull();
  });
});
