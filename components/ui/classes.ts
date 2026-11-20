/**
 * Class fragments shared between sibling primitives in `components/ui/`.
 *
 * Declared once here (never re-typed in a second primitive) so interactive
 * surfaces cannot drift apart on their focus treatment. Primitives are styled
 * exclusively through Tailwind utilities over the design tokens — no hardcoded
 * palette colors, so both palettes come free through the `light-dark()` tokens.
 */

/**
 * Keyboard-focus treatment for every interactive primitive.
 *
 * An accent outline ring that only appears for keyboard focus
 * (`:focus-visible`), never stealing pointer users' clicks visuals; the accent
 * token is the contrast-gated 3:1 non-text indicator across all surfaces.
 */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

/**
 * A tooltip-attributed button's frame (the tooltip's button and menu-trigger
 * forms): the 24px hit floor, content centered. A stand-in for such a
 * trigger takes the same frame, so swapping it in shows no shift.
 */
export const TOOLTIP_TRIGGER_FRAME = 'inline-grid min-h-6 min-w-6 place-items-center rounded';

/**
 * The disabled treatment: dimmed but still hoverable.
 *
 * `pointer-events-none` is deliberately NOT applied — native disabled buttons
 * keep receiving pointer *hover*, which surfaces must rely on to show tooltips
 * explaining why the control is disabled.
 */
export const DISABLED = 'disabled:opacity-50 disabled:cursor-not-allowed';

/*
 * Motion — the three sanctioned Tailwind-surface moments beyond the page
 * entrance (the panel's `.fdt-page` keyframe). Token-driven only, so the
 * global `prefers-reduced-motion` rule reaches them with no per-surface code
 * (`tokens.css` drops them outright, on every surface). Everything else (hover/press colors, data swaps,
 * counts, height changes) is instant by design.
 */

/**
 * Fade-in for content that appears after the view is up: a disclosure body,
 * an async result's first paint. Plays once on insertion via
 * `@starting-style`, so it needs no mount-time JS or state.
 *
 * Apply to the revealed **container**, never per row: virtual rows remount on
 * scroll and would replay it on every scroll.
 */
export const MOTION_REVEAL =
  'transition-opacity duration-[var(--motion-base)] ease-[var(--ease-entrance)] starting:opacity-0';

/**
 * The disclosure chevron's turn. Pair with `rotate-90`/`rotate-180` while
 * open; the open state itself lives in `aria-expanded`, never in the
 * transition. Not for whole rows or bodies (heights change instantly).
 */
export const MOTION_TURN =
  'transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)]';

/**
 * A key chip (`<kbd>`): a quiet hairline box in the sans stack at meta size.
 * One look for every place the panel names a key — the top bar's palette
 * hint, the palette's key footer, the shortcuts overlay — so keys read the
 * same wherever they are taught. Callers add tone or font overrides through
 * `cn` (the overlay's keys column reads `fg-primary`).
 */
export const KEY_CHIP =
  'inline-flex items-center gap-0.5 rounded-sm border border-line-2 bg-surface-1 px-1 font-sans text-2xs text-fg-muted';
