/**
 * The highlighting cost model shared by `code-block.tsx` and its lazy
 * highlighter — shiki-free, so the component can decide synchronously (no
 * chunk load) whether a text fits one bounded slice.
 */

/**
 * The end offsets of the text's lines, exclusive of their break (`\n`, or
 * `\r\n` as one break — shiki's own line split).
 *
 * @param code The code text.
 * @returns One `[start, end)` pair per line.
 */
export function lineSpans(code: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let start = 0;
  for (;;) {
    const newline = code.indexOf('\n', start);
    if (newline === -1) {
      spans.push([start, code.length]);
      return spans;
    }
    spans.push([start, newline > start && code[newline - 1] === '\r' ? newline - 1 : newline]);
    start = newline + 1;
  }
}

/**
 * Lines at or above this length are emitted as plain text, untokenized
 * (shiki's `tokenizeMaxLineLength`). The JS grammar's time grows with the
 * square of a string token's length — measured on the registered grammar a
 * quoted 500-char string line costs ≈ 15 ms, 800 ≈ 35 ms, 2,000 ≈ 200 ms,
 * and a 30 KB data URI seconds. Longer lines (minified bundles, data URIs)
 * stay readable, just uncolored.
 */
export const MAX_TOKENIZED_LINE = 500;

/**
 * Slice bounds of {@link CodeHighlighter.highlightSliced}, by text — never
 * by time or line count (fifteen long lines are one slow "short" slice). A
 * slice holds whole lines, at least one, while their characters stay within
 * {@link MAX_SLICE_CHARS} (linear cost: ≈ 15 ms of ordinary code) and the sum
 * of their squared lengths within {@link MAX_SLICE_WEIGHT} (the quadratic
 * cost of long string tokens: at most one capped line's worth). Every slice
 * is therefore bounded well under a long task (50 ms), whatever the code.
 */
export const MAX_SLICE_CHARS = 4_000;
/** The quadratic slice bound: one line just under {@link MAX_TOKENIZED_LINE}. */
export const MAX_SLICE_WEIGHT = MAX_TOKENIZED_LINE * MAX_TOKENIZED_LINE;

/**
 * A line's tokenizing weight: its squared length, or nothing for a line the
 * cap leaves untokenized (emitted as plain text, linear).
 *
 * @param length The line's length.
 */
function lineWeight(length: number): number {
  return length >= MAX_TOKENIZED_LINE ? 0 : length * length;
}

/**
 * The slices of a text: runs of whole lines within both bounds above.
 *
 * @param spans The text's line spans (see {@link lineSpans}).
 * @returns `[first, last]` line-index pairs, in order, covering every line.
 */
export function sliceLines(
  spans: ReadonlyArray<readonly [number, number]>
): Array<[number, number]> {
  const slices: Array<[number, number]> = [];
  for (let first = 0; first < spans.length;) {
    const start = spans[first]?.[0] ?? 0;
    let last = first;
    let weight = lineWeight((spans[first]?.[1] ?? 0) - start);
    for (;;) {
      const next = spans[last + 1];
      if (next === undefined) break;
      const nextWeight = lineWeight(next[1] - next[0]);
      if (next[1] - start > MAX_SLICE_CHARS || weight + nextWeight > MAX_SLICE_WEIGHT) break;
      weight += nextWeight;
      last += 1;
    }
    slices.push([first, last]);
    first = last + 1;
  }
  return slices;
}

/**
 * Whether a text fits one slice — highlighting it in one synchronous call is
 * then bounded like any slice (no plain-text flash, no long task).
 *
 * @param code The code text.
 */
export function fitsOneSlice(code: string): boolean {
  return sliceLines(lineSpans(code)).length === 1;
}
