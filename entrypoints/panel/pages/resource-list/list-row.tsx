/**
 * The calm list row: text only (P-2 — no code blocks, no tooltips per
 * virtual row), no borders, a tinted surface on hover and selection.
 *
 * - **Two-line** (resource lists): an optional 32 px icon tile, the name
 *   (`text-xs font-semibold`), one muted mono preview line, an optional size
 *   column (`tabular-nums`, filled only on rows that have a size), the state
 *   chips (≤ 2 + "+N", split by the page with `CALM_VISIBLE_STATE_CHIPS`) and
 *   a chevron while the detail drills in.
 * - **One-line** (key-value lists): name, value, size and chips on one line.
 *
 * Compact containers stack either form: name + size / preview / chips. One
 * DOM, two arrangements — grid areas switch on the list root's `@regular`
 * tier, so the script never re-renders a row on resize.
 *
 * A row in a list with a detail view renders its main block as the row's
 * one **open button** (Enter/Space open natively; the list's key handler
 * moves between these buttons); its trailing actions (a copy button) stay
 * separate controls beside it, never nested inside.
 */
import type { Accessor, JSX } from 'solid-js';
import { createContext, onCleanup, onMount, Show, useContext } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { LucideIcon } from 'lucide-solid';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { Badge } from '../../../../components/ui/badge';
import type { RowKey } from '../../../../lib/panel/list-selection';
import { capTitle } from '../../../../utils/cap-text';
import { cn } from '../../../../utils/cn';
import { CURRENT_MATCH_ROW } from '../current-match';
import { StateChips } from './state-chip-list';
import type { StateChipSplit } from './state-chips';

/** How many lines a row's main block takes (before compact stacking). */
export type ListRowLines = 'two' | 'one';

/** Which columns a list's rows (and its head) lay out — a list-level constant. */
export interface ListRowColumns {
  /** A size column (rows without a size leave it empty). */
  readonly size: boolean;
  /** A state-chips column. */
  readonly states: boolean;
}

/** What a calm list tells all of its rows and its head. */
export interface CalmListControl {
  /** Rows open a detail view: each renders an open button. */
  readonly interactive: boolean;
  /** The detail drills in (rows show a chevron). */
  readonly drill: Accessor<boolean>;
}

/** What a calm list tells one row. */
export interface ListRowControl {
  /** The row's key. */
  readonly key: RowKey;
  /** Whether the row is the selection. */
  readonly selected: Accessor<boolean>;
  /**
   * Register the row's open button for keyboard focus while it is mounted.
   *
   * @param target The open button (connected).
   * @returns Unregister.
   */
  readonly registerFocus: (target: HTMLElement) => () => void;
}

/** The list-level context (provided by the calm list; absent → a plain, static row). */
export const CalmListContext = createContext<CalmListControl>();

/** The per-row context (provided around each rendered row by the calm list). */
export const ListRowContext = createContext<ListRowControl>();

/** Which optional columns a grid template covers. */
type ColumnSet = 'size-states' | 'size' | 'states' | 'none';

/**
 * The grid templates by line count and column set — literal class strings
 * (the stylesheet is generated from the source text). Compact: name (+ size)
 * on the first line, the preview under it, chips last; `@regular`: columns.
 * Tracks: size `4rem` (the mockup's 60 px on the 4 px grid), states
 * `14rem` (224 px: the widest two chips with their source icons plus a WP
 * Rocket "+N" — "Excluded" + "Combined" + rocket "+4" — measure 210 px in
 * Chromium's 11 px system-ui; the rest is room for wider system fonts).
 */
const ROW_GRIDS: Readonly<Record<ListRowLines, Readonly<Record<ColumnSet, string>>>> = {
  two: {
    'size-states':
      'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_size"_"preview_preview"_"states_states"] @regular:grid-cols-[minmax(0,1fr)_4rem_14rem] @regular:[grid-template-areas:"name_size_states"_"preview_size_states"]',
    size: 'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_size"_"preview_preview"] @regular:grid-cols-[minmax(0,1fr)_4rem] @regular:[grid-template-areas:"name_size"_"preview_size"]',
    states:
      'grid-cols-[minmax(0,1fr)] [grid-template-areas:"name"_"preview"_"states"] @regular:grid-cols-[minmax(0,1fr)_14rem] @regular:[grid-template-areas:"name_states"_"preview_states"]',
    none: 'grid-cols-[minmax(0,1fr)] [grid-template-areas:"name"_"preview"]'
  },
  one: {
    'size-states':
      'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_size"_"preview_preview"_"states_states"] @regular:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4rem_14rem] @regular:[grid-template-areas:"name_preview_size_states"]',
    size: 'grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:"name_size"_"preview_preview"] @regular:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4rem] @regular:[grid-template-areas:"name_preview_size"]',
    states:
      'grid-cols-[minmax(0,1fr)] [grid-template-areas:"name"_"preview"_"states"] @regular:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_14rem] @regular:[grid-template-areas:"name_preview_states"]',
    none: 'grid-cols-[minmax(0,1fr)] [grid-template-areas:"name"_"preview"] @regular:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @regular:[grid-template-areas:"name_preview"]'
  }
};

/**
 * The grid template for a list's lines and columns.
 *
 * @param lines The row form.
 * @param columns The list's optional columns.
 * @returns The template classes.
 */
export function rowGrid(lines: ListRowLines, columns: ListRowColumns): string {
  const set: ColumnSet =
    columns.size && columns.states
      ? 'size-states'
      : columns.size
        ? 'size'
        : columns.states
          ? 'states'
          : 'none';
  return ROW_GRIDS[lines][set];
}

/** Seed heights (px) of calm rows for the virtualizer (measurement refines them; T-3 minimums). */
export const CALM_ROW_ESTIMATES = {
  /** A two-line row (58 px floor) or a compact one-line row (stacked to two lines). */
  twoLine: 58,
  /** A one-line row at `@regular` (36 px floor). */
  oneLine: 36,
  /** A compact row whose chips stack onto a third line (measured in Chromium: 78 px). */
  stacked: 78
} as const;

/** The gap between calm rows (px; T-3), passed to the virtual list's `gap`. */
export const CALM_ROW_GAP = 4;

/**
 * A calm row's seed height.
 *
 * @param lines The row form.
 * @param compact Whether the list is compact (rows stack).
 * @param hasChips Whether this row shows state chips (a compact third line).
 * @returns The estimate in px.
 */
export function calmRowEstimate(lines: ListRowLines, compact: boolean, hasChips: boolean): number {
  if (compact) return hasChips ? CALM_ROW_ESTIMATES.stacked : CALM_ROW_ESTIMATES.twoLine;
  return lines === 'two' ? CALM_ROW_ESTIMATES.twoLine : CALM_ROW_ESTIMATES.oneLine;
}

/**
 * The keyboard ring on the row surface: focus sits on the row's open button,
 * the ring draws around the whole row (same values as `FOCUS_RING`).
 */
const ROW_FOCUS_RING =
  'has-[[data-fdt-row-open]:focus-visible]:outline-2 has-[[data-fdt-row-open]:focus-visible]:outline-offset-1 has-[[data-fdt-row-open]:focus-visible]:outline-accent';

/** What a row surface's look depends on. */
export interface CalmRowState {
  readonly lines: ListRowLines;
  readonly interactive: boolean;
  readonly selected: boolean;
  /** The find's current match. */
  readonly current: boolean;
}

/**
 * The row surface's classes (the list item the calm list renders around a
 * row): T-3 geometry (58/36 px floors, 14 px inline padding, no borders),
 * hover `surface-3` on interactive rows, the find's marker, selection
 * `accent-soft` last so it wins the background over the marker's wash.
 *
 * @param state The row's state.
 * @returns The classes.
 */
export function calmRowClass(state: CalmRowState): string {
  return cn(
    'group flex items-center rounded-lg px-3.5',
    state.lines === 'two' ? 'min-h-14.5 py-2' : 'min-h-9 py-1.5',
    state.interactive && [
      'cursor-pointer',
      ROW_FOCUS_RING,
      !state.selected && 'hover:bg-surface-3'
    ],
    state.current && CURRENT_MATCH_ROW,
    state.selected && 'bg-accent-soft'
  );
}

/** The states cell: chips (or the row's own state content) on one wrapping line. */
const STATES_CELL = 'flex min-w-0 flex-wrap items-center gap-1 [grid-area:states]';

/** Props of {@link ListRow}. */
export interface ListRowProps {
  /** The row form (default `two`). */
  lines?: ListRowLines;
  /** The list's columns (the same constant its head gets). */
  columns: ListRowColumns;
  /** The icon tile's icon (two-line rows; a lucide component, rendered at 16 px). */
  icon?: LucideIcon;
  /** The row's name (truncates; its capped text rides `title`). */
  name: string;
  /** Mono name (URLs, identifiers — T-2). */
  mono?: boolean;
  /** The muted preview (two-line) or value (one-line) line; plain text, truncating. */
  preview?: string;
  /** The capture cut the previewed value at its cap: a "Clipped" badge leads the line. */
  clipped?: boolean;
  /** The size cell's text (already formatted); omitted → the cell stays empty. */
  size?: string;
  /**
   * A relative size bar under the size text (0–1 of the bar's width, past 1
   * full; none at 0 or below; the page picks the scale). Decorative: the text
   * carries the value.
   */
  sizeShare?: number;
  /** The row's split state chips (the states column / compact third line). */
  chips?: StateChipSplit;
  /**
   * The states cell's own content in place of chips — a label that is no
   * state with a source (e.g. who wrote a resource hint). Wins over `chips`.
   */
  stateContent?: JSX.Element;
  /** Trailing controls outside the open button (e.g. the row copy button). */
  actions?: JSX.Element;
}

/**
 * Render one calm row's content inside the calm list's row surface.
 *
 * @param props See {@link ListRowProps}.
 */
export function ListRow(props: ListRowProps): JSX.Element {
  const list = useContext(CalmListContext);
  const row = useContext(ListRowContext);
  const interactive = (): boolean => list?.interactive === true && row !== undefined;
  const lines = (): ListRowLines => props.lines ?? 'two';
  const hasChips = (): boolean =>
    props.chips !== undefined && (props.chips.visible.length > 0 || props.chips.overflow !== null);

  const content = (): JSX.Element => (
    <>
      <Show when={lines() === 'two' && props.icon}>
        {(icon) => (
          <span
            data-fdt="list-row-icon"
            class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-secondary group-data-selected:bg-surface-2 group-data-selected:text-accent"
          >
            <Dynamic component={icon()} size={16} aria-hidden="true" />
          </span>
        )}
      </Show>
      <span
        class={cn(
          'grid min-w-0 flex-1 items-center gap-x-3.5 gap-y-1.25',
          rowGrid(lines(), props.columns)
        )}
      >
        <span
          data-fdt="list-row-name"
          class={cn(
            'truncate text-xs font-semibold text-fg-primary [grid-area:name]',
            props.mono === true && 'font-mono'
          )}
          title={capTitle(props.name)}
        >
          {props.name}
        </span>
        <Show when={props.preview !== undefined || props.clipped === true}>
          <span class="flex min-w-0 items-center gap-1 [grid-area:preview]">
            <Show when={props.clipped === true}>
              <Badge kind="warn" class="shrink-0">
                Clipped
              </Badge>
            </Show>
            <span data-fdt="list-row-preview" class="truncate font-mono text-2xs text-fg-muted">
              {props.preview}
            </span>
          </span>
        </Show>
        <Show when={props.columns.size && props.size !== undefined}>
          <span class="flex flex-col items-end gap-1 justify-self-end [grid-area:size]">
            <span data-fdt="list-row-size" class="text-2xs text-fg-secondary tabular-nums">
              {props.size}
            </span>
            <Show when={(props.sizeShare ?? 0) > 0 ? props.sizeShare : undefined}>
              {(share) => (
                <span
                  data-fdt="list-row-size-bar"
                  aria-hidden="true"
                  class="h-1 w-14 overflow-hidden rounded-full bg-surface-4"
                >
                  <span
                    class="block h-full rounded-full bg-accent/50"
                    style={{
                      width: `${String(Math.round(Math.min(1, share()) * 100))}%`
                    }}
                  />
                </span>
              )}
            </Show>
          </span>
        </Show>
        <Show when={props.columns.states}>
          <Show
            when={props.stateContent}
            fallback={
              <Show
                when={hasChips() ? props.chips : undefined}
                fallback={
                  // A quiet dash in the states column (regular only — a compact
                  // row with no chips takes no third line).
                  <span
                    aria-hidden="true"
                    class="hidden text-2xs text-fg-muted [grid-area:states] @regular:inline"
                  >
                    —
                  </span>
                }
              >
                {(chips) => (
                  <span class={STATES_CELL}>
                    <StateChips chips={chips()} />
                  </span>
                )}
              </Show>
            }
          >
            {(content) => <span class={STATES_CELL}>{content()}</span>}
          </Show>
        </Show>
      </span>
    </>
  );

  return (
    <div data-fdt="list-row" class="flex min-w-0 flex-1 items-center gap-3.5">
      <Show
        when={interactive() ? row : undefined}
        fallback={<div class="flex min-w-0 flex-1 items-center gap-3.5">{content()}</div>}
      >
        {(control) => <OpenButton control={control()}>{content()}</OpenButton>}
      </Show>
      <Show when={props.actions}>
        {(actions) => <div class="flex shrink-0 items-center gap-1">{actions()}</div>}
      </Show>
      <Show when={interactive() && list?.drill() === true}>
        <ChevronRight size={14} aria-hidden="true" class="shrink-0 text-fg-muted" />
      </Show>
    </div>
  );
}

/**
 * The row's open button: registers itself for keyboard focus while mounted.
 * Its press bubbles to the row surface, which opens the row (one handler for
 * pointer and keyboard).
 *
 * @param props.control The row's control.
 * @param props.children The row's main block.
 */
function OpenButton(props: { control: ListRowControl; children: JSX.Element }): JSX.Element {
  let button: HTMLButtonElement | undefined;
  onMount(() => {
    if (button === undefined) return;
    const release = props.control.registerFocus(button);
    onCleanup(release);
  });
  return (
    <button
      ref={button}
      type="button"
      data-fdt="list-row-open"
      data-fdt-row-open
      aria-current={props.control.selected() ? 'true' : undefined}
      // The ring draws on the row surface (`has-[…:focus-visible]`).
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-3.5 text-start outline-none"
    >
      {props.children}
    </button>
  );
}

/** Props of {@link ListRowHead}. */
export interface ListRowHeadProps {
  /** The row form (default `two`). */
  lines?: ListRowLines;
  /** The list's columns (the same constant its rows get). */
  columns: ListRowColumns;
  /** Reserve the icon tile's width (the rows carry icons). */
  icon?: boolean;
  /** Reserve the trailing actions' width (rows carry one 24 px control). */
  actions?: boolean;
  /** The name column's caption ("Script"). */
  name: string;
  /** The preview column's caption (one-line rows only, `@regular`). */
  preview?: string;
  /** The size column's caption. */
  size?: string;
  /** The states column's caption ("WP Rocket"; `@regular` only — compact chips stack). */
  states?: string;
}

/**
 * The calm list's column header (the list's `head` slot): caps labels
 * (`text-2xs uppercase tracking-wide`) on the rows' own grid, so the columns
 * line up; it sits above the scroller, so it stays in view while rows scroll.
 *
 * @param props See {@link ListRowHeadProps}.
 */
export function ListRowHead(props: ListRowHeadProps): JSX.Element {
  const list = useContext(CalmListContext);
  const lines = (): ListRowLines => props.lines ?? 'two';
  return (
    <div
      data-fdt="list-head"
      class="flex items-center gap-3.5 px-3.5 pb-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase"
    >
      <Show when={lines() === 'two' && props.icon === true}>
        <span aria-hidden="true" class="w-8 shrink-0" />
      </Show>
      <div
        class={cn('grid min-w-0 flex-1 items-center gap-x-3.5', rowGrid(lines(), props.columns))}
      >
        <span class="truncate [grid-area:name]">{props.name}</span>
        <Show when={lines() === 'one' && props.preview}>
          <span class="hidden truncate [grid-area:preview] @regular:block">{props.preview}</span>
        </Show>
        <Show when={props.columns.size && props.size}>
          <span class="justify-self-end [grid-area:size]">{props.size}</span>
        </Show>
        <Show when={props.columns.states && props.states}>
          <span class="hidden truncate [grid-area:states] @regular:block">{props.states}</span>
        </Show>
      </div>
      <Show when={props.actions === true}>
        <span aria-hidden="true" class="w-6 shrink-0" />
      </Show>
      <Show when={list?.interactive === true && list.drill()}>
        <span aria-hidden="true" class="w-3.5 shrink-0" />
      </Show>
    </div>
  );
}
