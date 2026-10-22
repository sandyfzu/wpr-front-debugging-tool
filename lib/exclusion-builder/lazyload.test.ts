/**
 * The Image Lazyload transform: candidate images carry a truthy
 * `data-lazy-src` (the plugin's own runtime candidacy); rows are LITERAL,
 * case-sensitive substrings of WP Rocket's subjects — the original image's
 * `atts` and trimmed `src` — read from the `<noscript>` copy WP Rocket
 * serves, else from the clone with only `src` restored (the other lazy
 * carriers still parked); a matched image then moves `src`/`srcset`/`sizes`
 * back from their carriers.
 */
import { describe, expect, it } from 'vitest';
import { ExclusionValidationError } from './errors';
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

describe('lazyloadTransform — candidacy', () => {
  it('is the identity when no image carries lazy attributes', () => {
    const html = '<img src="eager.jpg"><img data-lazy-original>';
    const result = lazyloadTransform(html, setWithRows(['eager.jpg']));
    expect(result.html).toBe(html);
    expect(result.report).toEqual({
      feature: 'lazyload',
      featureWide: false,
      candidates: 0,
      rewritten: 0,
      regionRemovals: 0,
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

  it('is not a candidate on srcset-only or sizes-only carriers — no truthy `data-lazy-src`', () => {
    const html =
      '<img src="ph.gif" data-lazy-srcset="real.jpg 1x"><img src="ph.gif" data-lazy-sizes="100vw">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.report.candidates).toBe(0);
    expect(result.html).toBe(html);
  });

  it('is not a candidate on a valueless or empty `data-lazy-src`', () => {
    const html = '<img src="ph" data-lazy-src><img src="ph2" data-lazy-src="">';
    const result = lazyloadTransform(html, setWithRows(['ph']));
    expect(result.report.candidates).toBe(0);
    expect(result.html).toBe(html);
  });

  it('never lets the served placeholder clobber the restored value — an empty `src` is overwritten', () => {
    const html = '<img src="" data-lazy-src="real.jpg">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toBe('<img src="real.jpg" data-wpr-fdt-excluded="lazyload">');
  });
});

describe('lazyloadTransform — restoring a matched image', () => {
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
      regionRemovals: 0,
      matchedRows: [{ row: 'photo.jpg', rowKind: 'literal', matches: 1 }],
      unmatchedRows: [],
      // No `<noscript>` copy follows: matched against the rebuilt original.
      approximate: 1
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

  it('restores a matched image whose srcset is carrier-only (sizes absent)', () => {
    const html = '<img src="ph.gif" data-lazy-src="real.jpg" data-lazy-srcset="real.jpg 1x">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toBe(
      '<img src="real.jpg" srcset="real.jpg 1x" data-wpr-fdt-excluded="lazyload">'
    );
  });

  it('moves a value into an existing destination attribute', () => {
    const html =
      '<img src="ph.gif" srcset="old 1x" data-lazy-src="real.jpg" data-lazy-srcset="new 1x">';
    const result = lazyloadTransform(html, setWithRows(['real.jpg']));
    expect(result.html).toBe(
      '<img src="real.jpg" srcset="new 1x" data-wpr-fdt-excluded="lazyload">'
    );
  });
});

describe('lazyloadTransform — literal matching against the only-src-restored clone', () => {
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

  it('matches the still-parked srcset carrier — only `src` is restored on the clone', () => {
    const html = '<img src="ph.gif" data-lazy-src="real.jpg" data-lazy-srcset="real.jpg 1x">';
    const result = lazyloadTransform(html, setWithRows(['data-lazy-srcset="real.jpg 1x"']));
    expect(result.report.rewritten).toBe(1);
    // …and the restore still moves the carrier's value across.
    expect(result.html).toBe(
      '<img src="real.jpg" srcset="real.jpg 1x" data-wpr-fdt-excluded="lazyload">'
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
    expect(result.html).toContain('préférences.jpg');
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
    expect(result.html).toContain('data-wpr-fdt-excluded="delay_js, lazyload"');
  });
});

describe("lazyloadTransform — WP Rocket's subjects (real WP Rocket outcomes)", () => {
  /** A lazy image as WP Rocket serves it: placeholder tag + `<noscript>` original. */
  const served = (lazy: string, original: string): string =>
    `${lazy}<noscript>${original}</noscript>`;
  const PLACEHOLDER = 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E';

  it('reads attributes WP Rocket removed from the served tag off the `<noscript>` original', () => {
    const html = served(
      `<img id="i8" src="${PLACEHOLDER}" data-lazy-src="/img/plain.jpg">`,
      '<img id="i8" src="/img/plain.jpg" loading="lazy">'
    );
    const result = lazyloadTransform(html, setWithRows(['loading="lazy"']));
    expect(result.report.rewritten).toBe(1);
    // The rewrite still restores the served tag; the original stays in its noscript.
    expect(result.html).toBe(
      served(
        '<img id="i8" src="/img/plain.jpg" data-wpr-fdt-excluded="lazyload">',
        '<img id="i8" src="/img/plain.jpg" loading="lazy">'
      )
    );
  });

  it('matches the original `src` as written, untrimmed, and the trimmed value too', () => {
    const html = served(
      '<img id="i2" src=" /img/space.jpg " data-lazy-src="/img/space.jpg">',
      '<IMG id="i2" src=" /img/space.jpg ">'
    );
    expect(lazyloadTransform(html, setWithRows([' /img/space.jpg '])).report.rewritten).toBe(1);
    expect(lazyloadTransform(html, setWithRows(['/img/space.jpg'])).report.rewritten).toBe(1);
    expect(lazyloadTransform(html, setWithRows(['/img/space.jpg"'])).report.rewritten).toBe(0);
  });

  it('starts after `<img` and stops before the closing `>`', () => {
    const html = served(
      `<img id="i1" src="${PLACEHOLDER}" data-lazy-src="/a.jpg">`,
      '<img id="i1" src="/a.jpg" class="k">'
    );
    expect(lazyloadTransform(html, setWithRows(['<img'])).report.rewritten).toBe(0);
    expect(lazyloadTransform(html, setWithRows(['>'])).report.rewritten).toBe(0);
    expect(
      lazyloadTransform(html, setWithRows([' id="i1" src="/a.jpg" class="k"'])).report.rewritten
    ).toBe(1);
  });

  it('restores an image whose `data:` source `esc_url` emptied, from its `<noscript>` original', () => {
    // WP Rocket serves `data-lazy-src=""` for a `data:` src (fixture match-lazyload-data-src).
    const html = served(
      `<img id="w3" src="${PLACEHOLDER}" alt="inline" data-lazy-src="">`,
      '<img id="w3" src="data:image/png;base64,iVBORw0KGgo=" alt="inline">'
    );
    const result = lazyloadTransform(html, setWithRows(['data:image/png']));
    expect(result.report.candidates).toBe(1);
    expect(
      result.html.startsWith(
        '<img id="w3" src="data:image/png;base64,iVBORw0KGgo=" alt="inline" data-wpr-fdt-excluded="lazyload">'
      )
    ).toBe(true);
  });

  it('leaves the `/` and one whitespace before `>` to the ungreedy `\\s?/?>` (PHP-measured)', () => {
    const lazy = `<img id="i0" src="${PLACEHOLDER}" data-lazy-src="/x.svg">`;
    // preg_match('#<img(?<atts>\s.+)\s?/?>#iUs') atts, per original:
    const cases: readonly (readonly [string, string, string])[] = [
      ['<img id="i0" src="/x.svg" />', '" /', '"'],
      ['<img id="i0" src="/x.svg"/>', 'svg"/', 'svg"'],
      ['<img id="i0" src="/x.svg"  />', '"  ', '" '],
      ['<img id="i0" src="/x.svg"\t/ >', '/ ', '\t/'],
      ['<img id="i0" alt="x/" src="/x.svg">', '"/x.svg">', 'x/'],
      ['<img id="i0" src="/x.svg"\n>', 'svg"\n', 'svg"']
    ];
    for (const [original, missing, kept] of cases) {
      const html = served(lazy, original);
      const rewritten = (row: string) =>
        lazyloadTransform(html, setWithRows([row])).report.rewritten;
      expect(rewritten(missing), `${original} ∌ ${missing}`).toBe(0);
      expect(rewritten(kept), `${original} ∋ ${kept}`).toBe(1);
    }
  });

  it('stops at the first `>` even inside a quoted value (rebuilt original)', () => {
    // WP Rocket's own markup breaks on such an image; without a noscript copy
    // the rebuilt original is cut the same way.
    const html = '<img id="i1" src="ph" data-lazy-src="/a.jpg" alt="a>b" class="k">';
    expect(lazyloadTransform(html, setWithRows(['class="k"'])).report.rewritten).toBe(0);
    expect(lazyloadTransform(html, setWithRows(['alt="a'])).report.rewritten).toBe(1);
  });

  it('ignores `""` and `"0"` rows and rejects a whitespace-only one', () => {
    const html = served(
      `<img id="i1" src="${PLACEHOLDER}" data-lazy-src="/0.jpg">`,
      '<img id="i1" src="/0.jpg">'
    );
    const ignored = lazyloadTransform(html, setWithRows(['', '0', 'zzz']));
    expect(ignored.report.rewritten).toBe(0);
    expect(ignored.report.unmatchedRows).toEqual(['', '0', 'zzz']);
    expect(lazyloadTransform(html, setWithRows(['00', '0.jpg'])).report.matchedRows).toEqual([
      { row: '0.jpg', rowKind: 'literal', matches: 1 }
    ]);
    expect(() => lazyloadTransform(html, setWithRows([' ']))).toThrow(ExclusionValidationError);
  });

  it('falls back to the served tag when the next markup is not its `<noscript>` original', () => {
    const lazy = `<img id="i1" src="${PLACEHOLDER}" data-lazy-src="/a.jpg">`;
    // A noscript that does not open with an image, or never closes after it.
    for (const html of [
      `${lazy}<noscript><p>x</p></noscript>`,
      `${lazy}<noscript><img id="i1" src="/a.jpg" loading="lazy">`
    ]) {
      expect(lazyloadTransform(html, setWithRows(['loading'])).report.rewritten).toBe(0);
      expect(lazyloadTransform(html, setWithRows(['src="/a.jpg"'])).report.rewritten).toBe(1);
    }
  });
});
