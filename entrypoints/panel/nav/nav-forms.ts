/**
 * The nav's two forms as data: one class table per form, so the rows, the
 * group blocks, the geometry stub and the column all read the same values
 * (the overflow slice measures the stub, so a stub that drifted from the
 * real rows would slice wrongly).
 *
 * - **Rail** (52 px column): 32 px icon squares, groups split by a hairline
 *   with 6 px air on both sides (13 px boundary), 4 px in-group gap.
 * - **Labeled** (208 px column): 32 px rows (icon, label, note), each group
 *   under its caps caption with a 14 px lead, 2 px in-group gap.
 *
 * Both: active row = accent-soft tint with an accent icon; idle rows take
 * the hover surface.
 */
import { STATUS_TEXT_CLASSES, type StatusKind } from '../../../components/ui/status-badge';
import type { NavForm } from '../../../lib/panel/nav-mode';

/** Every class a form needs. */
export interface NavFormClasses {
  /** The nav column (width + padding; the shell adds the surface and edge). */
  readonly column: string;
  /** One group block. */
  readonly group: string;
  /** The group's visible caption, or null when the form shows none. */
  readonly caption: string | null;
  /** The group's row list. */
  readonly list: string;
  /** One row (anchor, overflow trigger, toggle, stub row). */
  readonly row: string;
  /** The active row's treatment. */
  readonly rowActive: string;
  /** The rest rows' treatment. */
  readonly rowIdle: string;
  /** The overflow trigger's block (hairline-topped, like a group). */
  readonly triggerBlock: string;
}

/** Shared by both forms' row treatments. */
const ROW_ACTIVE = 'bg-accent-soft text-fg-primary';
const ROW_IDLE = 'text-fg-secondary hover:bg-surface-3 hover:text-fg-primary';

/** The class table per form. */
export const NAV_FORM_CLASSES: Readonly<Record<NavForm, NavFormClasses>> = {
  rail: {
    column: 'w-13 p-2',
    // The hairline keeps 6 px air above (margin) and below (padding), so a
    // row's hover rectangle never touches it; the first group has none (the
    // column's top edge bounds it).
    group:
      'mt-1.5 flex flex-col border-t border-line-2 pt-1.5 first:mt-0 first:border-t-0 first:pt-0',
    caption: null,
    list: 'flex flex-col items-center gap-1',
    row: 'flex size-8 shrink-0 items-center justify-center rounded-control whitespace-nowrap text-2xs font-medium no-underline',
    rowActive: ROW_ACTIVE,
    rowIdle: ROW_IDLE,
    triggerBlock: 'flex shrink-0 flex-col items-center border-t border-line-2 pt-1.5'
  },
  labeled: {
    column: 'w-52 px-1.5 pt-1 pb-2',
    group: 'flex flex-col',
    caption:
      'truncate px-2.5 pt-3.5 pb-1.5 text-2xs leading-4 font-semibold tracking-wide text-fg-muted uppercase',
    list: 'flex flex-col gap-0.5',
    row: 'flex h-8 w-full shrink-0 items-center gap-2.5 rounded-control px-2.5 text-left text-xs font-medium whitespace-nowrap no-underline',
    rowActive: ROW_ACTIVE,
    rowIdle: ROW_IDLE,
    triggerBlock: 'flex shrink-0 flex-col border-t border-line-2 pt-1.5'
  }
};

/** The active row's icon color (both forms). */
export const NAV_ICON_ACTIVE = 'text-accent';

/** The labeled row's label: takes the room, elides last. */
export const NAV_ROW_LABEL = 'min-w-0 flex-1 truncate';

/**
 * The labeled row's note color: counts and info/neutral states stay quiet
 * (the calm sidebar), states that ask for attention keep their status color.
 *
 * @param tone The note's status tone.
 * @returns The text color class.
 */
export function navNoteToneClass(tone: StatusKind): string {
  return tone === 'neutral' || tone === 'info' ? 'text-fg-muted' : STATUS_TEXT_CLASSES[tone];
}

/** The labeled row's note: right-aligned, tabular figures, never elided. */
export const NAV_ROW_NOTE = 'ml-auto shrink-0 text-2xs tabular-nums';
