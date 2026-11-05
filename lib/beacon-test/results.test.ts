/**
 * Beacon result validation: the beacon's real record shapes (img, srcset,
 * picture, background image / set), the type-key filter, list and string
 * caps, uninterpreted fields kept bounded and readonly, and hostile input
 * (prototype pollution, non-lists, key stuffing) never trusted.
 */
import { describe, expect, it } from 'vitest';
import {
  EXTRA_FIELDS_MAX,
  NESTED_ENTRIES_MAX,
  RESULT_RECORDS_MAX,
  SHORT_TEXT_MAX,
  URL_TEXT_MAX,
  readBeaconResults,
  readCandidate,
  readFeatureList,
  readLazyRenderHash
} from './results';

/** A record shaped as the beacon builds it (all its keys, empty values). */
function record(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: '',
    src: '',
    srcset: '',
    sizes: '',
    sources: [],
    bg_set: [],
    current_src: '',
    ...overrides
  };
}

describe('readCandidate', () => {
  it('reads an img-srcset LCP record', () => {
    const candidate = readCandidate(
      record({
        type: 'img-srcset',
        label: 'lcp',
        src: 'https://e.test/a.jpg',
        srcset: 'https://e.test/a.jpg 1x, https://e.test/a2.jpg 2x',
        sizes: '100vw',
        current_src: 'https://e.test/a2.jpg'
      })
    );
    expect(candidate).toEqual({
      label: 'lcp',
      kind: 'img-srcset',
      src: 'https://e.test/a.jpg',
      srcset: 'https://e.test/a.jpg 1x, https://e.test/a2.jpg 2x',
      sizes: '100vw',
      currentSrc: 'https://e.test/a2.jpg',
      sources: [],
      backgroundUrls: [],
      extra: {}
    });
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('reads picture sources', () => {
    const candidate = readCandidate(
      record({
        type: 'picture',
        label: 'above-the-fold',
        src: 'https://e.test/p.jpg',
        sources: [
          {
            srcset: 'https://e.test/p.webp',
            media: '(min-width: 800px)',
            type: 'image/webp',
            sizes: ''
          },
          'not a record',
          { srcset: 1 }
        ]
      })
    );
    expect(candidate?.sources).toEqual([
      {
        srcset: 'https://e.test/p.webp',
        media: '(min-width: 800px)',
        type: 'image/webp',
        sizes: ''
      },
      { srcset: '', media: '', type: '', sizes: '' }
    ]);
  });

  it('reads a background image set, whose src is the set itself', () => {
    const set = [{ src: 'https://e.test/1.png 1x' }, { src: 'https://e.test/2.png 2x' }, {}];
    const candidate = readCandidate(
      record({ type: 'bg-img-set', label: 'lcp', src: set, bg_set: set })
    );
    expect(candidate?.src).toBe('https://e.test/1.png 1x');
    expect(candidate?.backgroundUrls).toEqual([
      'https://e.test/1.png 1x',
      'https://e.test/2.png 2x'
    ]);
    expect(readCandidate(record({ type: 'bg-img-set', src: [] }))?.src).toBe('');
    expect(readCandidate(record({ type: 'bg-img-set', src: ['x'] }))?.src).toBe('');
  });

  it('keeps a typed record with an empty type (svg without image) — the filter is the type key', () => {
    expect(readCandidate(record({ type: '', label: 'above-the-fold' }))?.kind).toBe('');
  });

  it.each([
    ['no type key', { label: 'lcp', src: 'x' }],
    ['a non-string type', { type: 1 }],
    ['an inherited type', Object.create({ type: 'img' }) as unknown],
    ['a non-record', 'img'],
    ['null', null]
  ])('drops %s', (_label, value) => {
    expect(readCandidate(value)).toBeNull();
  });

  it('clips strings and nested lists', () => {
    const candidate = readCandidate(
      record({
        type: 'x'.repeat(SHORT_TEXT_MAX + 5),
        src: 'u'.repeat(URL_TEXT_MAX + 5),
        sources: Array.from({ length: NESTED_ENTRIES_MAX + 5 }, () => ({ srcset: 's' })),
        bg_set: Array.from({ length: NESTED_ENTRIES_MAX + 5 }, () => ({ src: 'b' }))
      })
    );
    expect(candidate?.kind).toBe(`${'x'.repeat(SHORT_TEXT_MAX)}…`);
    expect(candidate?.src).toBe(`${'u'.repeat(URL_TEXT_MAX)}…`);
    expect(candidate?.sources).toHaveLength(NESTED_ENTRIES_MAX);
    expect(candidate?.backgroundUrls).toHaveLength(NESTED_ENTRIES_MAX);
  });

  it('keeps uninterpreted primitive fields bounded and frozen, drops the rest', () => {
    const candidate = readCandidate(
      record({
        type: 'img',
        fetchpriority: 'high',
        width: 640,
        lazy: false,
        nan: Number.NaN,
        nested: { a: 1 },
        list: [1]
      })
    );
    expect(candidate?.extra).toEqual({ fetchpriority: 'high', width: 640, lazy: false });
    expect(Object.isFrozen(candidate?.extra)).toBe(true);
    const stuffed: Record<string, unknown> = { type: 'img' };
    for (let i = 0; i < 500; i += 1) stuffed[`k${String(i)}`] = 'v';
    expect(Object.keys(readCandidate(stuffed)?.extra ?? {})).toHaveLength(EXTRA_FIELDS_MAX);
  });
});

describe('readLazyRenderHash', () => {
  it('keeps non-empty strings, clipped', () => {
    expect(readLazyRenderHash('b4c2f1')).toBe('b4c2f1');
    expect(readLazyRenderHash('h'.repeat(SHORT_TEXT_MAX + 1))).toBe(
      `${'h'.repeat(SHORT_TEXT_MAX)}…`
    );
  });

  it.each(['', 1, null, {}])('drops %j', (value) => {
    expect(readLazyRenderHash(value)).toBeNull();
  });
});

describe('readFeatureList', () => {
  it('is null for a feature that did not run, malformed for a non-list', () => {
    expect(readFeatureList(null, readLazyRenderHash)).toBeNull();
    expect(readFeatureList(undefined, readLazyRenderHash)).toBeNull();
    expect(readFeatureList({ length: 1 }, readLazyRenderHash)).toEqual({ kind: 'malformed' });
    expect(readFeatureList('a', readLazyRenderHash)).toEqual({ kind: 'malformed' });
  });

  it('counts dropped entries and caps the list', () => {
    expect(readFeatureList(['a', 1, 'b'], readLazyRenderHash)).toEqual({
      kind: 'ok',
      items: ['a', 'b'],
      dropped: 1,
      truncated: false
    });
    const long = Array.from({ length: RESULT_RECORDS_MAX + 1 }, (_, i) => `h${String(i)}`);
    const list = readFeatureList(long, readLazyRenderHash);
    expect(list?.kind === 'ok' && list.items.length).toBe(RESULT_RECORDS_MAX);
    expect(list?.kind === 'ok' && list.truncated).toBe(true);
    const exact = readFeatureList(long.slice(1), readLazyRenderHash);
    expect(exact?.kind === 'ok' && exact.truncated).toBe(false);
  });
});

describe('readBeaconResults', () => {
  it('reads both features from the beacon’s raw results', () => {
    const results = readBeaconResults({
      lcp: [record({ type: 'img', label: 'lcp', src: 'https://e.test/a.jpg' }), { label: 'x' }],
      lrc: ['h1', 'h2']
    });
    expect(results?.aboveTheFold).toMatchObject({ kind: 'ok', dropped: 1 });
    expect(results?.lazyRender).toEqual({
      kind: 'ok',
      items: ['h1', 'h2'],
      dropped: 0,
      truncated: false
    });
  });

  it('marks a feature that did not run as null', () => {
    expect(readBeaconResults({ lcp: null, lrc: [] })).toEqual({
      aboveTheFold: null,
      lazyRender: { kind: 'ok', items: [], dropped: 0, truncated: false }
    });
  });

  it('refuses a non-record and never reads inherited results', () => {
    expect(readBeaconResults(null)).toBeNull();
    expect(readBeaconResults([])).toBeNull();
    expect(readBeaconResults(Object.create({ lcp: [], lrc: ['h'] }) as unknown)).toEqual({
      aboveTheFold: null,
      lazyRender: null
    });
  });
});
