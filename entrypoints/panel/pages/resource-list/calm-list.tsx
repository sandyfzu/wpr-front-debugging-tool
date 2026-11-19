/**
 * The panel's filter/search/list body (the list kit): calm rows (no frame,
 * no hairlines, 4 px apart), a column header that stays above the scroller,
 * the combinable facets or the search field alone, and — when the page
 * declares a detail — the master–detail (`./master-detail`).
 *
 * State matrix:
 * - **empty** (no rows): the caller's empty view, no controls;
 * - **filtered-empty**: `NoMatches` naming the facet values and the query,
 *   with the one-click ways back (`Clear filters` clears facets and search);
 * - **populated**: the virtualized list, plus the side pane or the drill
 *   detail for a selection (listed / no longer listed / no longer on the page).
 *
 * Search and find: one store (`useSearch`), two inputs (the field and the
 * DevTools find bar); the find's cursor marks and scrolls the current row; a
 * find event in the drill detail returns to the list first. A refresh keeps
 * the query, filters, selection and scroll (the body stays mounted; rows
 * reconcile by key).
 *
 * The root is its own `@container` and the measured box: rows' tier
 * variants, the facet fold and the pane/drill rule all read one width.
 */
import type { Accessor, JSX } from 'solid-js';
import { createMemo, createSignal, Show } from 'solid-js';
import { SearchField } from '../../../../components/ui/search-field';
import {
  VirtualList,
  type VirtualItem,
  type VirtualizerFactory
} from '../../../../components/ui/virtual-list';
import {
  applyFacets,
  defineFacets,
  facetCounts,
  selectedFacets,
  type FacetCounts,
  type FacetSelection,
  type FacetSet
} from '../../../../lib/panel/resource-facets';
import {
  countLabel,
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
import { NoMatches, PAGE_CANVAS, PAGE_FILL_SCROLLER } from '../page-frame';
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

/** A search-only list's facets: none (the search alone narrows). */
const NO_FACETS: FacetSet<unknown, never> = defineFacets<unknown, never>([]);

/** The list's props. */
export interface CalmFilteredListProps<Row, Id extends string> {
  /** The list's facets; omitted = a search-only list (the field alone, no facet bar). */
  readonly facets?: FacetSet<Row, Id>;
  /** The searched field (the page's own searched-field rule). */
  readonly searchField: (row: Row) => string;
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

/** The facets' live state, as the list renders it. */
interface FacetFilter<Row, Id extends string> {
  /** The rows the facets + query keep, in list order. */
  readonly visible: Accessor<readonly Row[]>;
  /** The narrowing values' labels (the filtered-empty sentence). */
  readonly labels: Accessor<readonly string[]>;
  /** Whether a facet narrows (besides the query). */
  readonly narrowed: Accessor<boolean>;
  readonly picks: Accessor<FacetSelection<Id>>;
  readonly counts: Accessor<FacetCounts<Id>>;
  pick(next: FacetSelection<Id>): void;
  /** Back to no facet. */
  reset(): void;
}

/**
 * The facets: one value per facet, standard faceted counts, one pass.
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
    picks,
    pick: (next) => setPicks(() => next),
    counts,
    visible,
    labels,
    narrowed: () => labels().length > 0,
    reset: () => setPicks(() => noFacetSelection<Id>())
  };
}

/**
 * Render the list body.
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
  // The facets and the searched field are static per list (a page passes module constants).
  // eslint-disable-next-line solid/reactivity -- read once on purpose: a list's facets are a module constant
  const facets: FacetSet<Row, Id> | undefined = props.facets;
  // eslint-disable-next-line solid/reactivity -- read once on purpose: as above
  const filter = createFacetFilter(facets ?? NO_FACETS, props.searchField, rows, query);
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
    actions: [filter.picks, query]
  });

  const estimate = (index: number): number => {
    const row = visible()[index];
    const isCompact = compact();
    if (row !== undefined && props.estimateSize !== undefined)
      return props.estimateSize(row, isCompact);
    return calmRowEstimate(props.lines ?? 'two', isCompact, false);
  };

  const searchField = (): JSX.Element => (
    <SearchField
      value={field.value()}
      onValueChange={(raw) => {
        field.input(raw);
      }}
      label={props.searchLabel}
      placeholder={props.searchPlaceholder}
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
            // The drill detail covers the list (an opaque overlay), which stays
            // laid out (its scroll position and virtual window survive) and
            // inert. Never hidden by `visibility`: under reduced motion every
            // property change runs as a near-zero transition, and a list still
            // `hidden` while Back hands focus to its row drops that focus.
            inert={md.drillOpen()}
            class="flex min-h-0 flex-1 flex-col gap-3"
          >
            {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
            <div ref={controls} onKeyDown={field.onKeyDown}>
              <Show when={facets} fallback={searchField()}>
                {(set) => (
                  <FacetBar
                    facets={set()}
                    selection={filter.picks()}
                    counts={filter.counts()}
                    onChange={(next) => {
                      filter.pick(next);
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
                    filterLabels={filter.labels()}
                    query={query()}
                    onClearSearch={() => {
                      field.clear();
                    }}
                    onClearFilters={clearAll}
                    focusAfter={searchInput}
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
                    // Opaque in the canvas's own color (no visible change): the
                    // scroller then backs its whole scrolled extent, so overscan
                    // rows past its visible window resolve their text background
                    // to it — over a transparent scroller they sit on the shell,
                    // whose box ends at the viewport, and contrast checks report
                    // them undeterminable.
                    class={cn('min-h-0 flex-1', PAGE_CANVAS)}
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
