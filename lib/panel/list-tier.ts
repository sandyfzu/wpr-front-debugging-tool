/**
 * A list's density tier from its own measured width: compact lists stack
 * their rows and fold their facets into a Filters button + bottom sheet;
 * regular-and-up lists lay rows in columns and show facets inline. The CSS
 * side reads the same threshold as the `@regular` container variant.
 */

/** `compact`: stacked rows, facets in a sheet; `regular`: columns, facets inline. */
export type ListTier = 'compact' | 'regular';

/**
 * The content width (px) from which a list is `regular`. Mirrored by
 * `--container-regular` in `assets/css/theme.css` (container conditions
 * compile to literals, so the CSS cannot read this value; a test pins the
 * two together).
 */
export const LIST_REGULAR_MIN_CONTENT_WIDTH = 480;

/**
 * Pick the tier for a list's measured content width — the same comparison as
 * the `@container (width >= 480px)` the `@regular:` variant compiles to, so
 * a row's CSS stacking and the script-driven facet fold never disagree.
 *
 * @param contentWidth The list container's content-box width in px (`0` while hidden).
 * @returns `regular` from {@link LIST_REGULAR_MIN_CONTENT_WIDTH} on, else `compact`.
 * @throws {@link RangeError} When the width is negative or not finite — a
 *   measuring bug, never a real layout.
 */
export function listTier(contentWidth: number): ListTier {
  if (!Number.isFinite(contentWidth) || contentWidth < 0) {
    throw new RangeError(
      `listTier: content width must be a finite number ≥ 0, got ${String(contentWidth)}.`
    );
  }
  return contentWidth >= LIST_REGULAR_MIN_CONTENT_WIDTH ? 'regular' : 'compact';
}
