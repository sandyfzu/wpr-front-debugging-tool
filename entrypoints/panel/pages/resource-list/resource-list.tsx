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
 * Search — one query, two inputs, through the shared field binding
 * (`state/search-field`): the in-page field and the DevTools find bar drive
 * the same search store. The field streams into `perform` (the store owns the
 * debounce), keeps its own raw text while typing, and re-syncs from the
 * committed query whenever another input changes (find bar, `cancel`, route
 * reset) — a find-bar cancel drops the field's pending echo even when the
 * committed query is already empty (the reset is a store event with no
 * query change). Clearing it (✕ or Esc) cancels at once. Limitation: the
 * DevTools find bar's own text cannot be written back (no platform setter).
 *
 * Selection and query survive a data refresh (the body stays mounted); the
 * selection resets with the route (the body remounts).
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { FilterBar } from '../../../../components/ui/filter-bar';
import { StatusBadge } from '../../../../components/ui/status-badge';
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
import { countLabel, defaultChipId, type CountNoun } from '../../../../lib/panel/list-behavior';
import { cn } from '../../../../utils/cn';
import type { RouteId } from '../../routes';
import { useSearch } from '../../state/use-fdt-data';
import { bindSearchField } from '../../state/search-field';
import { NoMatches, PAGE_FILL_SCROLLER, PageFrame } from '../page-frame';
import { createResultsAnnouncement } from '../results-announcement';
import {
  buildFilterChips,
  narrowingChipLabel,
  normalizeQuery,
  reconcileRows
} from './resource-list-view';

/** The row contract: a unique, stable id (source position) the list keys on. */
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
  /**
   * Whether two rows with the same id carry the same content: unchanged rows
   * keep their object (and so their rendered row and focus) across a refresh.
   */
  sameRow: (a: Row, b: Row) => boolean;
  /** Muted lines under the summary strip (capped list, feature caveats). */
  notes?: readonly string[];
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
  // Rows are looked up by the list's key, never by window index: an index
  // read during a chip change can name another row for a moment and remount it.
  const rowById = createMemo(
    () => new Map<VirtualItem['key'], Row>(visible().map((row) => [row.id, row]))
  );
  const chips = createMemo(() => buildFilterChips(props.definition, counts(), selected()));

  // The shared count line: truthful text always; a data refresh updates it
  // silently (`aria-live="off"` in the same reactive wave), a committed
  // filter/query change announces again — never per keystroke, never on
  // mount (the region renders with its initial content). The noun is a
  // page-level constant (declared with the page's rows' vocabulary).
  // eslint-disable-next-line solid/reactivity -- read once on purpose: a page's noun is a module constant
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
    <PageFrame id={props.id} title={props.title} subtitle={props.subtitle} fill>
      <ResourceSummary
        featureLabel={props.featureLabel}
        featurePresent={props.featurePresent}
        total={rows().length > 0 ? countLabel(rows().length, noun) : undefined}
        notes={props.notes}
      />
      <Show
        when={rows().length > 0}
        fallback={<div class={cn(PAGE_FILL_SCROLLER, LIST_REGION, 'grid')}>{props.empty}</div>}
      >
        {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
        <div ref={controls} onKeyDown={field.onKeyDown}>
          <FilterBar
            chips={chips()}
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
          <VirtualList
            scrollerRole="list"
            aria-label={props.listLabel}
            count={visible().length}
            estimateSize={(index) => {
              const row = visible()[index];
              return row === undefined ? 36 : props.estimateSize(row);
            }}
            // Row ids are source positions — unique even when two rows share a
            // URL (the same image twice), stable across chip/search changes.
            getItemKey={(index) => visible()[index]?.id ?? `index-${index.toString()}`}
            createVirtualizer={props.createVirtualizer}
            class={cn(PAGE_FILL_SCROLLER, LIST_REGION)}
          >
            {(item) => (
              <Show when={rowById().get(item.key)} keyed>
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
      <div role="status" aria-live={live()} class="sr-only" data-fdt="resource-results-status">
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
  /** The counted row total ("24 images"); omitted when the page has none. */
  total?: string;
  /** Muted caveat lines. */
  notes?: readonly string[];
}

/**
 * The summary strip: the feature's presence as a status badge whose state is
 * spelled out (never color alone), the page's row total, and any caveat notes
 * on their own lines.
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
      <Show when={props.total}>
        <span data-fdt="resource-total" class="text-2xs text-fg-secondary tabular-nums">
          {props.total}
        </span>
      </Show>
      <For each={props.notes}>
        {(note) => (
          <p data-fdt="resource-note" class="basis-full text-2xs text-fg-muted">
            {note}
          </p>
        )}
      </For>
    </div>
  );
}
