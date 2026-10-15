/**
 * The highlighting cost model: line spans, slice bounds (characters and the
 * quadratic weight of long string lines) and the one-slice test the block
 * uses to choose synchronous highlighting.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SLICE_CHARS,
  MAX_SLICE_WEIGHT,
  MAX_TOKENIZED_LINE,
  fitsOneSlice,
  lineSpans,
  sliceLines
} from './code-block-slices';

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

describe('sliceLines', () => {
  /** Spans of `count` lines of `length` chars each. */
  const lines = (count: number, length: number): Array<[number, number]> =>
    lineSpans(Array.from({ length: count }, () => 'x'.repeat(length)).join('\n'));

  it('keeps short code in one slice', () => {
    expect(sliceLines(lines(10, 40))).toEqual([[0, 9]]);
  });

  it('caps a slice by characters', () => {
    const slices = sliceLines(lines(100, 99));
    for (const [first, last] of slices)
      expect((last - first + 1) * 100 - 1).toBeLessThanOrEqual(MAX_SLICE_CHARS);
    expect(slices.at(-1)?.[1]).toBe(99);
  });

  it('caps a slice by the quadratic weight: one near-cap line each', () => {
    const near = MAX_TOKENIZED_LINE - 1;
    expect(near * near).toBeLessThanOrEqual(MAX_SLICE_WEIGHT);
    expect(sliceLines(lines(3, near))).toEqual([
      [0, 0],
      [1, 1],
      [2, 2]
    ]);
  });

  it('weighs lines at the cap as plain text (linear only)', () => {
    // Untokenized lines cost no quadratic weight; the char cap still applies.
    expect(sliceLines(lines(3, MAX_TOKENIZED_LINE))).toEqual([[0, 2]]);
    expect(sliceLines(lines(1, MAX_SLICE_CHARS * 3))).toEqual([[0, 0]]);
  });

  it('covers every line exactly once, in order', () => {
    const spans = lineSpans(
      Array.from({ length: 300 }, (_, i) => 'z'.repeat((i * 37) % 700)).join('\n')
    );
    const covered = sliceLines(spans).flatMap(([first, last]) =>
      Array.from({ length: last - first + 1 }, (_, k) => first + k)
    );
    expect(covered).toEqual(spans.map((_, index) => index));
  });
});

describe('fitsOneSlice', () => {
  it('is true for short code and false past either bound', () => {
    expect(fitsOneSlice('const a = 1;')).toBe(true);
    expect(fitsOneSlice('')).toBe(true);
    expect(fitsOneSlice(Array.from({ length: 50 }, () => 'y'.repeat(99)).join('\n'))).toBe(false);
    const near = 'q'.repeat(MAX_TOKENIZED_LINE - 1);
    expect(fitsOneSlice(`${near}\n${near}`)).toBe(false);
  });
});
