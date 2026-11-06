/**
 * The panel's one filter/search/list body: a filter bar over a row list and
 * its virtualized rows, inside a `fill` page (it carries the page's one
 * scroller). Every list page renders its rows through it — whole pages
 * (`./resource-list`) and lists inside a page's tab alike — so each declares
 * only its rows, chips, empty view and row renderer.
 *
 * State matrix:
 * - **empty** (no rows): the caller's empty view in the list region, no bar;
 * - **filtered-empty** (chip and/or query hide every row): `NoMatches` with the
 *   one-click ways back, focus handed to the search field / the default chip;
 * - **populated**: the virtualized list (`role="list"`, rows `listitem` with
 *   their set size and position).
 *
 * Search — one query, two inputs, through the shared field binding
 * (`state/search-field`): the in-page field and the DevTools find bar drive
 * the same search store (which owns the debounce); the find's cursor names
 * the current row (highlight + scroll). Selection and query survive a data
 * refresh (the body stays mounted); the selection resets with a remount.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, Show } from 'solid-js';
import { FilterBar } from '../../../../components/ui/filter-bar';
import {
  VirtualList,
  type VirtualItem,
  type VirtualizerFactory
} from '../../../../components/ui/virtual-list';
import {
  filterAndSearch,
  filterCounts,
  type ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import {
  defaultChipId,
  fallbackRowKey,
  normalizeQuery,
  type CountNoun
} from '../../../../lib/panel/list-behavior';
import { cn } from '../../../../utils/cn';
import { useSearch } from '../../state/use-fdt-data';
import { bindSearchField } from '../../state/search-field';
import { createCurrentMatch, CURRENT_MATCH_ROW } from '../current-match';
import { NoMatches, PAGE_FILL_SCROLLER } from '../page-frame';
import { createResultsAnnouncement } from '../results-announcement';
import { buildFilterChips, narrowingChipLabel, reconcileRows } from './resource-list-view';

/** The row contract: a unique, stable id (source position) the list keys on. */
export interface ResourceRow {
  /** Stable row identity (the virtual list's item key). */
  readonly id: number;
}

/** The list region's frame — the same box for rows, empty and filtered-empty views. */
export const LIST_REGION = 'rounded-md border border-line-1 bg-surface-1';

/** Props of {@link FilteredList}. */
export interface FilteredListProps<Row extends ResourceRow, Id extends string> {
  /** The list's chips + searched field. */
  definition: ResourcePageDefinition<Row, Id>;
  /** Every row (reactive: a refresh swaps it). */
  rows: readonly Row[];
  /**
   * Whether two rows with the same id carry the same content: unchanged rows
   * keep their object (and so their rendered row and focus) across a refresh.
   */
  sameRow: (a: Row, b: Row) => boolean;
  /** The view shown in the list region when there are no rows at all. */
  empty: JSX.Element;
  /** The rows' noun, for announcements. */
  noun: CountNoun;
  /** The list's accessible name ("Images"). */
  listLabel: string;
  /** The search field's accessible name. */
  searchLabel: string;
  /** The search field's placeholder. */
  searchPlaceholder: string;
  /** A row's seed height in px (measurement refines it). */
  estimateSize: (row: Row) => number;
  /** Render one row's content (the list wraps it in its `listitem`). */
  renderRow: (row: Row) => JSX.Element;
  /** The rows' `data-fdt` test hook (default `resource-row`). */
  rowHook?: string;
  /** Content above the list rows, inside the scroller's frame (a table's column heads). */
  head?: JSX.Element;
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render the filter bar and the list in their current state.
 *
 * @param props See {@link FilteredListProps}.
 */
export function FilteredList<Row extends ResourceRow, Id extends string>(
  props: FilteredListProps<Row, Id>
): JSX.Element {
  const search = useSearch();
  // The definition is static per list; resolving the default chip once keeps
  // a definition without chips failing at mount, loudly.
  // eslint-disable-next-line solid/reactivity -- read once on purpose: a list's definition is a module constant
  const allChip = defaultChipId(props.definition);
  const [selected, setSelected] = createSignal<Id>(allChip);
  // The shared field binding: raw echo, the one store, the Esc rule.
  const field = bindSearchField(search);
  let controls: HTMLDivElement | undefined;

  // The list filters on the committed query (the store owns the debounce);
  // the field's raw echo only shows what the field displays.
  const query = createMemo(() => normalizeQuery(search.query()));
  // A refresh rebuilds every row object; reconciling by id keeps unchanged
  // rows' objects, so their keyed list rows (and focus inside) survive it.
  const rows = createMemo(
    (previous: readonly Row[]) => reconcileRows(previous, props.rows, props.sameRow),
    []
  );
  const counts = createMemo(() => filterCounts(rows(), props.definition));
  const visible = createMemo(() => filterAndSearch(rows(), props.definition, selected(), query()));
  // The find's page side: the rendered list is the match set — it reports the
  // count and names the row the find's cursor sits on (highlight + scroll).
  const match = createCurrentMatch(search, () => visible().length);
  // Rows are looked up by the list's key, never by window index: an index
  // read during a chip change can name another row for a moment and remount it.
  const rowById = createMemo(
    () => new Map<VirtualItem['key'], Row>(visible().map((row) => [row.id, row]))
  );
  const chips = createMemo(() => buildFilterChips(props.definition, counts(), selected()));

  // The shared count line: truthful text always; a data refresh updates it
  // silently, a committed filter/query change announces again — never per
  // keystroke, never on mount. The noun is a list-level constant.
  // eslint-disable-next-line solid/reactivity -- read once on purpose: a list's noun is a module constant
  const noun = props.noun;
  const { text: announcement, live } = createResultsAnnouncement({
    rows,
    visible,
    noun,
    actions: [() => selected(), query]
  });

  /** Where focus lands once a `NoMatches` way back removes its button. */
  const focusAfter = (action: 'clear-search' | 'show-all'): HTMLElement | null | undefined =>
    action === 'clear-search'
      ? controls?.querySelector<HTMLElement>('input[type="search"]')
      : controls?.querySelector<HTMLElement>(`[data-fdt-filter-chip="${allChip}"]`);

  return (
    <>
      <Show
        when={rows().length > 0}
        fallback={<div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'grid')}>{props.empty}</div>}
      >
        {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
        <div ref={controls} onKeyDown={field.onKeyDown}>
          <FilterBar
            chips={props.definition.filters.length > 1 ? chips() : []}
            selected={selected()}
            onSelect={(value) => {
              // Chip values are the definition's own ids (the bar echoes them back).
              setSelected(() => value as Id);
            }}
            filterLabel={`Filter ${props.listLabel.toLowerCase()}`}
            searchQuery={field.value()}
            onSearchChange={(raw) => {
              field.input(raw);
            }}
            searchLabel={props.searchLabel}
            searchPlaceholder={props.searchPlaceholder}
          />
        </div>
        <Show
          when={visible().length > 0}
          fallback={
            <div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'grid place-items-center')}>
              <NoMatches
                chipLabel={narrowingChipLabel(props.definition, selected())}
                query={query()}
                onClearSearch={() => {
                  field.clear();
                }}
                onShowAll={() => {
                  setSelected(() => allChip);
                }}
                focusAfter={focusAfter}
              />
            </div>
          }
        >
          <ListFrame head={props.head}>
            {(scrollerClass) => (
              <VirtualList
                scrollerRole="list"
                aria-label={props.listLabel}
                count={visible().length}
                estimateSize={(index) => {
                  const row = visible()[index];
                  return row === undefined ? 36 : props.estimateSize(row);
                }}
                // Row ids are source positions — unique even when two rows share a
                // value, stable across chip/search changes.
                getItemKey={(index) => visible()[index]?.id ?? fallbackRowKey(index)}
                createVirtualizer={props.createVirtualizer}
                scrollTo={match.request}
                class={scrollerClass}
              >
                {(item) => (
                  <Show when={rowById().get(item.key)} keyed>
                    {(row) => (
                      <div
                        role="listitem"
                        aria-setsize={visible().length}
                        aria-posinset={item.index + 1}
                        data-fdt={props.rowHook ?? 'resource-row'}
                        aria-current={match.current() === item.index ? 'true' : undefined}
                        class={cn(
                          'min-h-8 px-2 py-1.5',
                          item.index > 0 && 'border-t border-line-1',
                          match.current() === item.index && CURRENT_MATCH_ROW
                        )}
                      >
                        {props.renderRow(row)}
                      </div>
                    )}
                  </Show>
                )}
              </VirtualList>
            )}
          </ListFrame>
        </Show>
      </Show>
      <div role="status" aria-live={live()} class="sr-only" data-fdt="resource-results-status">
        {announcement()}
      </div>
    </>
  );
}

/**
 * The list region: without a head the scroller itself is the framed region
 * (one element, as every list page renders it); with one, a framed column
 * holds the head above the scroller.
 *
 * @param props.head Content above the rows (optional).
 * @param props.children Renders the scroller with the classes it takes.
 */
function ListFrame(props: {
  head?: JSX.Element;
  children: (scrollerClass: string) => JSX.Element;
}): JSX.Element {
  return (
    <Show when={props.head} fallback={props.children(cn(PAGE_FILL_SCROLLER, LIST_REGION))}>
      <div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'flex flex-col overflow-hidden')}>
        {props.head}
        {props.children('min-h-0 flex-1')}
      </div>
    </Show>
  );
}
