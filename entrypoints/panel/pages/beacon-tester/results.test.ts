/**
 * The candidate rows' pure view: the name (file name, or the no-URL words),
 * the preview line (element kind · URL) and the detail's facts (the element
 * first, then every value in the record's order — labels and values as the
 * record names them — without the exact repeats of the tile's URL).
 */
import { describe, expect, it } from 'vitest';
import type { AboveTheFoldCandidate } from '../../../../lib/beacon-test/results';
import { aboveTheFoldRows, type AboveTheFoldRow } from '../../../../lib/beacon-test/results-view';
import { candidateDetailFacts, candidateName, candidatePreview, NO_IMAGE_URL } from './results';

/**
 * A candidate record with every field empty unless overridden.
 *
 * @param overrides The fields to set.
 */
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

/**
 * The row of one candidate, as the list builds it.
 *
 * @param record The record.
 */
function rowOf(record: AboveTheFoldCandidate): AboveTheFoldRow {
  const [row] = aboveTheFoldRows({ kind: 'ok', items: [record], dropped: 0, truncated: false });
  if (row === undefined) throw new Error('aboveTheFoldRows returned no row for one record.');
  return row;
}

describe('candidate rows', () => {
  it('names a row by its image file name, or the no-URL words', () => {
    expect(candidateName(rowOf(candidate({ src: 'https://a.test/img/hero.jpg?v=2' })))).toBe(
      'hero.jpg'
    );
    expect(candidateName(rowOf(candidate({})))).toBe(NO_IMAGE_URL);
  });

  it('previews the element kind, then the URL without its scheme', () => {
    expect(candidatePreview(rowOf(candidate({ src: 'https://a.test/hero.jpg' })))).toBe(
      'img · a.test/hero.jpg'
    );
    expect(candidatePreview(rowOf(candidate({ kind: 'bg-img' })))).toBe('bg-img');
  });

  it('lists the element, then every record value in order, labelled as the record names it', () => {
    const facts = candidateDetailFacts(
      rowOf(
        candidate({
          kind: 'picture',
          src: 'https://a.test/fallback.jpg',
          currentSrc: 'https://a.test/wide.avif',
          srcset: 'https://a.test/fallback-2x.jpg 2x',
          sizes: '100vw',
          backgroundUrls: ['https://a.test/bg.webp'],
          sources: [
            { srcset: 'https://a.test/wide.avif 1x', sizes: '', media: '', type: 'image/avif' }
          ],
          extra: { fetchpriority: 'high' }
        })
      )
    );
    expect(facts).toEqual([
      { label: 'Element', value: 'picture', mono: true },
      // `src` is the tile's URL: not repeated.
      {
        label: 'URL the browser picked',
        value: 'https://a.test/wide.avif',
        mono: true,
        multiline: false
      },
      {
        label: 'srcset',
        value: 'https://a.test/fallback-2x.jpg 2x',
        mono: true,
        multiline: false
      },
      { label: 'sizes', value: '100vw', mono: true, multiline: false },
      { label: 'Background', value: 'https://a.test/bg.webp', mono: true, multiline: false },
      {
        label: '<source> 1',
        value: 'srcset: https://a.test/wide.avif 1x\ntype: image/avif',
        mono: true,
        multiline: true
      },
      { label: 'fetchpriority', value: 'high', mono: true, multiline: false }
    ]);
  });

  it('drops only exact repeats of the tile URL — every one, whichever field holds it', () => {
    const url = 'https://a.test/hero.jpg';
    const labels = (record: AboveTheFoldCandidate): string[] =>
      candidateDetailFacts(rowOf(record)).map((fact) => fact.label);
    // The browser picked the same URL as `src`: both repeat the tile.
    expect(labels(candidate({ src: url, currentSrc: url }))).toEqual(['Element']);
    // A URL that merely contains the tile's stays.
    expect(labels(candidate({ src: url, currentSrc: `${url}?w=2` }))).toEqual([
      'Element',
      'URL the browser picked'
    ]);
    // A background tile: the background fact repeats it.
    expect(labels(candidate({ kind: 'bg-img', backgroundUrls: [url] }))).toEqual(['Element']);
    // A tile from the first srcset URL: the srcset value is more than the URL, so it stays.
    expect(labels(candidate({ srcset: `${url} 1x` }))).toEqual(['Element', 'srcset']);
  });

  it('keeps every value when there is no tile', () => {
    expect(
      candidateDetailFacts(rowOf(candidate({ kind: 'bg-img', extra: { note: 'x' } })))
    ).toEqual([
      { label: 'Element', value: 'bg-img', mono: true },
      { label: 'note', value: 'x', mono: true, multiline: false }
    ]);
  });
});
