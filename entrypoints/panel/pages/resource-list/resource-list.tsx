/**
 * The resource-list page body shared by the Lazyload and Preloaded Resources
 * pages: one filter/search/list pattern over a page's row type, so each page
 * declares only its rows, summary, empty state and row renderer.
 *
 * Layout (a `fill` frame): header → summary strip (feature presence + row
 * total; per-filter counts live on the chips only) → filter bar → the list
 * region (the one scroller). State matrix — the shell owns loading, error and
 * crash; this body renders:
 * - **empty** (no rows on the page): the page's own empty view in the list region;
 * - **filtered-empty** (chip and/or query hide every row): `NoMatches` with the
 *   one-click ways back, focus handed to the search field / the default chip;
 * - **populated**: the virtualized list (`role="list"`, rows `listitem` with
 *   their set size and position).
 *
 * Search — one query, two inputs: the in-page field and the DevTools find bar
 * drive the same search store. The field streams into `perform` (the store
 * owns the debounce), keeps its own raw text while typing, and re-syncs from
 * the committed query whenever it changes elsewhere (find bar, `cancel`,
 * route reset); clearing it (✕ or Esc) cancels at once. Limitation: the
 * DevTools find bar's own text cannot be written back (no platform setter),
 * and a find-bar cancel that lands while the committed query is already empty
 * leaves the field's uncommitted text in place (the store reports no change).
 *
 * Selection and query survive a data refresh (the body stays mounted); the
 * selection resets with the route (the body remounts).
 */
import type { JSX } from 'solid-js';
import { createComputed, createEffect, createMemo, createSignal, on, Show } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { FilterBar, type FilterChip } from '../../../../components/ui/filter-bar';
import { StatusBadge } from '../../../../components/ui/status-badge';
import { VirtualList, type VirtualizerFactory } from '../../../../components/ui/virtual-list';
import {
  filterAndSearch,
  filterCounts,
  type ResourcePageDefinition
} from '../../../../lib/panel/resources-view-model';
import { cn } from '../../../../utils/cn';
import type { RouteId } from '../../routes';
import { useSearch } from '../../state/use-fdt-data';
import { NoMatches, PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import {
  buildFilterChips,
  countLabel,
  defaultChipId,
  narrowingChipLabel,
  normalizeQuery,
  resultsAnnouncement,
  type CountNoun
} from './resource-list-view';

/** The row contract: a stable id (document order) the list keys on. */
export interface ResourceRow {
  /** Stable row identity (the virtual list's item key). */
  readonly id: number;
}

/** The list region's frame — the same box for rows, empty and filtered-empty views. */
const LIST_REGION = 'rounded-md border border-line-1 bg-surface-1';

/** Props of {@link ResourceListPage}. */
export interface ResourceListPageProps<Row extends ResourceRow, Id extends string> {
  /** The route this body renders. */
  id: RouteId;
  /** The page `h1`. */
  title: string;
  /** The one-line "what am I looking at". */
  subtitle: string;
  /** The page's chips + searched field. */
  definition: ResourcePageDefinition<Row, Id>;
  /** Every row on the page (reactive: a refresh swaps it). */
  rows: readonly Row[];
  /** The WP Rocket feature the page inspects, as the option map names it. */
  featureLabel: string;
  /** Whether that feature's footprint was detected on the page. */
  featurePresent: boolean;
  /** The view shown in the list region when the page has no rows at all. */
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
  /** The virtualizer seam (tests inject a layout-free double). */
  createVirtualizer?: VirtualizerFactory;
}

/**
 * Render a resource-list page body.
 *
 * @param props See {@link ResourceListPageProps}.
 */
export function ResourceListPage<Row extends ResourceRow, Id extends string>(
  props: ResourceListPageProps<Row, Id>
): JSX.Element {
  const search = useSearch();
  // The definition is static per page; resolving the default chip once keeps
  // a definition without chips failing at mount, loudly.
  // eslint-disable-next-line solid/reactivity -- read once on purpose: a page's definition is a module constant
  const allChip = defaultChipId(props.definition);
  const [selected, setSelected] = createSignal<Id>(allChip);
  const [fieldText, setFieldText] = createSignal(search.query());
  let controls: HTMLDivElement | undefined;

  // The store changed elsewhere (find bar, cancel, route reset): the field follows.
  createEffect(
    on(
      search.query,
      (query) => {
        setFieldText(query);
      },
      { defer: true }
    )
  );

  const query = createMemo(() => normalizeQuery(search.query()));
  const counts = createMemo(() => filterCounts(props.rows, props.definition));
  const visible = createMemo(() =>
    filterAndSearch(props.rows, props.definition, selected(), query())
  );
  // The bar renders chips with a keyed-by-reference `For`: fresh chip objects
  // would re-create every chip button on each selection or refresh and drop
  // the focus sitting on one. Reconciling by chip value keeps one stable
  // object per chip whose fields update in place.
  const [chips, setChips] = createStore<FilterChip[]>([]);
  createComputed(() => {
    setChips(reconcile(buildFilterChips(props.definition, counts(), selected()), { key: 'value' }));
  });

  // K-4: one polite line per committed filter/query change — never per
  // keystroke (the store commits after its debounce) and never on mount or a
  // data refresh (the shell's status line owns those).
  const [announcement, setAnnouncement] = createSignal('');
  createEffect(
    on(
      [selected, query],
      () => {
        setAnnouncement(resultsAnnouncement(visible().length, props.rows.length, props.noun));
      },
      { defer: true }
    )
  );

  /** Typing streams into the store; a blank field clears it now. */
  const onSearchChange = (text: string): void => {
    setFieldText(text);
    if (normalizeQuery(text) === '') search.cancel();
    else search.perform(text);
  };

  /** The `Clear search` way back (and Esc in the field). */
  const clearSearch = (): void => {
    setFieldText('');
    search.cancel();
  };

  /** Esc in the search field clears it, whatever the engine's native search-field behavior. */
  const onControlsKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !(event.target instanceof HTMLInputElement)) return;
    if (event.target.type !== 'search' || fieldText() === '') return;
    event.preventDefault();
    clearSearch();
  };

  /** Where focus lands once a `NoMatches` way back removes its button. */
  const focusAfter = (action: 'clear-search' | 'show-all'): HTMLElement | null | undefined =>
    action === 'clear-search'
      ? controls?.querySelector<HTMLElement>('input[type="search"]')
      : controls?.querySelector<HTMLElement>(`[data-fdt-filter-chip="${allChip}"]`);

  return (
    <PageFrame id={props.id} title={props.title} subtitle={props.subtitle} fill>
      <ResourceSummary
        featureLabel={props.featureLabel}
        featurePresent={props.featurePresent}
        total={countLabel(props.rows.length, props.noun)}
      />
      <Show
        when={props.rows.length > 0}
        fallback={<div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'grid')}>{props.empty}</div>}
      >
        <div ref={controls} onKeyDown={onControlsKeyDown}>
          <FilterBar
            chips={chips}
            selected={selected()}
            onSelect={(value) => {
              // Chip values are the definition's own ids (the bar echoes them back).
              setSelected(() => value as Id);
            }}
            filterLabel={`Filter ${props.listLabel.toLowerCase()}`}
            searchQuery={fieldText()}
            onSearchChange={onSearchChange}
            searchLabel={props.searchLabel}
            searchPlaceholder={props.searchPlaceholder}
            // The field spans the column when compact; a fixed comfortable
            // width from the regular tier (a full-width field reads as a banner).
            class="[&_input]:w-full @regular:[&_input]:w-72"
          />
        </div>
        <Show
          when={visible().length > 0}
          fallback={
            <div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'grid place-items-center')}>
              <NoMatches
                chipLabel={narrowingChipLabel(props.definition, selected())}
                query={query()}
                onClearSearch={clearSearch}
                onShowAll={() => {
                  setSelected(() => allChip);
                }}
                focusAfter={focusAfter}
              />
            </div>
          }
        >
          <VirtualList
            scrollerRole="list"
            aria-label={props.listLabel}
            count={visible().length}
            estimateSize={(index) => {
              const row = visible()[index];
              return row === undefined ? 36 : props.estimateSize(row);
            }}
            getItemKey={(index) => visible()[index]?.id ?? `index-${index.toString()}`}
            createVirtualizer={props.createVirtualizer}
            class={cn(PAGE_FILL_SCROLLER, LIST_REGION)}
          >
            {(item) => (
              <Show when={visible()[item.index]} keyed>
                {(row) => (
                  <div
                    role="listitem"
                    aria-setsize={visible().length}
                    aria-posinset={item.index + 1}
                    data-fdt="resource-row"
                    class={cn('min-h-8 px-2 py-1.5', item.index > 0 && 'border-t border-line-1')}
                  >
                    {props.renderRow(row)}
                  </div>
                )}
              </Show>
            )}
          </VirtualList>
        </Show>
      </Show>
      <div role="status" class="sr-only" data-fdt="resource-results-status">
        {announcement()}
      </div>
    </PageFrame>
  );
}

/** Props of {@link ResourceSummary}. */
interface ResourceSummaryProps {
  /** The feature's option-map label. */
  featureLabel: string;
  /** Whether its footprint was detected. */
  featurePresent: boolean;
  /** The counted row total ("24 images"). */
  total: string;
}

/**
 * The summary strip: the feature's presence as a status badge whose state is
 * spelled out (never color alone) and the page's row total.
 *
 * @param props See {@link ResourceSummaryProps}.
 */
function ResourceSummary(props: ResourceSummaryProps): JSX.Element {
  return (
    <div data-fdt="resource-summary" class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <StatusBadge kind={props.featurePresent ? 'ok' : 'neutral'} icon>
        {props.featureLabel}
        <span class="font-normal">{props.featurePresent ? 'detected' : 'not detected'}</span>
      </StatusBadge>
      <span data-fdt="resource-total" class="text-2xs text-fg-secondary tabular-nums">
        {props.total}
      </span>
    </div>
  );
}
