/** Beacon results as list rows: URL choice, detail, chips by label, search, and row identity. */
import { describe, expect, it } from 'vitest';
import { filterAndSearch, filterCounts } from '../panel/resources-view-model';
import type { AboveTheFoldCandidate } from './results';
import {
  ABOVE_THE_FOLD_LIST,
  aboveTheFoldRows,
  candidateUrl,
  LAZY_RENDER_LIST,
  lazyRenderRows,
  sameAboveTheFoldRow,
  sameLazyRenderRow
} from './results-view';

/** A candidate with every field empty but the overrides. */
function candidate(overrides: Partial<AboveTheFoldCandidate>): AboveTheFoldCandidate {
  return {
    label: 'above-the-fold',
    kind: 'img',
    src: '',
    srcset: '',
    sizes: '',
    currentSrc: '',
    sources: [],
    backgroundUrls: [],
    extra: {},
    ...overrides
  };
}

const LCP = candidate({ label: 'lcp', src: 'https://a.test/hero.jpg', srcset: 'hero-2x.jpg 2x' });
const BG = candidate({
  kind: 'bg-img-set',
  backgroundUrls: ['https://a.test/bg.webp', 'https://a.test/bg.png']
});
const PICTURE = candidate({
  kind: 'picture',
  sources: [
    {
      srcset: 'pic.avif 1x, pic2.avif 2x',
      media: '(min-width: 600px)',
      type: 'image/avif',
      sizes: ''
    }
  ]
});

describe('candidateUrl', () => {
  it('prefers src, then the picked URL, a background URL, then a srcset URL', () => {
    expect(candidateUrl(LCP)).toBe('https://a.test/hero.jpg');
    expect(candidateUrl(candidate({ currentSrc: 'c.jpg', srcset: 's.jpg 1x' }))).toBe('c.jpg');
    expect(candidateUrl(BG)).toBe('https://a.test/bg.webp');
    expect(candidateUrl(candidate({ srcset: ' one.jpg 1x, two.jpg 2x' }))).toBe('one.jpg');
    expect(candidateUrl(candidate({ srcset: 'only.jpg, two.jpg 2x' }))).toBe('only.jpg');
    expect(candidateUrl(PICTURE)).toBe('pic.avif');
    expect(candidateUrl(candidate({}))).toBe('');
  });
});

describe('aboveTheFoldRows', () => {
  it('maps records in report order with every URL-like value as detail', () => {
    const rows = aboveTheFoldRows({
      kind: 'ok',
      items: [LCP, PICTURE],
      dropped: 0,
      truncated: false
    });
    expect(rows.map((row) => [row.id, row.url, row.kind, row.label])).toEqual([
      [0, 'https://a.test/hero.jpg', 'img', 'lcp'],
      [1, 'pic.avif', 'picture', 'above-the-fold']
    ]);
    expect(rows[0]?.detail).toBe('https://a.test/hero.jpg\nhero-2x.jpg 2x');
    expect(rows[1]?.detail).toBe('pic.avif 1x, pic2.avif 2x\n(min-width: 600px)\nimage/avif');
  });

  it('has no rows for a feature that did not run or an unreadable list', () => {
    expect(aboveTheFoldRows(null)).toEqual([]);
    expect(aboveTheFoldRows({ kind: 'malformed' })).toEqual([]);
    expect(lazyRenderRows(null)).toEqual([]);
    expect(lazyRenderRows({ kind: 'malformed' })).toEqual([]);
  });
});

describe('ABOVE_THE_FOLD_LIST', () => {
  const rows = aboveTheFoldRows({
    kind: 'ok',
    items: [LCP, BG, PICTURE, candidate({ label: 'future-label', src: 'x.gif' })],
    dropped: 0,
    truncated: false
  });

  it('counts by the beacon label (an unknown label only under All)', () => {
    expect(filterCounts(rows, ABOVE_THE_FOLD_LIST)).toEqual({
      all: 4,
      lcp: 1,
      'above-the-fold': 2
    });
    expect(filterAndSearch(rows, ABOVE_THE_FOLD_LIST, 'lcp', '').map((row) => row.id)).toEqual([0]);
  });

  it('searches URLs, kinds, labels and the detail, case-insensitively', () => {
    const ids = (query: string) =>
      filterAndSearch(rows, ABOVE_THE_FOLD_LIST, 'all', query).map((row) => row.id);
    expect(ids('HERO-2X')).toEqual([0]);
    expect(ids('bg.png')).toEqual([1]);
    expect(ids('image/avif')).toEqual([2]);
    expect(ids('bg-img')).toEqual([1]);
    expect(ids('future')).toEqual([3]);
    expect(ids('nothing')).toEqual([]);
  });
});

describe('LAZY_RENDER_LIST', () => {
  it('lists hashes in order and searches them', () => {
    const rows = lazyRenderRows({
      kind: 'ok',
      items: ['abc123', 'def456'],
      dropped: 0,
      truncated: false
    });
    expect(rows).toEqual([
      { id: 0, hash: 'abc123' },
      { id: 1, hash: 'def456' }
    ]);
    expect(filterAndSearch(rows, LAZY_RENDER_LIST, 'all', 'DEF').map((row) => row.id)).toEqual([1]);
  });
});

describe('row identity', () => {
  it('keeps a row whose shown values are unchanged', () => {
    const [first] = aboveTheFoldRows({ kind: 'ok', items: [LCP], dropped: 0, truncated: false });
    if (first === undefined) throw new Error('no row');
    expect(sameAboveTheFoldRow(first, { ...first })).toBe(true);
    expect(sameAboveTheFoldRow(first, { ...first, label: 'above-the-fold' })).toBe(false);
    expect(sameAboveTheFoldRow(first, { ...first, detail: '' })).toBe(false);
    expect(sameLazyRenderRow({ id: 0, hash: 'a' }, { id: 0, hash: 'a' })).toBe(true);
    expect(sameLazyRenderRow({ id: 0, hash: 'a' }, { id: 0, hash: 'b' })).toBe(false);
  });
});
