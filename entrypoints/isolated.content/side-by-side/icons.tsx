/**
 * The stroke icons the overlay needs, as inline SVG path data — the content
 * script must stay inside a hard bundle budget, and two hand-drawn strokes do
 * not justify an icon-package runtime (a decision recorded in the phase doc:
 * the icon package remains available to the panel surfaces, which have a much
 * larger budget).
 *
 * Data is the same stroke geometry the shipped overlay used (24 viewBox,
 * 1.5 stroke, round caps/joins); rendering matches the original icons.
 *
 * NOTE: deliberate un-sandboxed decision containers (see `index.tsx`): the
 * per-side refresh and close controls are plain buttons.
 */

import { StrokeIcon } from '../ui/icons';

/** Refresh (circular arrows), one path — the classic cycle glyph. */
export const REFRESH_ICON_PATHS = [
  'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99'
] as const;

/**
 * Close: the shared shared-glyph row (two or more surfaces) — this module is
 * the overlay's icon surface; the geometry itself is single-sourced in
 * `ui/icons` and re-exported so the overlay's own import shape stays local.
 */
export { CLOSE_ICON_PATHS } from '../ui/icons';

export { StrokeIcon };
