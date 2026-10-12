/**
 * Class fragments shared between sibling primitives in `components/ui/`.
 *
 * Declared once here (never re-typed in a second primitive) so interactive
 * surfaces cannot drift apart on their focus treatment. Primitives are styled
 * exclusively through Tailwind utilities over the P0 tokens — no hardcoded
 * palette colors, so both palettes come free through the `light-dark()` tokens.
 */

/**
 * Keyboard-focus treatment for every interactive primitive.
 *
 * An accent outline ring that only appears for keyboard focus
 * (`:focus-visible`), never stealing pointer users' clicks visuals; the accent
 * token is the P0-verified 3:1 non-text indicator across all surfaces.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/**
 * The disabled treatment: dimmed but still hoverable.
 *
 * `pointer-events-none` is deliberately NOT applied — native disabled buttons
 * keep receiving pointer *hover*, which surfaces must rely on to show tooltips
 * explaining why the control is disabled (e.g. reserved nav rows).
 */
export const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed';
