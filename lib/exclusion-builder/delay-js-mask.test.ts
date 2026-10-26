/**
 * Tests for the regions WP Rocket's Delay JS masks before matching scripts.
 * Expected regions follow `#<xmp.*>.*</xmp>#Uis` then
 * `#<\s*svg.*>.*<\s*\\?/\s*svg\s*>#Uis`; whole-page agreement with the real
 * plugin is pinned by the `match-delay-mask-*` parity rows.
 */
import { describe, expect, it } from 'vitest';
import {
  MASK_ID_SAMPLES,
  delayMaskedRegions,
  maskPlaceholder,
  maskedSlice,
  type MaskedRegion
} from './delay-js-mask';

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

  it('samples ids shaped like PHP’s uniqid (13 hex digits), all distinct', () => {
    for (const id of MASK_ID_SAMPLES) expect(id).toMatch(/^[0-9a-f]{13}$/);
    expect(new Set(MASK_ID_SAMPLES).size).toBe(MASK_ID_SAMPLES.length);
  });
});
