/**
 * The Detections page — the panel's overview: the overview tiles (score,
 * WP Rocket, page cache, stack), then every detection as a calm row (or a
 * card); `Copy report` is the page's one primary action.
 *
 * State matrix: the shell owns idle/fetching (skeleton), fetch error (+
 * Retry) and render crashes; this body renders only on `ready` and
 * `refreshing`. Within it: plugin absent → the tiles say "Not detected" and
 * the rows still render; headers not captured → the Server /
 * Known Platform rows are omitted; a RUCSS test applied on the page → the
 * TEST MODE notice above the tiles, once. The full header inventory lives on the
 * Headers & Cookies page. A refresh swaps data only: rows are keyed by their
 * id, so their DOM and focus survive.
 *
 * The control row's status filter (All / Active / Collecting / Off, with
 * counts, page-local, default All) narrows only the optimization rows —
 * page-context rows stay under every filter — while the tiles and
 * `Copy report` keep reading the full page. A refresh keeps the selection; a
 * selected bucket a refresh emptied stays selected and says so, with the way
 * back to All.
 *
 * The search ("Filter features…") narrows every row by its name on top of
 * the status filter. It is the panel's one search store, so the DevTools
 * find bar drives it too: the rendered rows are the match set, the find's
 * cursor marks one and scrolls it into view; a refresh keeps the query. A
 * query that hides every row lands on the shared filtered-empty view with
 * its ways back (Clear search, and Show all when a status is picked).
 *
 * The layout choice (shell-session, offered from the regular tier up):
 * Grouped (default) puts the rows under WP Rocket's settings sections, each
 * with its "N of M optimizations active", and leaves the facts the tiles
 * state to the tiles; List is every row in one bounded column; Cards the
 * same set as a width-driven grid. Below the regular tier the page renders
 * Grouped whatever the choice (the control is hidden there); the choice
 * returns once the page is wide enough. List ↔ Cards only swaps classes;
 * Grouped mounts its own sections (focus stays on the layout control that
 * switched it).
 *
 * Rendering is registry-driven — the view model's rows are the entry set,
 * `detections-groups` places them and the page-local link table decides
 * which carry a page link — so a new detection row is a new entry with no
 * page edit.
 */
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
  untrack
} from 'solid-js';
import { ChoiceGroup, type ChoiceOption } from '../../../../components/ui/choice-group';
import { createKeyedChoices } from '../../../../components/ui/keyed-choices';
import { SearchField } from '../../../../components/ui/search-field';
import { SOURCE_COPY } from '../../../../lib/detection/hud';
import {
  DETECTION_FILTER_LABEL,
  DETECTION_FILTERS,
  detectionFilterLabel,
  filterStatusItems,
  optimizationCounts,
  searchStatusItems,
  type DetectionFilterId
} from '../../../../lib/panel/detections-filter';
import {
  groupDetections,
  groupSummaryText,
  showsOwnSource,
  type DetectionGroup
} from '../../../../lib/panel/detections-groups';
import { summarizeFdtData } from '../../../../lib/panel/detections-summary';
import { normalizeQuery } from '../../../../lib/panel/list-behavior';
import type { StatusItem, StatusItemId } from '../../../../lib/panel/detections-view-model';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { cn } from '../../../../utils/cn';
import {
  createDetectionsLayout,
  DETECTION_LAYOUTS,
  shownDetectionLayout,
  useDetectionsLayout,
  type DetectionsLayoutStore
} from '../../state/detections-layout';
import { createSearchStore, type SearchStore } from '../../state/search';
import { bindSearchField } from '../../state/search-field';
import { useFdtData, useSearch } from '../../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from '../../state/aging-clock';
import { createCurrentMatch, CURRENT_MATCH_ROW } from '../current-match';
import { NoMatches, PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { createContentWidth } from '../resource-list/content-width';
import { TestModeNotice } from '../test-mode-notice';
import { CARD_PAGE_LINKS } from './card-presentation';
import { CopyReportButton } from './copy-report-button';
import {
  blockClass,
  DETECTIONS_CONTROLS,
  flatBodyClass,
  GROUP_HEADER,
  GROUP_SURFACE,
  GROUPED_BODY
} from './entry-layout';
import { SourceChip, StatusCard } from './status-card';
import { OverviewTiles } from './overview-tiles';

/** The page's one-line intro under its title. */
export const DETECTIONS_SUBTITLE = 'What WP Rocket applied to this page, and how it was served.';

/**
 * The layout control's visibility: hidden below the regular tier, where the
 * panel is a phone-width column and the page always renders Grouped
 * (`shownDetectionLayout`, the same threshold in script). A variant on the
 * group's own `flex` (never a bare `hidden` against it, whose win would hang
 * on stylesheet order).
 */
export const LAYOUT_CONTROL = '@max-regular:hidden';

/** The layout control's group name. */
export const LAYOUT_CONTROL_LABEL = 'Detection layout';

/** The filtered-empty view's reset label ("Show all" alone would not say of what). */
export const SHOW_ALL_OPTIMIZATIONS = 'Show all optimizations';

/** The search field's name and placeholder. */
export const DETECTIONS_SEARCH = { label: 'Filter features', placeholder: 'Filter features…' };

/**
 * The search's slot in the control row: a full line below the regular tier,
 * a bounded field pushed to the row's end (before the layout choice) there.
 */
const SEARCH_SLOT = 'min-w-0 basis-full @regular:ms-auto @regular:basis-60';

/**
 * The status filter's segments: the declared filters with their counts. An
 * empty bucket is disabled (nothing to show) unless it is the selected one —
 * a refresh-emptied selection stays reachable, never a dead end; All never
 * disables (it is the reset target).
 *
 * @param counts One count per filter id (the full page's).
 * @param selected The selected filter.
 * @returns The segments, in declared order.
 */
export function filterOptions(
  counts: Readonly<Record<DetectionFilterId, number>>,
  selected: DetectionFilterId
): ChoiceOption<DetectionFilterId>[] {
  return DETECTION_FILTERS.map((filter) => ({
    value: filter.id,
    label: filter.label,
    count: counts[filter.id],
    disabled: filter.id !== 'all' && filter.id !== selected && counts[filter.id] === 0
  }));
}

/** Props of {@link DetectionsView}. */
export interface DetectionsViewProps {
  /** The loaded page data. */
  data: FdtData;
  /** The page clock reading (epoch ms) relative ages read. */
  now: number;
  /** Reloads the inspected page (the TEST MODE notice's remedy); absent where it cannot. */
  reloadInspectedPage?: () => void;
  /**
   * The layout store; the route body passes the shell's (session-wide).
   * Absent: a store local to this mount, starting `grouped`.
   */
  layoutStore?: DetectionsLayoutStore;
  /**
   * The panel's search store (the field and the DevTools find bar share it);
   * the route body passes the shell's. Absent: a store local to this mount.
   */
  search?: SearchStore;
}

/** What every entry renderer reads: rows by id, the clock and the find's mark. */
interface EntrySource {
  /** The current row of an id (undefined once a refresh removed it). */
  readonly row: (id: StatusItemId) => StatusItem | undefined;
  /** The page clock reading. */
  readonly now: () => number;
  /** Whether the find's cursor names this row. */
  readonly current: (id: StatusItemId) => boolean;
}

/**
 * One row's list item: the entry, marked while the find's cursor names it
 * (the shared marker plus `aria-current`).
 *
 * @param props.id The row's id (its `data-fdt-entry-id`, the scroll target).
 * @param props.current Whether the find names it.
 * @param props.children The entry.
 */
function EntryItem(props: {
  id: StatusItemId;
  current: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <li
      data-fdt-entry-id={props.id}
      aria-current={props.current ? 'true' : undefined}
      class={cn('flex min-w-0 rounded-lg', props.current && CURRENT_MATCH_ROW)}
    >
      {props.children}
    </li>
  );
}

/**
 * One group of the Grouped layout: header (h2, the source chip when every
 * row carries the same source, "N of M optimizations active") over its
 * rows; without a header chip each row with a source shows its own.
 *
 * @param props.group The group.
 * @param props.source Rows by id and the clock.
 * @returns The section.
 */
function GroupSection(props: { group: DetectionGroup; source: EntrySource }): JSX.Element {
  // Unique per group: the page renders each group id once.
  const headingId = (): string => `detections-group-${props.group.id}`;
  const ids = createMemo(() => props.group.items.map((item) => item.id));
  const summary = () => groupSummaryText(props.group);
  return (
    <section
      data-fdt="detections-group"
      data-fdt-group={props.group.id}
      data-fdt-group-norm={props.group.evidenceNorm ?? undefined}
      aria-labelledby={headingId()}
      class={GROUP_SURFACE}
    >
      <div class={GROUP_HEADER}>
        <h2 id={headingId()} class="text-xs font-semibold text-fg-primary">
          {props.group.heading}
        </h2>
        <Show when={props.group.evidenceNorm}>
          {(norm) => <SourceChip copy={SOURCE_COPY[norm()]} scope="group" />}
        </Show>
        <Show when={summary()}>
          {(text) => (
            <span data-fdt-group-summary class="ms-auto text-2xs text-fg-muted tabular-nums">
              {text()}
            </span>
          )}
        </Show>
      </div>
      <ul class="flex flex-col gap-1">
        <For each={ids()}>
          {(id) => (
            <Show when={props.source.row(id)}>
              {(item) => (
                <EntryItem id={id} current={props.source.current(id)}>
                  <StatusCard
                    item={item()}
                    linkTo={CARD_PAGE_LINKS.get(id)}
                    now={props.source.now()}
                    layout="grouped"
                    showSource={showsOwnSource(item(), props.group.evidenceNorm)}
                  />
                </EntryItem>
              )}
            </Show>
          )}
        </For>
      </ul>
    </section>
  );
}

/**
 * The page body over explicit inputs (data + clock) — the testable half;
 * {@link DetectionsPage} wires it to the shell's store and a live clock.
 *
 * @param props See {@link DetectionsViewProps}.
 * @returns The page frame with its sections.
 */
export function DetectionsView(props: DetectionsViewProps): JSX.Element {
  // One pass builds the rows and their summary (the report reads the same wiring).
  const model = createMemo(() => summarizeFdtData(props.data));
  const items = () => model().items;
  const byId = createMemo(() => new Map(items().map((item) => [item.id, item])));
  // Page-local: unmount resets it to All; a refresh (same mount) keeps it.
  const [filter, setFilter] = createSignal<DetectionFilterId>('all');
  // Counts read the full row list, so the segments never count a narrowed view.
  const counts = createMemo(() => optimizationCounts(items()));
  // Keyed by value: each segment keeps its DOM and focus while counts and
  // availability change under it.
  const options = createKeyedChoices(() => filterOptions(counts(), filter()));
  // Read once: the store is a per-mount input (the shell provides one).
  // eslint-disable-next-line solid/reactivity
  const search = props.search ?? createSearchStore();
  const field = bindSearchField(search);
  const query = createMemo(() => normalizeQuery(search.query()));
  const shown = createMemo(() => searchStatusItems(filterStatusItems(items(), filter()), query()));
  // The ids are strings, so `For` keeps each row's DOM across refreshes and
  // filter changes (a fresh item object per push would otherwise remount every row).
  const ids = createMemo(() => shown().map((item) => item.id));
  const groups = createMemo(() => groupDetections(items(), shown()));
  // Keyed by id like the rows: a refresh re-derives each group, never remounts it.
  const groupIds = createMemo(() => groups().map((group) => group.id));
  const groupById = createMemo(() => new Map(groups().map((group) => [group.id, group])));
  // Only a refresh can empty the selected bucket (an empty segment is not selectable).
  const bucketEmptied = (): boolean => filter() !== 'all' && counts()[filter()] === 0;
  const summary = () => model().summary;
  // Read once: the store is a per-mount input, never swapped while mounted.
  // eslint-disable-next-line solid/reactivity
  const layoutStore = props.layoutStore ?? createDetectionsLayout();
  // The page container's width decides what renders; the store keeps the choice.
  const pageWidth = createContentWidth();
  const layout = createMemo(() => shownDetectionLayout(layoutStore.layout(), pageWidth.width()));
  const flatLayout = () => {
    const current = layout();
    return current === 'grouped' ? undefined : current;
  };
  // The rendered rows in render order (Grouped renders by group, and leaves
  // the facts the tiles state to them): the find's match set.
  const renderedIds = createMemo((): readonly StatusItemId[] =>
    flatLayout() === undefined
      ? groups().flatMap((group) => group.items.map((item) => item.id))
      : ids()
  );
  const match = createCurrentMatch(search, () => renderedIds().length);
  const currentId = createMemo(() => {
    const index = match.current();
    return index === null ? null : (renderedIds()[index] ?? null);
  });
  // A query hiding every row (a bucket a refresh emptied keeps the context rows).
  const searchEmpty = (): boolean => query() !== '' && renderedIds().length === 0;
  const filteredEmpty = (): boolean => bucketEmptied() || searchEmpty();
  const source: EntrySource = {
    row: (id) => byId().get(id),
    now: () => props.now,
    current: (id) => currentId() === id
  };
  let filterRef: HTMLDivElement | undefined;
  let searchRef: HTMLDivElement | undefined;
  let bodyRef: HTMLDivElement | undefined;
  // The find's steps scroll their row into view (nearest edge); geometry
  // changes never do (the request's own contract), nor does the mount.
  createEffect(
    on(
      match.request,
      (request) => {
        if (request === null) return;
        const id = untrack(renderedIds)[request.index];
        if (id === undefined) return;
        bodyRef
          ?.querySelector<HTMLElement>(`[data-fdt-entry-id="${id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      },
      { defer: true }
    )
  );

  return (
    <PageFrame
      ref={pageWidth.ref}
      id="detections"
      title="Detections"
      subtitle={DETECTIONS_SUBTITLE}
      actions={<CopyReportButton data={props.data} />}
    >
      <TestModeNotice
        fact={props.data.rucssTestMode}
        reloadInspectedPage={props.reloadInspectedPage}
      />
      <OverviewTiles data={props.data} summary={summary()} now={props.now} />
      {/* The page's control row: the status filter at its start, the layout choice at
          its end. Always mounted, segments included: All is never disabled, so it is
          the filtered-empty reset's focus target even on a payload with no
          optimization row (the counts then honestly read 0). */}
      <div data-fdt="detections-controls" class={blockClass(DETECTIONS_CONTROLS, layout())}>
        <div ref={filterRef} data-fdt="detections-filter" class="contents">
          <ChoiceGroup
            variant="segmented"
            options={options}
            value={filter()}
            onChange={(next) => setFilter(() => next)}
            aria-label={DETECTION_FILTER_LABEL}
          />
        </div>
        {/* Esc in the field is the binding's rule; the ref targets the way-back focus. */}
        <div
          ref={searchRef}
          data-fdt="detections-search"
          class={SEARCH_SLOT}
          onKeyDown={field.onKeyDown}
        >
          <SearchField
            value={field.value()}
            onValueChange={(raw) => {
              field.input(raw);
            }}
            label={DETECTIONS_SEARCH.label}
            placeholder={DETECTIONS_SEARCH.placeholder}
          />
        </div>
        <ChoiceGroup
          variant="segmented"
          options={DETECTION_LAYOUTS}
          value={layoutStore.layout()}
          onChange={(next) => {
            layoutStore.setLayout(next);
          }}
          aria-label={LAYOUT_CONTROL_LABEL}
          class={LAYOUT_CONTROL}
        />
      </div>
      <Show when={filteredEmpty()}>
        <div data-fdt="detections-filtered-empty" class={blockClass(undefined, layout())}>
          <NoMatches
            chipLabel={filter() === 'all' ? undefined : detectionFilterLabel(filter())}
            onShowAll={() => setFilter('all')}
            showAllLabel={SHOW_ALL_OPTIMIZATIONS}
            query={query()}
            onClearSearch={() => {
              field.clear();
            }}
            focusAfter={(action) =>
              action === 'clear-search'
                ? searchRef?.querySelector<HTMLElement>('input[type="search"]')
                : filterRef?.querySelector<HTMLElement>('[data-fdt-choice-value="all"] input')
            }
          />
        </div>
      </Show>
      <Show
        when={flatLayout()}
        fallback={
          <div
            ref={bodyRef}
            data-fdt="detections-grid"
            data-fdt-layout="grouped"
            role="group"
            aria-label="Detection results"
            class={GROUPED_BODY}
          >
            <For each={groupIds()}>
              {(id) => (
                <Show when={groupById().get(id)}>
                  {(group) => <GroupSection group={group()} source={source} />}
                </Show>
              )}
            </For>
          </div>
        }
      >
        {(flat) => (
          <div ref={bodyRef} class="contents">
            <ul
              data-fdt="detections-grid"
              data-fdt-layout={flat()}
              aria-label="Detection results"
              class={flatBodyClass(flat())}
            >
              <For each={ids()}>
                {(id) => (
                  <Show when={source.row(id)}>
                    {(item) => (
                      <EntryItem id={id} current={source.current(id)}>
                        <StatusCard
                          item={item()}
                          linkTo={CARD_PAGE_LINKS.get(id)}
                          now={props.now}
                          layout={flat()}
                        />
                      </EntryItem>
                    )}
                  </Show>
                )}
              </For>
            </ul>
          </div>
        )}
      </Show>
    </PageFrame>
  );
}

/**
 * The Detections route body: the loaded data from the shell's store and one
 * aging clock for the page's relative times (ticking only while the panel is
 * visible; stopped when the page unmounts).
 *
 * @returns The page body (nothing while the store holds no loaded data).
 */
export function DetectionsPage(): JSX.Element {
  const store = useFdtData();
  const layoutStore = useDetectionsLayout();
  const search = useSearch();
  const clock = createAgingClock(realAgingClockDeps());
  // The shell mounts page bodies only over loaded data.
  clock.setLoaded(true);
  onCleanup(() => {
    clock.stop();
  });
  const data = createMemo((): FdtData | null => {
    const state = store.state();
    return state.status === 'ready' || state.status === 'refreshing' ? state.data : null;
  });
  return (
    <Show when={data()}>
      {(loaded) => (
        <DetectionsView
          data={loaded()}
          now={clock.now()}
          reloadInspectedPage={inspectedReloadAction(browser)}
          layoutStore={layoutStore}
          search={search}
        />
      )}
    </Show>
  );
}
