/**
 * The Known Conflicts widget's stroke icons, as inline SVG path data consumed
 * through the entrypoint's shared factory — one declaring site per icon,
 * geometry verified against the lucide package the panel surfaces ship
 * (an icon runtime is not justified inside this bundle's budget).
 *
 * The shared glyphs (close) live beside the factory in `ui/icons`.
 */

/** Conflict marker: the alert triangle (lucide `triangle-alert`). */
export const ALERT_ICON_PATHS = [
  'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
  'M12 9v4',
  'M12 17h.01'
] as const;

/** Collapse-handle glyph (lucide `chevron-left`; flipped per state in CSS). */
export const COLLAPSE_ICON_PATHS = ['m15 18-6-6 6-6'] as const;

/** Empty-state icon: ringed check (lucide `circle-check` — path + circle). */
export const CLEAR_ICON_PATHS = ['m16 9-5.5 5.5L8 12'] as const;
/** {@link CLEAR_ICON_PATHS}'s surrounding ring. */
export const CLEAR_ICON_CIRCLE = { cx: 12, cy: 12, r: 10 } as const;

/** Row-hover navigation affordance (lucide `external-link`). */
export const OPEN_ICON_PATHS = [
  'M15 3h6v6',
  'M10 14 21 3',
  'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'
] as const;
