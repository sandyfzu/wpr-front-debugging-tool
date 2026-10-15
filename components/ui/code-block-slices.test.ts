/**
 * The highlighting cost model: line spans, the quote-free span measure, the
 * plain-line rule, slice bounds (characters and the quadratic span weight)
 * and the one-slice test the block uses to choose synchronous highlighting.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SLICE_CHARS,
  MAX_TOKEN_SPAN,
  MAX_TOKENIZED_LINE,
  fitsOneSlice,
  lineSpans,
  longestQuoteFreeSpan,
  sliceLines
} from './code-block-slices';

/** The slices of a text, as `[first, last, plain]` triples. */
function slicesOf(code: string): Array<[number, number, boolean]> {
  return sliceLines(code, lineSpans(code)).map((slice) => [slice.first, slice.last, slice.plain]);
}

/** A config-object line: many short strings, any total length. */
function configLine(chars: number): string {
  const items: string[] = [];
  for (let i = 0; items.join(',').length < chars; i += 1) {
    items.push(`"key${String(i)}":"v${String(i)}"`);
  }
  return `var wpApiSettings = {${items.join(',')}};`;
}

describe('lineSpans', () => {
  it('splits on LF and CRLF, excluding the break', () => {
    expect(lineSpans('')).toEqual([[0, 0]]);
    expect(lineSpans('ab')).toEqual([[0, 2]]);
    expect(lineSpans('a\nbc\r\nd\n')).toEqual([
      [0, 1],
      [2, 4],
      [6, 7],
      [8, 8]
    ]);
    expect(lineSpans('\r\n')).toEqual([
      [0, 0],
      [2, 2]
    ]);
  });
});

describe('longestQuoteFreeSpan', () => {
  it('measures the longest run between quote characters or line ends', () => {
    expect(longestQuoteFreeSpan('', 0, 0)).toBe(0);
    expect(longestQuoteFreeSpan('abc', 0, 3)).toBe(3);
    expect(longestQuoteFreeSpan('a"bcd"e', 0, 7)).toBe(3);
    expect(longestQuoteFreeSpan("x='12345'`ab`", 0, 13)).toBe(5);
    // Only the given line counts.
    expect(longestQuoteFreeSpan('zzzz"a"zzzz', 4, 7)).toBe(1);
  });
});

describe('sliceLines', () => {
  it('keeps short code in one tokenized slice', () => {
    expect(slicesOf(Array.from({ length: 10 }, () => 'f("a", 1);').join('\n'))).toEqual([
      [0, 9, false]
    ]);
  });

  it('caps a tokenized slice by characters', () => {
    const code = Array.from(
      { length: 100 },
      () => `f("${'a'.repeat(40)}", 1); // ${'c'.repeat(40)}`
    ).join('\n');
    const spans = lineSpans(code);
    const slices = sliceLines(code, spans);
    expect(slices.length).toBeGreaterThan(1);
    for (const slice of slices) {
      const chars = (spans[slice.last]?.[1] ?? 0) - (spans[slice.first]?.[0] ?? 0);
      expect(chars <= MAX_SLICE_CHARS || slice.first === slice.last).toBe(true);
    }
  });

  it('caps a tokenized slice by the quadratic weight: one near-cap span each', () => {
    const near = `x = "${'q'.repeat(MAX_TOKEN_SPAN - 1)}";`;
    expect(slicesOf([near, near, near].join('\n'))).toEqual([
      [0, 0, false],
      [1, 1, false],
      [2, 2, false]
    ]);
  });

  it('emits a long string, regex or comment line plain, and keeps long config lines tokenized', () => {
    const longString = `x = "${'q'.repeat(MAX_TOKEN_SPAN)}";`;
    const longRegex = `var r = /${'q'.repeat(MAX_TOKEN_SPAN)}/;`;
    const config = configLine(1_500);
    expect(config.length).toBeGreaterThan(1_400);
    expect(slicesOf([longString, longRegex, config].join('\n'))).toEqual([
      [0, 1, true],
      [2, 2, false]
    ]);
    expect(slicesOf('y'.repeat(MAX_TOKENIZED_LINE).replace(/(.{100})/g, '"$1'))).toEqual([
      [0, 0, true]
    ]);
  });

  it('covers every line exactly once, in order', () => {
    const code = Array.from({ length: 300 }, (_, i) => `"${'z'.repeat((i * 37) % 700)}"`).join(
      '\n'
    );
    const covered = sliceLines(code, lineSpans(code)).flatMap((slice) =>
      Array.from({ length: slice.last - slice.first + 1 }, (_, k) => slice.first + k)
    );
    expect(covered).toEqual(lineSpans(code).map((_, index) => index));
  });
});

describe('fitsOneSlice', () => {
  it('is true for short code and false past either bound', () => {
    expect(fitsOneSlice('const a = 1;')).toBe(true);
    expect(fitsOneSlice('')).toBe(true);
    expect(fitsOneSlice(configLine(1_500))).toBe(true);
    expect(fitsOneSlice(Array.from({ length: 50 }, () => '"y", 1;'.repeat(12)).join('\n'))).toBe(
      false
    );
    const near = `x = "${'q'.repeat(MAX_TOKEN_SPAN - 1)}";`;
    expect(fitsOneSlice(`${near}\n${near}`)).toBe(false);
  });
});
