/**
 * The Detections page's layout classes, kept pure (one function per decision,
 * unit-tested without rendering): the body of each layout, the group
 * surface, and one detection entry's grid — a calm row (Grouped / List,
 * and Cards at compact) or a card (Cards from the regular tier up).
 *
 * Entry anatomy, one grid for every layout: `icon` (status icon) · `main`
 * (name, note lines) · `state` (pill or the quiet "Off") · `link` (the
 * owning page, when the row has one). Rows put the link beside the state
 * from the regular tier up and under the name below it; cards always under
 * the name.
 */
import { cn } from '../../../../utils/cn';
import type { DetectionLayout } from '../../state/detections-layout';

/** The control row: the status filter at the start, the layout choice at the end. */
export const DETECTIONS_CONTROLS = 'flex flex-wrap items-center justify-between gap-2';

/**
 * The List layout's column: the shared reading width, centered, so a wide
 * panel shows one bounded list instead of rows stretched edge to edge.
 */
export const DETECTIONS_LIST_COLUMN = 'mx-auto w-full max-w-4xl';

/**
 * One grouped surface holding calm rows (T-3: 4 px between rows, no
 * hairlines) — a group's body, the List body, the Cards body at compact.
 */
export const ROWS_SURFACE = 'flex flex-col gap-1 rounded-md border border-line-1 bg-surface-1 p-1';

/**
 * The Grouped body: one column of groups, two balanced columns from the wide
 * tier (multi-column flow keeps reading order down each column, and a group
 * never splits across them).
 */
export const GROUPED_BODY = '-mb-3 @wide:columns-2 @wide:gap-3';

/** A group's surface: the rows surface plus its header, never split by the column flow. */
export const GROUP_SURFACE = cn(ROWS_SURFACE, 'mb-3 break-inside-avoid');

/**
 * A group's header: heading, the norm source chip, the count at the end;
 * the rows' 14 px inline padding, so the heading lines up with their icons.
 */
export const GROUP_HEADER = 'flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pt-2 pb-1';

/**
 * The Cards body: the compact tier's grouped surface of calm rows (L-3: a
 * stack of bordered cards in a floor-width column is chrome), from the
 * regular tier an auto-fill grid of 15 rem tracks (1 → 2 → 3 → 4+ columns
 * as width allows; feature names stay on ≤ 2 lines beside the state pill).
 */
export const CARDS_BODY = cn(
  ROWS_SURFACE,
  '@regular:grid @regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] @regular:gap-2 @regular:rounded-none @regular:border-0 @regular:bg-transparent @regular:p-0'
);

/**
 * The flat body (List / Cards) for a layout.
 *
 * @param layout A flat layout.
 * @returns The bounded rows surface (list) or {@link CARDS_BODY} (cards).
 */
export function flatBodyClass(layout: Exclude<DetectionLayout, 'grouped'>): string {
  return layout === 'list' ? cn(ROWS_SURFACE, DETECTIONS_LIST_COLUMN) : CARDS_BODY;
}

/**
 * Bound a block above the rows (the control row, the filtered-empty line) to
 * the List column; the other layouts leave it untouched.
 *
 * @param base The block's own classes (`undefined`: none).
 * @param layout The page's layout.
 * @returns `base`, or `base` plus {@link DETECTIONS_LIST_COLUMN} in List.
 */
export function blockClass(base: string | undefined, layout: DetectionLayout): string | undefined {
  if (layout !== 'list') return base;
  return base === undefined ? DETECTIONS_LIST_COLUMN : `${base} ${DETECTIONS_LIST_COLUMN}`;
}

/** Every entry: the grid, its gaps and type. */
const ENTRY_BASE = 'grid w-full min-w-0 items-start gap-x-2.5 gap-y-1 text-xs text-fg-primary';

/** A calm row (T-3): 14 px inline padding, a 36 px one-line floor, no border. */
const ROW_SURFACE = 'rounded-lg px-3.5 py-2.5 min-h-9';

/** A row with a note line: T-3's two-line floor (58 px). */
const TWO_LINE = 'min-h-14.5';

/** The link stacked under the name: an own line below the regular tier, a two-line row there. */
const STACKED_LINK_FLOOR = '@max-regular:min-h-14.5';

/**
 * A Cards entry from the regular tier: the `Card` primitive's level-1
 * surface/line pair (literal classes so the stylesheet scanner sees them),
 * its `p-2.5`, full track height, the link row pinned to the bottom.
 */
const CARD_SURFACE =
  '@regular:h-full @regular:grid-rows-[auto_1fr] @regular:rounded-md @regular:border @regular:border-line-1 @regular:bg-surface-1 @regular:p-2.5';

/** Three columns, one line: no link. */
const AREAS_PLAIN = 'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"icon_main_state"]';

/** Three columns, the link on its own line under the name. */
const AREAS_STACKED =
  'grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:"icon_main_state"_"._link_."]';

/** A row's link beside the state from the regular tier (stacked below it). */
const AREAS_INLINE_FROM_REGULAR = cn(
  AREAS_STACKED,
  '@regular:grid-cols-[auto_minmax(0,1fr)_auto_auto] @regular:[grid-template-areas:"icon_main_link_state"]'
);

/** What an entry's classes depend on. */
export interface EntryShape {
  /** The page's layout. */
  readonly layout: DetectionLayout;
  /** The entry links to its owning page. */
  readonly hasLink: boolean;
  /** The entry shows a note line under the name (subtitle or evidence). */
  readonly twoLine: boolean;
}

/**
 * One entry's classes.
 *
 * @param shape See {@link EntryShape}.
 * @returns The grid, its areas and the row or card surface.
 */
export function entryClass(shape: EntryShape): string {
  const cards = shape.layout === 'cards';
  const areas = !shape.hasLink ? AREAS_PLAIN : cards ? AREAS_STACKED : AREAS_INLINE_FROM_REGULAR;
  // A stacked link is a second line: always on a card, only below regular on a row.
  const floor =
    shape.twoLine || (cards && shape.hasLink)
      ? TWO_LINE
      : shape.hasLink
        ? STACKED_LINK_FLOOR
        : undefined;
  return cn(ENTRY_BASE, areas, ROW_SURFACE, floor, cards && CARD_SURFACE);
}
