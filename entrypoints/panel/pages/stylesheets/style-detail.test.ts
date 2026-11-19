/** The CSS block's shown text: served or formatted, bounded by the render cap either way. */
import { describe, expect, it } from 'vitest';
import { cssDisplay, STYLE_DISPLAY_MAX_CHARS } from './style-detail';

describe('cssDisplay', () => {
  it('shows the served CSS as is, or formatted', () => {
    expect(cssDisplay('a{top:0}', false)).toEqual({ text: 'a{top:0}', cut: false });
    expect(cssDisplay('a{top:0}', true)).toEqual({ text: 'a {\n  top:0\n}', cut: false });
  });

  it('cuts the served CSS at the render cap (said so), formatted or not', () => {
    const css = 'a{top:0}'.repeat(STYLE_DISPLAY_MAX_CHARS / 8 + 1);
    const served = cssDisplay(css, false);
    expect(served.text).toHaveLength(STYLE_DISPLAY_MAX_CHARS);
    expect(served.cut).toBe(true);
    const formatted = cssDisplay(css, true);
    expect(formatted.text.length).toBeLessThanOrEqual(STYLE_DISPLAY_MAX_CHARS);
    expect(formatted.cut).toBe(true);
  });

  it('says so when formatting alone grows the shown part past the cap', () => {
    // Just under the cap served; the re-flow's line breaks and indents push it over.
    const css = 'a{top:0}'.repeat(Math.floor(STYLE_DISPLAY_MAX_CHARS / 8));
    expect(cssDisplay(css, false).cut).toBe(false);
    const formatted = cssDisplay(css, true);
    expect(formatted.text).toHaveLength(STYLE_DISPLAY_MAX_CHARS);
    expect(formatted.cut).toBe(true);
  });
});
