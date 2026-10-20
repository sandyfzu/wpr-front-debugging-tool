/**
 * The Image Lazyload transform: candidate images are those carrying lazy
 * attributes; rows are LITERAL substrings tested against the img markup
 * with the lazy values restored (the clone — the image's real identity);
 * the rewrite moves `src`/`srcset`/`sizes` back from their lazy carriers.
 */
import { describe, expect, it } from 'vitest';
import { lazyloadTransform } from './lazyload';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from './set';

function setWithRows(rows: string[]): ExclusionSet {
  return {
    rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: rows },
    disable: { ...EMPTY_EXCLUSION_SET.disable }
  };
}

const LAZY_IMG =
  '<img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" data-lazy-src="https://cdn.tld/photo.jpg" class="wp-image">';
const LAZY_FULL =
  '<img src="ph.gif" data-lazy-src="real.jpg" data-lazy-srcset="real.jpg 1x, real@2x.jpg 2x" data-lazy-sizes="(max-width: 800px) 100vw" alt="x">';

describe('lazyloadTransform — identity arms', () => {
  it('is the identity when no image carries lazy attributes', () => {
    const html = '<img src="eager.jpg"><img data-lazy-original>';
    const result = lazyloadTransform(html, setWithRows(['eager.jpg']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'lazyload',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      matchedRows: [],
      unmatchedRows: ['eager.jpg']
    });
  });

  it('is the identity for an empty set and an empty document', () => {
    const emptySet = lazyloadTransform(LAZY_IMG, EMPTY_EXCLUSION_SET);
    expect(emptySet.html).toBe(LAZY_IMG);
    expect(emptySet.report.candidates).toBe(1);
    expect(emptySet.report.rewritten).toBe(0);
    expect(lazyloadTransform('', setWithRows(['x'])).html).toBe('');
  });
});

describe('lazyloadTransform — restoring', () => {
  it('moves the lazy src back into `src` and drops the carrier attribute', () => {
    const result = lazyloadTransform(LAZY_IMG, setWithRows(['photo.jpg']));
    expect(result.html).toBe(
      '<img src="https://cdn.tld/photo.jpg" class="wp-image" data-wpr-fdt-excluded="lazyload">'
    );
    expect(result.report).toEqual({
      feature: 'lazyload',
      featureWide: false,
      candidates: 1,
      rewritten: 1,
      matchedRows: [{ row: 'photo.jpg', rowKind: 'literal', matches: 1 }],
      unmatchedRows: []
    });
  });

  it('restores srcset and sizes too, keeping their raw values', () => {
    const result = lazyloadTransform(LAZY_FULL, setWithRows(['real.jpg']));
    // Added attributes land at the end of the opening tag (insert-before-`>`);
    // existing attribute order and quote styles are preserved.
    expect(result.html).toBe(
      '<img src="real.jpg" alt="x" srcset="real.jpg 1x, real@2x.jpg 2x" sizes="(max-width: 800px) 100vw" data-wpr-fdt-excluded="lazyload">'
    );
  });

  it('covers the srcset-only case: srcset restored, the placeholder src untouched', () => {
    const html = '<img src="ph.gif" data-lazy-srcset="real.jpg 1x">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg 1x']));
    expect(result.html).toBe(
      '<img src="ph.gif" srcset="real.jpg 1x" data-wpr-fdt-excluded="lazyload">'
    );
  });

  it('restores an empty lazy value as an empty destination value', () => {
    const html = '<img src="ph" data-lazy-src>';
    const result = lazyloadTransform(html, setWithRows(['ph']));
    // The bare lazy carrier restores `src=""` — and the row still matches the clone's `ph`... it cannot:
    // the clone's src is now empty, so only the served row text could have matched. No rewrite.
    expect(result.report.candidates).toBe(1);
    expect(result.report.rewritten).toBe(0);
  });

  it('moves a value into an existing destination attribute', () => {
    const html = '<img src="ph.gif" srcset="old 1x" data-lazy-srcset="real.jpg 1x">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toBe(
      '<img src="ph.gif" srcset="real.jpg 1x" data-wpr-fdt-excluded="lazyload">'
    );
  });
});

describe('lazyloadTransform — literal matching', () => {
  it('matches the restored clone, not the served markup: the real URL matches, the placeholder does not', () => {
    // The real URL only exists in the clone (the served markup still holds the placeholder).
    expect(
      lazyloadTransform(LAZY_IMG, setWithRows(['https://cdn.tld/photo.jpg'])).report.rewritten
    ).toBe(1);
    // The placeholder is gone from the clone (src was restored over it).
    expect(lazyloadTransform(LAZY_IMG, setWithRows(['data:image/svg+xml'])).report.rewritten).toBe(
      0
    );
  });

  it('never interprets a row as a regular expression', () => {
    const html = '<img src="ph" data-lazy-src="city.webp">';
    expect(lazyloadTransform(html, setWithRows(['[a-z]+\\.webp']))).toMatchObject({
      report: { rewritten: 0 }
    });
    expect(lazyloadTransform(html, setWithRows(['city.webp']))).toMatchObject({
      report: { rewritten: 1 }
    });
  });

  it('is case-sensitive and attributes the image to the first matching row', () => {
    const html = '<img src="ph" data-lazy-src="city.webp">';
    expect(lazyloadTransform(html, setWithRows(['CITY.WEBP']))).toMatchObject({
      report: { rewritten: 0 }
    });
    const two = lazyloadTransform(html, setWithRows(['city.webp', '.webp']));
    expect(two.report.matchedRows).toEqual([{ row: 'city.webp', rowKind: 'literal', matches: 1 }]);
    expect(two.report.unmatchedRows).toEqual(['.webp']);
  });

  it('matches any substring of the restored markup — value fragments and surviving attributes included', () => {
    const html = '<img data-lazy-src="real.jpg" class="slider-img">';
    for (const row of ['class="slider-img', 'real.jpg', 'src="real.jpg']) {
      expect(lazyloadTransform(html, setWithRows([row])).report.rewritten).toBe(1);
    }
    // A row naming the lazy CARRIER itself cannot match: the carrier is gone
    // from the restored clone — rows name the image's real identity.
    expect(lazyloadTransform(html, setWithRows(['data-lazy-src'])).report.rewritten).toBe(0);
  });
});

describe('lazyloadTransform — adversarial markup', () => {
  it('restores every occurrence of a duplicated image, minified single-line included', () => {
    const html = `<p>x</p>${LAZY_IMG}${LAZY_IMG}<p>y</p>`;
    const result = lazyloadTransform(html, setWithRows(['photo.jpg']));
    expect(result.report.candidates).toBe(2);
    expect(result.report.rewritten).toBe(2);
    expect(result.html.match(/data-wpr-fdt-excluded="lazyload"/g)?.length).toBe(2);
    expect(result.html).not.toContain('data-lazy-src');
    expect(result.html.startsWith('<p>x</p>')).toBe(true);
  });

  it('keeps `>` inside quoted attribute values intact', () => {
    const html = '<img src="ph" data-lazy-src="real.jpg" alt="a>b">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toBe('<img src="real.jpg" alt="a>b" data-wpr-fdt-excluded="lazyload">');
  });

  it('preserves the doctype and passes non-ASCII values through unchanged (strings only, no byte handling)', () => {
    const html = `<!doctype html>\n<img src="ph" data-lazy-src="préférences.jpg">\uD800`;
    const result = lazyloadTransform(html, setWithRows(['préférences.jpg']));
    expect(result.html.startsWith('<!doctype html>\n')).toBe(true);
    expect(result.html).toContain('src="préférences.jpg"');
    expect(result.html.endsWith('\uD800')).toBe(true);
  });

  it('restores an img whose lazy value carries quotes of the other style', () => {
    const html = `<img src='ph' data-lazy-src="real.jpg">`;
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    // The destination attribute's own quote style is kept.
    expect(result.html).toBe(`<img src='real.jpg' data-wpr-fdt-excluded="lazyload">`);
  });
});

describe('lazyloadTransform — marker accumulation', () => {
  it('appends the lazyload id to an existing marker value', () => {
    const html = '<img src="ph" data-lazy-src="real.jpg" data-wpr-fdt-excluded="delay_js">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js,lazyload"');
  });
});
