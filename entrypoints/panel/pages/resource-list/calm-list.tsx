/**
 * The calm variant of the panel's filter/search/list body (`FilteredList`
 * with `variant: 'calm'`): calm rows (no frame, no hairlines, 4 px apart), a
 * column header that stays above the scroller, today's chips **or** the
 * combinable facets, and — when the page declares a detail — the
 * master–detail (`./master-detail`).
 *
 * State matrix:
 * - **empty** (no rows): the caller's empty view, no controls;
 * - **filtered-empty**: `NoMatches` naming the chip or the facet values and
 *   the query, with the one-click ways back (`Clear filters` clears facets
 *   and search);
 * - **populated**: the virtualized list, plus the side pane or the drill
 *   detail for a selection (listed / no longer listed / no longer on the page).
 *
 * Search and find as in the default variant: one store, two inputs; the
 * find's cursor marks and scrolls the current row; a find event in the drill
 * detail returns to the list first. A refresh keeps the query, filters,
 * selection and scroll (the body stays mounted; rows reconcile by key).
 *
 * The root is its own `@container` and the measured box: rows' tier
 * variants, the facet fold and the pane/drill rule all read one width.
 */
import type { Accessor, JSX } from 'solid-js';
import { createMemo, createSignal, Show } from 'solid-js';
import { FilterBar } from '../../../../components/ui/filter-bar';
import {
  VirtualList,
  type VirtualItem,
  type VirtualizerFactory
} from '../../../../components/ui/virtual-list';
import {
  applyFacets,
  facetCounts,
  selectedFacets,
  type FacetCounts,
  type FacetSelection,
  type FacetSet
} from '../../../../lib/panel/resource-facets';
import {
  filterAndSearch,
  filterCounts,
  type ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import {
  countLabel,
  defaultChipId,
  fallbackRowKey,
  normalizeQuery,
  reconcileList,
  type CountNoun
} from '../../../../lib/panel/list-behavior';
import { noFacetSelection } from '../../../../lib/panel/facet-controls';
import { listTier } from '../../../../lib/panel/list-tier';
import type { RowKey, RowKeyOf } from '../../../../lib/panel/list-selection';
import { cn } from '../../../../utils/cn';
import { bindSearchField } from '../../state/search-field';
import { useSearch } from '../../state/use-fdt-data';
import { createCurrentMatch } from '../current-match';
import { NoMatches, PAGE_FILL_SCROLLER, type NoMatchesAction } from '../page-frame';
import { createResultsAnnouncement } from '../results-announcement';
import { createContentWidth } from './content-width';
import { FacetBar } from './facet-bar';
import {
  CALM_ROW_GAP,
  calmRowClass,
  calmRowEstimate,
  CalmListContext,
  ListRowContext,
  type ListRowLines
} from './list-row';
import { pressOpensRow } from './list-keys';
import { createMasterDetail, DetailPane, DrillDetail, type ListDetail } from './master-detail';
import { buildFilterChips, narrowingChipLabel } from './resource-list-view';

/** Today's single-select chips as the calm list's filter input. */
export interface CalmChipInput<Row, Id extends string> {
  /** The list's chips + searched field. */
  readonly definition: ResourcePageDefinition<Row, Id>;
  readonly facets?: never;
  readonly searchField?: never;
}

/** Combinable facets as the calm list's filter input. */
export interface CalmFacetInput<Row, Id extends string> {
  /** The list's facets. */
  readonly facets: FacetSet<Row, Id>;
  /** The searched field (the page's existing `…_RESOURCES.searchField`). */
  readonly searchField: (row: Row) => string;
  readonly definition?: never;
}

/** Everything the calm variant takes beside its filter input. */
export interface CalmListBaseProps<Row> {
  /** Selects this variant. */
  readonly variant: 'calm';
  /** Every row (reactive: a refresh swaps it). */
  readonly rows: readonly Row[];
  /**
   * A row's stable, unique, content-derived key (`RowKeyOf` contract: an
   * occurrence suffix for duplicates). Keys the virtual rows, the reconcile
   * and the selection — a changed key reads as a removed row.
   */
  readonly rowKey: RowKeyOf<Row>;
  /** Whether two same-key rows carry the same content (unchanged rows keep their object). */
  readonly sameRow: (a: Row, b: Row) => boolean;
  /** The view shown when there are no rows at all. */
  readonly empty: JSX.Element;
  /** The rows' noun (announcements, the detail's words). */
  readonly noun: CountNoun;
  /** The list's accessible name ("Scripts"). */
  readonly listLabel: string;
  /** The search field's accessible name. */
  readonly searchLabel: string;
  /** The search field's placeholder. */
  readonly searchPlaceholder: string;
  /** The rows' form, for the default size estimate (default `two`). */
  readonly lines?: ListRowLines;
  /**
   * A row's seed height (measurement refines it); `compact` is the list's
   * tier. Default: the calm floors (`calmRowEstimate`, no chip line).
   */
  readonly estimateSize?: (row: Row, compact: boolean) => number;
  /** Render one row's content (typically a `ListRow`); the list wraps it in its row surface. */
  readonly renderRow: (row: Row) => JSX.Element;
  /** The rows' `data-fdt` hook (default `resource-row`). */
  readonly rowHook?: string;
  /** The column header above the scroller (typically a `ListRowHead`). */
  readonly head?: JSX.Element;
  /** A key to the rows' chips, between the controls and the list. */
  readonly legend?: JSX.Element;
  /** How rows open; omitted = rows are static (no selection, ↑/↓ move focus only). */
  readonly detail?: ListDetail<Row>;
  /** The virtualizer seam (tests inject a layout-free double). */
  readonly createVirtualizer?: VirtualizerFactory;
}

/** The calm variant's props: the base plus exactly one filter input. */
export type CalmFilteredListProps<Row, Id extends string> = CalmListBaseProps<Row> &
  (CalmChipInput<Row, Id> | CalmFacetInput<Row, Id>);

/** What the list's filtered-empty view names and offers. */
interface Narrowing {
  /** The selected chip's label (chip input). */
  readonly chipLabel?: string;
  /** The narrowing facet values' labels (facet input). */
  readonly filterLabels?: readonly string[];
}

/** One filter input's live state, as the list renders it. */
interface CalmFilter<Row> {
  /** The rows the filter + query keep, in list order. */
  readonly visible: Accessor<readonly Row[]>;
  /** The selection (an announcement trigger). */
  readonly selection: Accessor<unknown>;
  /** What narrows besides the query (the filtered-empty sentence). */
  readonly narrowing: Accessor<Narrowing>;
  /** Whether a filter narrows (besides the query). */
  readonly narrowed: Accessor<boolean>;
  /** Back to "all" / no facet. */
  reset(): void;
}

/** The chip input's state. */
interface ChipFilter<Row, Id extends string> extends CalmFilter<Row> {
  readonly kind: 'chips';
  readonly allChip: Id;
  /** Whether the bar shows chips (a list with one chip has nothing to pick). */
  readonly hasChips: boolean;
  readonly chips: Accessor<ReturnType<typeof buildFilterChips>>;
  readonly selected: Accessor<Id>;
  select(id: Id): void;
}

/** The facet input's state. */
interface FacetFilter<Row, Id extends string> extends CalmFilter<Row> {
  readonly kind: 'facets';
  readonly facets: FacetSet<Row, Id>;
  readonly picks: Accessor<FacetSelection<Id>>;
  readonly counts: Accessor<FacetCounts<Id>>;
  pick(next: FacetSelection<Id>): void;
}

/**
 * The chip input: one selected chip (today's model), counts per chip.
 *
 * @param definition The list's chips.
 * @param rows The reconciled rows.
 * @param query The normalized committed query.
 * @returns The filter state.
 */
function createChipFilter<Row, Id extends string>(
  definition: ResourcePageDefinition<Row, Id>,
  rows: Accessor<readonly Row[]>,
  query: Accessor<string>
): ChipFilter<Row, Id> {
  const allChip = defaultChipId(definition);
  const [selected, setSelected] = createSignal<Id>(allChip);
  const counts = createMemo(() => filterCounts(rows(), definition));
  const chips = createMemo(() => buildFilterChips(definition, counts(), selected()));
  const visible = createMemo(() => filterAndSearch(rows(), definition, selected(), query()));
  return {
    kind: 'chips',
    allChip,
    hasChips: definition.filters.length > 1,
    selected,
    select: (id) => setSelected(() => id),
    chips,
    visible,
    selection: selected,
    narrowing: () => ({ chipLabel: narrowingChipLabel(definition, selected()) }),
    narrowed: () => selected() !== allChip,
    reset: () => setSelected(() => allChip)
  };
}

/**
 * The facet input: one value per facet, standard faceted counts, one pass.
 *
 * @param facets The list's facets.
 * @param field The searched field.
 * @param rows The reconciled rows.
 * @param query The normalized committed query.
 * @returns The filter state.
 */
function createFacetFilter<Row, Id extends string>(
  facets: FacetSet<Row, Id>,
  field: (row: Row) => string,
  rows: Accessor<readonly Row[]>,
  query: Accessor<string>
): FacetFilter<Row, Id> {
  const [picks, setPicks] = createSignal<FacetSelection<Id>>(noFacetSelection<Id>());
  const search = (): { field: (row: Row) => string; query: string } => ({ field, query: query() });
  const labels = createMemo(() => selectedFacets(facets, picks()).map(({ value }) => value.label));
  const counts = createMemo(() => facetCounts(rows(), facets, picks(), search()));
  const visible = createMemo(() => applyFacets(rows(), facets, picks(), search()));
  return {
    kind: 'facets',
    facets,
    picks,
    pick: (next) => setPicks(() => next),
    counts,
    visible,
    selection: picks,
    narrowing: () => ({ filterLabels: labels() }),
    narrowed: () => labels().length > 0,
    reset: () => setPicks(() => noFacetSelection<Id>())
  };
}

/**
 * Render the calm list body.
 *
 * @param props See {@link CalmFilteredListProps}.
 */
export function CalmFilteredList<Row, Id extends string>(
  props: CalmFilteredListProps<Row, Id>
): JSX.Element {
  const search = useSearch();
  const field = bindSearchField(search);
  const query = createMemo(() => normalizeQuery(search.query()));
  // Reconcile by key: unchanged rows keep their object (and so their rendered
  // row, focus and detail) across a refresh.
  const rows = createMemo(
    (previous: readonly Row[]) =>
      reconcileList(
        previous,
        props.rows,
        (row) => props.rowKey(row),
        (row) => props.rowKey(row),
        (prior, row) => props.sameRow(prior, row),
        (row) => row
      ),
    []
  );
  // The input is static per list (a page passes a module constant).
  const filter: ChipFilter<Row, Id> | FacetFilter<Row, Id> =
    // eslint-disable-next-line solid/reactivity -- read once on purpose: a list's filter input is a module constant
    props.facets === undefined
      ? // eslint-disable-next-line solid/reactivity -- as above
        createChipFilter(props.definition, rows, query)
      : // eslint-disable-next-line solid/reactivity -- as above
        createFacetFilter(props.facets, props.searchField, rows, query);
  const visible = filter.visible;
  const visibleIds = createMemo(() => visible().map((row) => props.rowKey(row)));
  const allIds = createMemo(() => rows().map((row) => props.rowKey(row)));
  const byKey = createMemo(
    () => new Map<RowKey, Row>(rows().map((row) => [props.rowKey(row), row]))
  );
  const match = createCurrentMatch(search, () => visible().length);

  const measured = createContentWidth();
  const compact = createMemo(() => listTier(measured.width()) === 'compact');
  let controls: HTMLDivElement | undefined;
  const searchInput = (): HTMLElement | null | undefined =>
    controls?.querySelector<HTMLElement>('input[type="search"]');

  // eslint-disable-next-line solid/reactivity -- read once on purpose: whether rows open a detail is static per list
  const detail = props.detail;
  const md = createMasterDetail({
    width: measured.width,
    visibleIds,
    allIds,
    rowsShown: () => visible().length > 0,
    hasRows: () => rows().length > 0,
    findRequest: match.request,
    detailEnabled: detail !== undefined,
    focusFallback: searchInput
  });
  // The selected row, kept once a refresh drops it (its detail says so by name).
  const selectedRow = createMemo((previous: { key: RowKey; row: Row } | undefined) => {
    const key = md.selectedId();
    if (key === null) return undefined;
    const row = byKey().get(key);
    if (row !== undefined) return { key, row };
    return previous?.key === key ? previous : undefined;
  }, undefined);
  const selectedRowValue = (): Row | undefined => selectedRow()?.row;

  /** Filters and search back to everything (one click back, S-1). */
  const clearAll = (): void => {
    filter.reset();
    field.clear();
  };

  // eslint-disable-next-line solid/reactivity -- read once on purpose: a list's noun is a module constant
  const noun = props.noun;
  const { text: announcement, live } = createResultsAnnouncement({
    rows,
    visible,
    noun,
    actions: [filter.selection, query]
  });

  /** Where focus lands once a `NoMatches` way back removes its button. */
  const focusAfter = (action: NoMatchesAction): HTMLElement | null | undefined =>
    action === 'show-all' && filter.kind === 'chips'
      ? controls?.querySelector<HTMLElement>(`[data-fdt-filter-chip="${filter.allChip}"]`)
      : searchInput();

  const estimate = (index: number): number => {
    const row = visible()[index];
    const isCompact = compact();
    if (row !== undefined && props.estimateSize !== undefined)
      return props.estimateSize(row, isCompact);
    return calmRowEstimate(props.lines ?? 'two', isCompact, false);
  };

  const searchField = (): JSX.Element => (
    <FilterBar
      searchQuery={field.value()}
      onSearchChange={(raw) => {
        field.input(raw);
      }}
      searchLabel={props.searchLabel}
      searchPlaceholder={props.searchPlaceholder}
    />
  );

  return (
    <CalmListContext.Provider
      value={{ interactive: detail !== undefined, drill: () => md.layout() === 'drill' }}
    >
      <div
        ref={measured.ref}
        data-fdt="calm-list"
        data-fdt-layout={md.layout()}
        class="@container relative flex min-h-0 flex-1 flex-col"
      >
        <Show
          when={rows().length > 0}
          fallback={<div class={cn(PAGE_FILL_SCROLLER, 'grid')}>{props.empty}</div>}
        >
          <div
            data-fdt="calm-list-view"
            data-fdt-view-enter={md.returned() && !md.drillOpen() ? '' : undefined}
            // The drill detail lays over the list, which stays laid out (its
            // scroll position and virtual window survive) but hidden and inert.
            inert={md.drillOpen()}
            class={cn('flex min-h-0 flex-1 flex-col gap-3', md.drillOpen() && 'invisible')}
          >
            {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
            <div ref={controls} onKeyDown={field.onKeyDown}>
              <Show
                when={filter.kind === 'facets' ? filter : undefined}
                fallback={
                  <Show when={filter.kind === 'chips' ? filter : undefined}>
                    {(chips) => (
                      <FilterBar
                        chips={chips().hasChips ? chips().chips() : []}
                        selected={chips().selected()}
                        onSelect={(value) => {
                          // Chip values are the definition's own ids (the bar echoes them back).
                          chips().select(value as Id);
                        }}
                        filterLabel={`Filter ${props.listLabel.toLowerCase()}`}
                        searchQuery={field.value()}
                        onSearchChange={(raw) => {
                          field.input(raw);
                        }}
                        searchLabel={props.searchLabel}
                        searchPlaceholder={props.searchPlaceholder}
                      />
                    )}
                  </Show>
                }
              >
                {(facets) => (
                  <FacetBar
                    facets={facets().facets}
                    selection={facets().picks()}
                    counts={facets().counts()}
                    onChange={(next) => {
                      facets().pick(next);
                    }}
                    compact={compact()}
                    search={searchField()}
                    filterLabel={`Filter ${props.listLabel.toLowerCase()}`}
                    shownLabel={countLabel(visible().length, noun)}
                  />
                )}
              </Show>
            </div>
            {props.legend}
            <Show
              when={visible().length > 0}
              fallback={
                <div class={cn(PAGE_FILL_SCROLLER, 'grid place-items-center')}>
                  <NoMatches
                    {...filter.narrowing()}
                    query={query()}
                    onClearSearch={() => {
                      field.clear();
                    }}
                    onShowAll={() => {
                      filter.reset();
                    }}
                    onClearFilters={filter.kind === 'facets' ? clearAll : undefined}
                    focusAfter={focusAfter}
                  />
                </div>
              }
            >
              <div class={cn(PAGE_FILL_SCROLLER, 'flex')}>
                <div
                  data-fdt="calm-list-rows"
                  class="flex min-w-0 flex-1 flex-col"
                  onKeyDown={(event) => {
                    md.onListKeyDown(event);
                  }}
                >
                  {props.head}
                  <VirtualList
                    scrollerRole="list"
                    aria-label={props.listLabel}
                    count={visible().length}
                    estimateSize={estimate}
                    gap={CALM_ROW_GAP}
                    getItemKey={(index) => visibleIds()[index] ?? fallbackRowKey(index)}
                    createVirtualizer={props.createVirtualizer}
                    scrollTo={md.scroll.request}
                    class="min-h-0 flex-1"
                  >
                    {(item) => <CalmRow item={item} />}
                  </VirtualList>
                </div>
                <Show when={detail !== undefined && md.paneOpen() ? detail : undefined}>
                  {(spec) => (
                    <DetailPane
                      controller={md}
                      row={selectedRowValue}
                      detail={spec()}
                      noun={noun}
                    />
                  )}
                </Show>
              </div>
            </Show>
          </div>
          <Show when={detail !== undefined && md.drillOpen() ? detail : undefined}>
            {(spec) => (
              <DrillDetail
                controller={md}
                row={selectedRowValue}
                detail={spec()}
                noun={noun}
                onClearFilters={filter.narrowed() || query() !== '' ? clearAll : undefined}
              />
            )}
          </Show>
        </Show>
        <div role="status" aria-live={live()} class="sr-only" data-fdt="resource-results-status">
          {announcement()}
        </div>
      </div>
    </CalmListContext.Provider>
  );

  /**
   * One virtual row's surface: the list item (set size, position, find
   * marker, selection) around the page's row content, with the row's
   * context (key, selection, focus registration) for its open button.
   *
   * @param rowProps.item The virtual item.
   */
  function CalmRow(rowProps: { item: VirtualItem }): JSX.Element {
    // Keys are this list's own row keys (strings); the fallback never matches
    // a row. An element lives for one key (the virtual list keys elements), so
    // the key is read once.
    // eslint-disable-next-line solid/reactivity -- read once on purpose: the element is bound to this key for life
    const key = String(rowProps.item.key);
    const row = (): Row | undefined => byKey().get(key);
    const selected = (): boolean => md.selectedId() === key;
    const current = (): boolean => match.current() === rowProps.item.index;
    return (
      <Show when={row()} keyed>
        {(value) => (
          <div
            role="listitem"
            aria-setsize={visible().length}
            aria-posinset={rowProps.item.index + 1}
            // The row key the key handler reads back (`ROW_KEY_ATTRIBUTE`).
            data-fdt-row-key={key}
            data-fdt={props.rowHook ?? 'resource-row'}
            data-selected={selected() ? '' : undefined}
            aria-current={current() ? 'true' : undefined}
            class={calmRowClass({
              lines: props.lines ?? 'two',
              interactive: detail !== undefined,
              selected: selected(),
              current: current()
            })}
            onClick={(event) => {
              const open = event.currentTarget.querySelector<HTMLElement>('[data-fdt-row-open]');
              if (!pressOpensRow(event.target, event.currentTarget, open)) return;
              // A press on the row's surface lands focus where the keyboard expects it.
              if (event.target !== open) open?.focus({ preventScroll: true });
              md.open(key);
            }}
          >
            <ListRowContext.Provider
              value={{
                key,
                selected,
                registerFocus: (target) => md.focus.register(key, target)
              }}
            >
              {props.renderRow(value)}
            </ListRowContext.Provider>
          </div>
        )}
      </Show>
    );
  }
}
