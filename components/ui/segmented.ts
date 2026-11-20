/**
 * The segmented look — one tray holding flat segments, the selected one
 * raised — shared by `ChoiceGroup`'s `segmented` variant and the panel's
 * boolean toggle chips, so a facet bar's single-choice groups and its
 * toggles read as one control family. Declared once here; consumers import
 * the fragments, never re-type them.
 *
 * Tokens only (C-1): text never dims through opacity — an unavailable
 * segment takes `fg-muted`, which the contrast gate pins at AA on every
 * surface, so a disabled count stays readable. No transition: selection and
 * hover are state, painted instantly (M-3).
 */
import { formatCount } from '../../utils/format-count';

/**
 * The tray: `surface-3` fill inside a `line-1` hairline, 2 px inset. It
 * hugs its segments (`w-fit`: a stretching flex/grid parent never widens the
 * fill) and wraps them onto a second line inside itself when the container
 * is narrower than one line (never a horizontal scroller, never wider than
 * its container — `max-w-full`).
 */
export const SEGMENTED_TRAY =
  'inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-line-1 bg-surface-3 p-0.5';

/**
 * The stretched tray (a bottom sheet's full-width rows): the same fill, as
 * wide as its container, segments sharing the width ({@link SEGMENT_STRETCH}).
 * A separate string, not `w-full` appended to {@link SEGMENTED_TRAY}: the
 * class joiner resolves no conflict, so `w-fit` would keep winning.
 */
export const SEGMENTED_TRAY_STRETCH =
  'flex w-full max-w-full flex-wrap items-center gap-0.5 rounded-lg border border-line-1 bg-surface-3 p-0.5';

/** A stretched segment's share of its tray: grows, and fills its own wrapper. */
export const SEGMENT_STRETCH = 'flex-1';

/**
 * The tray's leading caption ("Delay"): muted meta text, sentence case, one
 * line, set 8 px in from the tray's edge and 6 px off its first segment.
 */
export const SEGMENTED_CAPTION = 'whitespace-nowrap ps-2 pe-1.5 text-2xs font-medium text-fg-muted';

/**
 * Every segment's geometry: 24 px tall (the T-3 hit-area floor), one line,
 * the count after the label.
 */
export const SEGMENT_BASE =
  'flex h-6 select-none items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-medium';

/** The selected segment's raise: the card surface above the tray, first elevation. */
export const SEGMENT_RAISED = 'bg-surface-2 shadow-elev-1';

/**
 * A count's type, tone excluded: meta size, aligned digits, set off from the
 * label. Exported for a look that pairs it with its own tone (a count on an
 * accent fill).
 */
export const SEGMENT_COUNT_TYPE = 'ms-1.5 text-2xs tabular-nums';

/** A segment's count: {@link SEGMENT_COUNT_TYPE} in the muted tone. */
export const SEGMENT_COUNT = `${SEGMENT_COUNT_TYPE} text-fg-muted`;

/** What a segment's state classes depend on. */
export interface SegmentState {
  /** Whether the segment is the selected (or pressed) one. */
  readonly selected: boolean;
  /** Whether it cannot change now (its own or its group's disabled/held state). */
  readonly unavailable: boolean;
}

/**
 * A segment's state classes: raise, text tone, cursor and hover feedback.
 *
 * The text tone is chosen exactly once (never two `text-*` classes left for
 * the stylesheet order to decide): muted while unavailable, primary when
 * selected, secondary otherwise. Hover feedback only on an idle, available
 * segment — the selected one is already primary, an unavailable one keeps
 * its resting look.
 *
 * @param state The segment's selection and availability.
 * @returns The state classes to join after {@link SEGMENT_BASE}.
 */
export function segmentStateClass(state: SegmentState): string {
  const raise = state.selected ? `${SEGMENT_RAISED} ` : '';
  if (state.unavailable) return `${raise}text-fg-muted cursor-not-allowed`;
  if (state.selected) return `${raise}text-fg-primary cursor-pointer`;
  return 'text-fg-secondary cursor-pointer hover:text-fg-primary';
}

/**
 * Format a segment's count for display.
 *
 * @param count The count the segment selects over (a non-negative integer).
 * @param owner The segment's identity, named in the error.
 * @returns The grouped digits (`1,204`).
 * @throws {@link Error} when `count` is negative, fractional or not finite —
 *   a wiring bug that would otherwise paint `NaN` or `-1` as a count.
 */
export function segmentCountText(count: number, owner: string): string {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `Segment "${owner}": count must be a non-negative integer, got ${String(count)}.`
    );
  }
  return formatCount(count);
}
