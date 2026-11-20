/**
 * How a detail view shows code: whether a block opens wrapped. Minified code
 * and data (one long line, a few very long ones) show as one or two lines
 * behind a sideways scroller when they do not wrap — a sliver that hides the
 * source. Wrapped, the same text fills the block's height, which is bounded
 * (it scrolls inside past the detail's visible height), so the whole source
 * is a scroll away in one direction. Hand-written code keeps its lines.
 */

/**
 * A line longer than this (UTF-16 units) marks minified code or data: well
 * past any formatted source's line length (≈ 80–120), short enough to catch
 * a one-line config object.
 */
export const DETAIL_WRAP_MIN_LINE_LENGTH = 160;

/**
 * Whether a detail code block should open wrapped: true when any line is
 * longer than {@link DETAIL_WRAP_MIN_LINE_LENGTH}. One pass with `indexOf`
 * (no split, no line array), so a 200 000-character style costs one scan.
 *
 * @param text The code as shown.
 * @returns True for code with a line too long to read sideways.
 */
export function opensWrapped(text: string): boolean {
  let start = 0;
  let end = text.indexOf('\n');
  while (end !== -1) {
    if (end - start > DETAIL_WRAP_MIN_LINE_LENGTH) return true;
    start = end + 1;
    end = text.indexOf('\n', start);
  }
  // The last line (the whole text when it has no newline).
  return text.length - start > DETAIL_WRAP_MIN_LINE_LENGTH;
}
