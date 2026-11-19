/** Beacon results as list rows: URL choice, facts and detail, the label facet, search, and row identity. */
import { describe, expect, it } from 'vitest';
import { selectionMismatches } from '../panel/facet-checks.fixtures';
import { applyFacets, facetCounts } from '../panel/resource-facets';
import type { AboveTheFoldCandidate } from './results';
import {
  ABOVE_THE_FOLD_FACETS,
  aboveTheFoldRows,
  aboveTheFoldSearchField,
  candidateFacts,
  candidateUrl,
  LAZY_RENDER_FACETS,
  lazyRenderRows,
  lazyRenderSearchField,
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

describe('candidateFacts', () => {
  it('names every non-empty value: image attributes, backgrounds, each <source> (sizes too), extra fields', () => {
    expect(
      candidateFacts(
        candidate({
          src: 'a.jpg',
          currentSrc: 'a-2x.jpg',
          srcset: 'a-2x.jpg 2x',
          sizes: '100vw',
          sources: [
            {
              srcset: 's.avif 1x',
              sizes: '(max-width: 600px) 100vw',
              media: '',
              type: 'image/avif'
            }
          ],
          extra: { fetchpriority: 'high', width: 1200, decoded: true }
        })
      )
    ).toEqual([
      { term: 'src', value: 'a.jpg' },
      { term: 'URL the browser picked', value: 'a-2x.jpg' },
      { term: 'srcset', value: 'a-2x.jpg 2x' },
      { term: 'sizes', value: '100vw' },
      {
        term: '<source> 1',
        value: 'srcset: s.avif 1x\nsizes: (max-width: 600px) 100vw\ntype: image/avif'
      },
      { term: 'fetchpriority', value: 'high' },
      { term: 'width', value: '1200' },
      { term: 'decoded', value: 'true' }
    ]);
  });

  it('numbers backgrounds only when there are several', () => {
    expect(candidateFacts(BG).map((fact) => fact.term)).toEqual(['Background 1', 'Background 2']);
    expect(
      candidateFacts(candidate({ backgroundUrls: ['one.png'] })).map((fact) => fact.term)
    ).toEqual(['Background']);
    expect(candidateFacts(candidate({}))).toEqual([]);
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

/**
 * The ids of the above-the-fold rows a query keeps (no facet picked).
 *
 * @param rows The rows.
 * @param query The query.
 */
function searchedIds(rows: ReturnType<typeof aboveTheFoldRows>, query: string): number[] {
  return applyFacets(
    rows,
    ABOVE_THE_FOLD_FACETS,
    {},
    { field: aboveTheFoldSearchField, query }
  ).map((row) => row.id);
}

describe('aboveTheFoldSearchField', () => {
  const rows = aboveTheFoldRows({
    kind: 'ok',
    items: [LCP, BG, PICTURE, candidate({ label: 'future-label', src: 'x.gif' })],
    dropped: 0,
    truncated: false
  });

  it('searches URLs, kinds, labels and the detail, case-insensitively', () => {
    const ids = (query: string) => searchedIds(rows, query);
    expect(ids('HERO-2X')).toEqual([0]);
    expect(ids('bg.png')).toEqual([1]);
    expect(ids('image/avif')).toEqual([2]);
    expect(ids('bg-img')).toEqual([1]);
    expect(ids('future')).toEqual([3]);
    expect(ids('nothing')).toEqual([]);
  });

  it('matches only values the details show (<source> sizes and extra fields included)', () => {
    const withMore = aboveTheFoldRows({
      kind: 'ok',
      items: [
        candidate({
          src: 'a.jpg',
          sources: [{ srcset: 's.avif', sizes: '(max-width: 480px) 90vw', media: '', type: '' }],
          extra: { fetchpriority: 'high' }
        })
      ],
      dropped: 0,
      truncated: false
    });
    const ids = (query: string) => searchedIds(withMore, query);
    expect(ids('480px')).toEqual([0]);
    expect(ids('fetchpriority')).toEqual([]); // a name is a term, not a value
    expect(ids('high')).toEqual([0]);
    const facts = withMore[0]?.facts.map((fact) => fact.value).join('\n') ?? '';
    expect(facts).toContain('480px');
    expect(facts).toContain('high');
  });
});

describe('ABOVE_THE_FOLD_FACETS', () => {
  const rows = aboveTheFoldRows({
    kind: 'ok',
    items: [LCP, BG, PICTURE, candidate({ label: 'future-label', src: 'x.gif' })],
    dropped: 0,
    truncated: false
  });

  it('keeps exactly its rows under each label (with and without a query)', () => {
    const cases = {
      any: { selection: {}, rows: [0, 1, 2, 3] },
      lcp: { selection: { label: 'lcp' }, rows: [0] },
      'above-the-fold': { selection: { label: 'above-the-fold' }, rows: [1, 2] }
    };
    for (const query of ['', 'a.test', 'PICTURE']) {
      expect(
        selectionMismatches(rows, ABOVE_THE_FOLD_FACETS, aboveTheFoldSearchField, cases, query)
      ).toEqual([]);
    }
  });

  it('counts by label; an unknown label only under Any', () => {
    const search = { field: aboveTheFoldSearchField, query: '' };
    expect(facetCounts(rows, ABOVE_THE_FOLD_FACETS, {}, search).byFacet.label).toEqual({
      any: 4,
      lcp: 1,
      'above-the-fold': 2
    });
  });
});

describe('LAZY_RENDER_FACETS', () => {
  it('declares no facet: the search alone narrows', () => {
    const rows = lazyRenderRows({
      kind: 'ok',
      items: ['abc123', 'def456'],
      dropped: 0,
      truncated: false
    });
    expect(LAZY_RENDER_FACETS.facets).toEqual([]);
    expect(
      applyFacets(rows, LAZY_RENDER_FACETS, {}, { field: lazyRenderSearchField, query: 'DEF' })
    ).toEqual([rows[1]]);
  });
});

describe('lazyRenderRows', () => {
  it('lists hashes in order and searches them', () => {
    const rows = lazyRenderRows({
      kind: 'ok',
      items: ['abc123', 'def456'],
      dropped: 0,
      truncated: false
    });
    expect(rows).toEqual([
      { id: 0, key: 'abc123#0', hash: 'abc123' },
      { id: 1, key: 'def456#0', hash: 'def456' }
    ]);
    expect(rows.map(lazyRenderSearchField)).toEqual(['abc123', 'def456']);
    expect(
      applyFacets(rows, LAZY_RENDER_FACETS, {}, { field: lazyRenderSearchField, query: 'DEF' }).map(
        (row) => row.id
      )
    ).toEqual([1]);
  });
});

describe('row identity', () => {
  it('keeps a row whose shown values are unchanged', () => {
    const [first] = aboveTheFoldRows({ kind: 'ok', items: [LCP], dropped: 0, truncated: false });
    if (first === undefined) throw new Error('no row');
    expect(sameAboveTheFoldRow(first, { ...first })).toBe(true);
    expect(sameAboveTheFoldRow(first, { ...first, label: 'above-the-fold' })).toBe(false);
    expect(sameAboveTheFoldRow(first, { ...first, detail: '' })).toBe(false);
    expect(
      sameLazyRenderRow({ id: 0, key: 'a#0', hash: 'a' }, { id: 0, key: 'a#0', hash: 'a' })
    ).toBe(true);
    expect(
      sameLazyRenderRow({ id: 0, key: 'a#0', hash: 'a' }, { id: 0, key: 'a#0', hash: 'b' })
    ).toBe(false);
  });

  it('keys rows by content, duplicates by occurrence (unique, never by position alone)', () => {
    const rows = aboveTheFoldRows({
      kind: 'ok',
      items: [LCP, BG, LCP, candidate({ kind: 'img', src: 'https://a.test/hero.jpg' })],
      dropped: 0,
      truncated: false
    });
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(4);
    expect(keys[0]).toBe('img\u001fhttps://a.test/hero.jpg\u001flcp#0');
    expect(keys[2]).toBe('img\u001fhttps://a.test/hero.jpg\u001flcp#1');
    // Same URL and kind, another label: its own signature.
    expect(keys[3]).toBe('img\u001fhttps://a.test/hero.jpg\u001fabove-the-fold#0');
    // A row's key does not move with an earlier row of another signature.
    const alone = aboveTheFoldRows({ kind: 'ok', items: [BG], dropped: 0, truncated: false });
    expect(alone[0]?.key).toBe(keys[1]);
    const hashes = lazyRenderRows({
      kind: 'ok',
      items: ['h', 'h', 'g'],
      dropped: 0,
      truncated: false
    });
    expect(hashes.map((row) => row.key)).toEqual(['h#0', 'h#1', 'g#0']);
  });
});
