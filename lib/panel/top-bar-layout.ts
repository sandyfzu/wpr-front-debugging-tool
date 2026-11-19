/**
 * The panel top bar's width rule: its full or compact form, decided from
 * the panel (shell) width. One rule, one threshold; the sidebar's pin rule
 * reads the same constant, so the two shell decisions can never disagree
 * about what "a full-width panel" is. Which secondary parts fit inline is
 * the measured fold's (`top-bar-fold.ts`); the compact form folds them all.
 *
 * The rule is pure and JS-only (the shell measures its own width): the bar
 * carries no container or viewport variant for it, so no CSS twin exists to
 * drift.
 */

/**
 * The panel width (px) from which the top bar takes its full form (name,
 * labeled controls, long answer forms). Below it the name and the labeled
 * Exclusions entry fold into the "⋯" menu with every secondary part; the
 * WP Rocket and cache answers stay in the bar at every width.
 */
export const TOP_BAR_FULL_MIN_WIDTH = 760;

/** What the top bar shows inline at one panel width. */
export interface TopBarLayout {
  /** The visible "WPR FDT" name beside the brand mark (sr-only otherwise). */
  readonly showName: boolean;
  /**
   * The labeled Exclusions entry. Folded, the entry lives in the "⋯" menu
   * and returns to the bar as an icon only while its session state is news.
   */
  readonly showExclusionsLabel: boolean;
  /**
   * The compact form: "⋯" always shows and holds every secondary part, and
   * the palette trigger and answer pills take their short forms.
   */
  readonly overflow: boolean;
}

/** The full form (from {@link TOP_BAR_FULL_MIN_WIDTH} on). */
const FULL: TopBarLayout = Object.freeze({
  showName: true,
  showExclusionsLabel: true,
  overflow: false
});

/** The folded form (below {@link TOP_BAR_FULL_MIN_WIDTH}). */
const COMPACT: TopBarLayout = Object.freeze({
  showName: false,
  showExclusionsLabel: false,
  overflow: true
});

/**
 * Pick the top bar's layout for a measured panel width.
 *
 * @param panelWidth The shell's inline size in px (fractional allowed; `0` while hidden).
 * @returns The full form from {@link TOP_BAR_FULL_MIN_WIDTH} on, else the compact one.
 * @throws {@link RangeError} When the width is negative or not finite — a
 *   measuring bug, never a real layout.
 */
export function topBarLayout(panelWidth: number): TopBarLayout {
  if (!Number.isFinite(panelWidth) || panelWidth < 0) {
    throw new RangeError(
      `topBarLayout: panel width must be a finite number ≥ 0, got ${String(panelWidth)}.`
    );
  }
  return panelWidth >= TOP_BAR_FULL_MIN_WIDTH ? FULL : COMPACT;
}
