/**
 * Where a list shows its selected row's detail: beside the list (a side pane)
 * once the list's own content box is wide enough for both, otherwise as a
 * drill-in view that replaces the list. One rule for every list page; the CSS
 * side reads the same threshold as the `@split` container variant.
 */

/** `pane`: detail beside the list; `drill`: detail replaces the list (Back returns). */
export type DetailLayout = 'pane' | 'drill';

/**
 * The content width (px) from which a list shows its detail as a side pane.
 * Below it a pane would squeeze the rows under the compact floor, so the
 * detail drills in instead. Mirrored by `--container-split` in
 * `assets/css/theme.css` (container conditions compile to literals, so the
 * CSS cannot read this value; a test pins the two together).
 */
export const DETAIL_PANE_MIN_CONTENT_WIDTH = 830;

/**
 * Pick the detail layout for a list's measured content width. Same comparison
 * as the CSS `@container (width >= 830px)` the `@split:` variant compiles to,
 * so script and styles never disagree at a fractional width.
 *
 * @param contentWidth The list container's content-box width in px (`0` while hidden).
 * @returns `pane` from {@link DETAIL_PANE_MIN_CONTENT_WIDTH} on, else `drill`.
 * @throws {@link RangeError} When the width is negative or not finite — a
 *   measuring bug, never a real layout.
 */
export function detailLayout(contentWidth: number): DetailLayout {
  if (!Number.isFinite(contentWidth) || contentWidth < 0) {
    throw new RangeError(
      `detailLayout: content width must be a finite number ≥ 0, got ${String(contentWidth)}.`
    );
  }
  return contentWidth >= DETAIL_PANE_MIN_CONTENT_WIDTH ? 'pane' : 'drill';
}
