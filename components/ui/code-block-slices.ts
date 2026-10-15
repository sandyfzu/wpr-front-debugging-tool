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
 * Backstop: lines at or above this length are emitted plain by shiki itself
 * (`tokenizeMaxLineLength`) — minified bundles and the like.
 */
export const MAX_TOKENIZED_LINE = 2_000;

/**
 * Lines whose longest **quote-free span** reaches this length are emitted
 * plain, untokenized. The JS grammar's cost grows with the square of one
 * token's length, and how fast depends on the context before it. Measured on
 * the registered grammar (node, 2026-10-14), a 2,000-char token costs 13 ms
 * as `var s="…"` but 215 ms as `var s0 = "…"`, 280–350 ms as `x = "…"` or
 * `{k:"…"}` with base64 inside, 135 ms as a regex literal, 70 ms as a block
 * comment; at 500 chars the worst shape is ≈ 39 ms, at 320 ≈ 16 ms. Lines
 * with many short strings — config objects such as `wpApiSettings` or a
 * script's localized `*_params`, gtag calls — stay colored however long
 * (≈ 4 ms for 2,000 chars of JSON); one long string, regex or comment makes
 * the line plain, still readable. The span between quote characters (or a
 * line end) bounds every string token, and on quote-free lines the whole
 * line, so the measure is conservative.
 */
export const MAX_TOKEN_SPAN = 320;

/**
 * Slice bounds of {@link CodeHighlighter.highlightSliced}, by text — never by
 * time or line count. A tokenized slice holds whole lines, at least one,
 * within {@link MAX_SLICE_CHARS} (the linear cost: ≈ 9 ms of dense ordinary
 * code) and within {@link MAX_SLICE_WEIGHT} summed squared spans (the
 * quadratic cost: one worst-case span); plain lines go in plain slices
 * (linear only). Every slice is therefore bounded well under a long task.
 */
export const MAX_SLICE_CHARS = 2_500;
/** The quadratic slice bound: one span just under {@link MAX_TOKEN_SPAN}. */
export const MAX_SLICE_WEIGHT = MAX_TOKEN_SPAN * MAX_TOKEN_SPAN;

/** One slice: lines `first..last` (inclusive), tokenized or emitted plain. */
export interface CodeSlice {
  readonly first: number;
  readonly last: number;
  readonly plain: boolean;
}

/**
 * The longest run of a line without a quote character (`"`, `'`, `` ` ``),
 * line ends included — an upper bound of any string token on the line.
 *
 * @param code The code text.
 * @param start The line's start offset.
 * @param end The line's end offset (exclusive).
 */
export function longestQuoteFreeSpan(code: string, start: number, end: number): number {
  let longest = 0;
  let from = start;
  for (let at = start; at < end; at += 1) {
    const char = code.charCodeAt(at);
    // 34 `"`, 39 `'`, 96 `` ` ``
    if (char === 34 || char === 39 || char === 96) {
      longest = Math.max(longest, at - from);
      from = at + 1;
    }
  }
  return Math.max(longest, end - from);
}

/**
 * A line's quadratic weight, or `null` when the line is emitted plain.
 *
 * @param code The code text.
 * @param span The line's `[start, end)`.
 */
function lineWeight(code: string, span: readonly [number, number]): number | null {
  if (span[1] - span[0] >= MAX_TOKENIZED_LINE) return null;
  const longest = longestQuoteFreeSpan(code, span[0], span[1]);
  return longest >= MAX_TOKEN_SPAN ? null : longest * longest;
}

/**
 * The slices of a text: runs of whole lines of one kind (tokenized or
 * plain) within the bounds above, covering every line in order.
 *
 * @param code The code text.
 * @param spans The text's line spans (see {@link lineSpans}).
 */
export function sliceLines(
  code: string,
  spans: ReadonlyArray<readonly [number, number]>
): CodeSlice[] {
  const weights = spans.map((span) => lineWeight(code, span));
  const slices: CodeSlice[] = [];
  for (let first = 0; first < spans.length;) {
    const start = spans[first]?.[0] ?? 0;
    const plain = weights[first] === null;
    let weight = weights[first] ?? 0;
    let last = first;
    for (;;) {
      const next = spans[last + 1];
      if (next === undefined) break;
      const nextWeight = weights[last + 1] ?? null;
      if ((nextWeight === null) !== plain || next[1] - start > MAX_SLICE_CHARS) break;
      if (!plain && weight + (nextWeight ?? 0) > MAX_SLICE_WEIGHT) break;
      weight += nextWeight ?? 0;
      last += 1;
    }
    slices.push({ first, last, plain });
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
  return sliceLines(code, lineSpans(code)).length === 1;
}
