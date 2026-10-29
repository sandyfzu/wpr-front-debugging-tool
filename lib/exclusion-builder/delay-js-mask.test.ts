/**
 * Tests for the regions WP Rocket's Delay JS masks before matching scripts.
 * Expected regions follow `#<xmp.*>.*</xmp>#Uis` then
 * `#<\s*svg.*>.*<\s*\\?/\s*svg\s*>#Uis`; whole-page agreement with the real
 * plugin is pinned by the `match-delay-mask-*` parity rows.
 */
import { describe, expect, it } from 'vitest';
import {
  MASK_ID_SENTINEL,
  delayMaskScan,
  delayMaskedRegions,
  delayXmpRegions,
  firstRegionFrom,
  maskPlaceholder,
  maskedForMatching,
  maskedSlice,
  type MaskedRegion
} from './delay-js-mask';

describe('maskedForMatching', () => {
  it('writes sentinel placeholders and knows where their ids are', () => {
    const { text, ids } = maskedForMatching(`<script>a='<svg>1</svg>';b='<xmp>2</xmp>'</script>`);
    expect(text).toBe(
      `<script>a='${maskPlaceholder('svg', MASK_ID_SENTINEL)}';b='${maskPlaceholder('xmp', MASK_ID_SENTINEL)}'</script>`
    );
    expect(ids.map((id) => text.slice(id - 8, id + 17))).toEqual([
      `WPR_SVG_${MASK_ID_SENTINEL} -->`,
      `WPR_XMP_${MASK_ID_SENTINEL} -->`
    ]);
  });

  it('never takes the page’s own spelling of a placeholder for one', () => {
    const page = `<script>q='WPR_SVG_${MASK_ID_SENTINEL} --><svg></svg>';</script>`;
    const { text, ids } = maskedForMatching(page);
    expect(ids).toEqual([text.lastIndexOf(MASK_ID_SENTINEL)]);
  });
});

/** The page's regions as their text and kind. */
const regionsOf = (html: string): string[] =>
  delayMaskedRegions(html).map(
    (region) => `${region.kind}:${html.slice(region.start, region.end)}`
  );

describe('delayMaskedRegions', () => {
  it('finds none on a page naming neither tag', () => {
    expect(delayMaskedRegions('<p>x</p><script>y()</script>')).toEqual([]);
  });

  it('reads the regexes textually: tags inside strings, comments and attributes count', () => {
    expect(regionsOf(`<script>a='<svg>';</script><script>b='</svg>';</script>`)).toEqual([
      `svg:<svg>';</script><script>b='</svg>`
    ]);
    expect(regionsOf('<!-- <svg> --><b></svg>')).toEqual(['svg:<svg> --><b></svg>']);
    expect(regionsOf('<i data-x="<svg>">t</i></svg>')).toEqual(['svg:<svg>">t</i></svg>']);
  });

  it('ends a region at the first close after the opening’s first `>` (lazy)', () => {
    expect(regionsOf('<svg><svg></svg>x</svg>')).toEqual(['svg:<svg><svg></svg>']);
    // The opening's first `>` may be a close's own: the region runs to the next close.
    expect(regionsOf('<svg a="</svg>">b</svg>')).toEqual(['svg:<svg a="</svg>">b</svg>']);
  });

  it('accepts the svg pattern’s spaces, `\\/`, case and tag-name prefixes', () => {
    expect(regionsOf('< svg>x< / svg >')).toEqual(['svg:< svg>x< / svg >']);
    expect(regionsOf('<svg>x<\\/svg>')).toEqual(['svg:<svg>x<\\/svg>']);
    expect(regionsOf('<SVG>x</Svg\t>')).toEqual(['svg:<SVG>x</Svg\t>']);
    expect(regionsOf('<svg-icon>x</svg>')).toEqual(['svg:<svg-icon>x</svg>']);
  });

  it('keeps the xmp pattern strict: no spaces in its close, caseless', () => {
    expect(regionsOf('<XMP>x</xmp>')).toEqual(['xmp:<XMP>x</xmp>']);
    expect(regionsOf('<xmp>x</ xmp>')).toEqual([]);
  });

  it('finds nothing from an opening with no close after it, nor from later ones', () => {
    expect(regionsOf('<svg>x')).toEqual([]);
    expect(regionsOf('<svg x')).toEqual([]);
    expect(regionsOf('<svg>a</svg><svg>b')).toEqual(['svg:<svg>a</svg>']);
  });

  it('lists several regions in page order', () => {
    expect(regionsOf('<xmp>1</xmp><svg>2</svg><xmp>3</xmp>')).toEqual([
      'xmp:<xmp>1</xmp>',
      'svg:<svg>2</svg>',
      'xmp:<xmp>3</xmp>'
    ]);
  });

  it('masks xmp first: an svg tag inside an xmp region is hidden from the svg regex', () => {
    expect(regionsOf('<xmp><svg></xmp>x</svg>')).toEqual(['xmp:<xmp><svg></xmp>']);
  });

  it('lets an svg region take in xmp regions (listed once, as svg)', () => {
    expect(regionsOf('<svg><xmp>1</xmp></svg>')).toEqual(['svg:<svg><xmp>1</xmp></svg>']);
    // The svg region ends after the xmp one, mapped back to page offsets.
    expect(regionsOf('a<svg>b<xmp></svg></xmp>c</svg>d')).toEqual([
      'svg:<svg>b<xmp></svg></xmp>c</svg>'
    ]);
  });

  it('stays linear on a page of unclosed openings', () => {
    const html = '<svg>'.repeat(50_000) + '<xmp>'.repeat(50_000);
    const started = performance.now();
    expect(delayMaskedRegions(html)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('firstRegionFrom', () => {
  const regions = delayMaskedRegions('a<svg>1</svg>b<xmp>2</xmp>c<svg>3</svg>');

  it('finds the first region starting at or after an offset', () => {
    expect(regions.map((region) => region.start)).toEqual([1, 14, 27]);
    expect(firstRegionFrom(regions, 0)).toBe(0);
    expect(firstRegionFrom(regions, 1)).toBe(0);
    expect(firstRegionFrom(regions, 2)).toBe(1);
    expect(firstRegionFrom(regions, 14)).toBe(1);
    expect(firstRegionFrom(regions, 27)).toBe(2);
    expect(firstRegionFrom(regions, 28)).toBe(3);
    expect(firstRegionFrom([], 5)).toBe(0);
  });
});

describe('maskedSlice', () => {
  const html = 'a<svg>1</svg>b<xmp>2</xmp>c';
  const regions: readonly MaskedRegion[] = delayMaskedRegions(html);

  it('writes each region inside the slice as its placeholder', () => {
    expect(maskedSlice(html, 0, html.length, regions, 'ID')).toBe(
      `a${maskPlaceholder('svg', 'ID')}b${maskPlaceholder('xmp', 'ID')}c`
    );
  });

  it('leaves regions outside the slice out', () => {
    expect(maskedSlice(html, 13, html.length, regions, 'ID')).toBe(
      `b${maskPlaceholder('xmp', 'ID')}c`
    );
    expect(maskedSlice(html, 0, 1, regions, 'ID')).toBe('a');
  });

  it('writes WP Rocket’s placeholder shape', () => {
    expect(maskPlaceholder('svg', '6713e5a1b2c3d')).toBe('<!-- WPR_SVG_6713e5a1b2c3d -->');
    expect(maskPlaceholder('xmp', '0')).toBe('<!-- WPR_XMP_0 -->');
  });

  it('writes the sentinel id as 13 NULs, an id’s length', () => {
    expect(MASK_ID_SENTINEL).toBe('\0'.repeat(13));
  });
});

describe('delayXmpRegions', () => {
  it('lists every xmp region, those inside svg regions included', () => {
    const html = '<xmp>a</xmp><svg><xmp>b</xmp></svg><XMP x>c</XMP>';
    expect(delayXmpRegions(html)).toEqual([
      { start: 0, end: 12, kind: 'xmp' },
      { start: 17, end: 29, kind: 'xmp' },
      { start: 35, end: 49, kind: 'xmp' }
    ]);
    expect(delayMaskedRegions(html).map((region) => region.kind)).toEqual(['xmp', 'svg', 'xmp']);
  });

  it('finds none without an xmp', () => {
    expect(delayXmpRegions('<svg></svg>')).toEqual([]);
  });
});

describe('delayMaskScan', () => {
  it('lists the regions as delayMaskedRegions does', () => {
    const html = '<svg><xmp>a</xmp></svg><xmp>b</xmp><svg>c</svg>';
    expect(delayMaskScan(html).regions).toEqual(delayMaskedRegions(html));
  });

  it('names where each regex gives up reading to the end (an opening with a `>`, no close)', () => {
    const html = '<xmp>a</xmp><svg>b</svg><svg x>c<xmp>d';
    // 12 + 12 + 7 + 1: the last `<xmp` has a `>` and no close; so has the `<svg x>`.
    expect(delayMaskScan(html).unclosed).toEqual({ xmp: 32, svg: 24 });
  });

  it('maps an unclosed svg opening read past xmp placeholders back to the page', () => {
    const html = '<xmp>long xmp text</xmp><svg>';
    expect(delayMaskScan(html).unclosed).toEqual({ xmp: -1, svg: 24 });
  });

  it('names none for an opening with no `>` after it (that attempt ends at once)', () => {
    expect(delayMaskScan('<svg').unclosed).toEqual({ xmp: -1, svg: -1 });
    expect(delayMaskScan('<p>plain</p>').unclosed).toEqual({ xmp: -1, svg: -1 });
  });
});
