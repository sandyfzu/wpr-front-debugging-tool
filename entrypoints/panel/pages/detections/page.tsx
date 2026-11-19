/**
 * The Detections page — the panel's overview: the overview tiles (score,
 * WP Rocket, page cache, stack), the status card grid (one card per detection plus the
 * serving facts); `Copy report` is the page's one primary action.
 *
 * State matrix: the shell owns idle/fetching (skeleton), fetch error (+
 * Retry) and render crashes; this body renders only on `ready` and
 * `refreshing`. Within it: plugin absent → the tiles say "Not detected" and
 * the cards still render; headers not captured → the Server /
 * Known Platform cards are omitted; a RUCSS test applied on the page → the
 * TEST MODE notice above the tiles, once. The full header inventory lives on the
 * Headers & Cookies page. A refresh swaps data only: cards are keyed by their
 * id, so their DOM and focus survive.
 *
 * The control row's status filter (All optimizations / Active / Inactive,
 * page-local, default All) narrows only the optimization cards — page-context
 * cards stay under every filter — while the tiles and `Copy report` keep
 * reading the full page. A refresh keeps the selection; a selected bucket a
 * refresh emptied stays selected and says so, with the way back to All.
 *
 * The layout choice (Adaptive / List, shell-session, from the regular tier
 * up — below it both are the same rows) changes classes only: Adaptive is
 * the width-driven grid; List bounds the control row and the rows to one
 * reading-width column, the tiles keeping the page canvas.
 *
 * Card rendering is registry-driven — the view model's rows are the card
 * set and the page-local link table decides which become links — so a new
 * detection row is a new card with no page edit.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { ChoiceGroup } from '../../../../components/ui/choice-group';
import { FilterBar } from '../../../../components/ui/filter-bar';
import {
  DETECTION_FILTER_LABEL,
  DETECTION_FILTERS,
  detectionFilterLabel,
  filterStatusItems,
  optimizationCounts,
  type DetectionFilterId
} from '../../../../lib/panel/detections-filter';
import { summarizeFdtData } from '../../../../lib/panel/detections-summary';
import { buildFilterChips } from '../../../../lib/panel/list-behavior';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import {
  createDetectionsLayout,
  DETECTION_LAYOUTS,
  useDetectionsLayout,
  type DetectionLayout,
  type DetectionsLayoutStore
} from '../../state/detections-layout';
import { useFdtData } from '../../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from '../../state/aging-clock';
import { NoMatches, PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { TestModeNotice } from '../test-mode-notice';
import { CARD_PAGE_LINKS } from './card-presentation';
import { CopyReportButton } from './copy-report-button';
import { StatusCard } from './status-card';
import { OverviewTiles } from './overview-tiles';

/** The page's one-line intro under its title. */
export const DETECTIONS_SUBTITLE = 'What WP Rocket applied to this page, and how it was served.';

/**
 * The card list's layout per tier. Compact: one grouped surface of divided
 * rows (a stack of bordered cards wastes the narrow column on chrome).
 * Regular up: an auto-fill card grid with 15 rem tracks — 1 → 2 → 3 → 4+
 * columns as width allows, wide enough that feature names stay on ≤ 2 lines.
 */
export const DETECTIONS_GRID =
  'flex flex-col divide-y divide-line-1 overflow-hidden rounded-md border border-line-1 bg-surface-1 @regular:grid @regular:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] @regular:gap-2 @regular:divide-y-0 @regular:overflow-visible @regular:rounded-none @regular:border-0 @regular:bg-transparent';

/**
 * The List layout's card list: the compact tier's grouped surface of divided
 * rows, kept at every width (the rows add their own regular-tier padding).
 */
export const DETECTIONS_LIST_GRID =
  'flex flex-col divide-y divide-line-1 overflow-hidden rounded-md border border-line-1 bg-surface-1';

/**
 * The List layout's column: the shared reading width, centered, so a wide
 * panel shows one bounded list instead of rows stretched edge to edge.
 */
export const DETECTIONS_LIST_COLUMN = 'mx-auto w-full max-w-4xl';

/** The control row's own layout (filter at the start, layout choice at the end). */
export const DETECTIONS_CONTROLS = 'flex flex-wrap items-center justify-between gap-2';

/**
 * The layout control's visibility: below the regular tier both layouts paint
 * the same rows, so a control there could change nothing. A variant on the
 * group's own `flex` (never a bare `hidden` against it, whose win would hang
 * on stylesheet order).
 */
export const LAYOUT_CONTROL = '@max-regular:hidden';

/** The layout control's group name. */
export const LAYOUT_CONTROL_LABEL = 'Detection layout';

/**
 * The card list's classes for a layout.
 *
 * @param layout The page's layout.
 * @returns {@link DETECTIONS_GRID} (adaptive) or the bounded list column.
 */
export function detectionsGridClass(layout: DetectionLayout): string {
  return layout === 'list' ? `${DETECTIONS_LIST_GRID} ${DETECTIONS_LIST_COLUMN}` : DETECTIONS_GRID;
}

/**
 * Bound a block above the card list (the control row, the filtered-empty
 * line) to the list's column in List mode; adaptive leaves it untouched.
 *
 * @param base The block's own classes (`undefined`: none).
 * @param layout The page's layout.
 * @returns `base` alone (adaptive), or `base` plus {@link DETECTIONS_LIST_COLUMN}.
 */
export function detectionsBlockClass(
  base: string | undefined,
  layout: DetectionLayout
): string | undefined {
  if (layout !== 'list') return base;
  return base === undefined ? DETECTIONS_LIST_COLUMN : `${base} ${DETECTIONS_LIST_COLUMN}`;
}

/** The filtered-empty view's reset label ("Show all" alone would not say of what). */
export const SHOW_ALL_OPTIMIZATIONS = 'Show all optimizations';

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
   * Absent: a store local to this mount, starting `adaptive`.
   */
  layoutStore?: DetectionsLayoutStore;
}

/**
 * The page body over explicit inputs (data + clock) — the testable half;
 * {@link DetectionsPage} wires it to the shell's store and a live clock.
 *
 * @param props See {@link DetectionsViewProps}.
 * @returns The page frame with its sections.
 */
export function DetectionsView(props: DetectionsViewProps): JSX.Element {
  // One pass builds the cards and their summary (the report reads the same wiring).
  const model = createMemo(() => summarizeFdtData(props.data));
  const items = () => model().items;
  const byId = createMemo(() => new Map(items().map((item) => [item.id, item])));
  // Page-local: unmount resets it to All; a refresh (same mount) keeps it.
  const [filter, setFilter] = createSignal<DetectionFilterId>('all');
  // Counts read the full card list, so the chips never count a narrowed view.
  const counts = createMemo(() => optimizationCounts(items()));
  const chips = createMemo(() =>
    buildFilterChips({ filters: DETECTION_FILTERS }, counts(), filter())
  );
  // The ids are strings, so `For` keeps each card's DOM across refreshes and
  // chip changes (a fresh item object per push would otherwise remount every card).
  const ids = createMemo(() => filterStatusItems(items(), filter()).map((item) => item.id));
  // Only a refresh can empty the selected bucket (an empty chip is not selectable).
  const filteredEmpty = (): boolean => filter() !== 'all' && counts()[filter()] === 0;
  const summary = () => model().summary;
  // Read once: the store is a per-mount input, never swapped while mounted.
  // eslint-disable-next-line solid/reactivity
  const layoutStore = props.layoutStore ?? createDetectionsLayout();
  const layout = layoutStore.layout;
  let controls: HTMLDivElement | undefined;

  return (
    <PageFrame
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
          its end. Always mounted, chips included: the All chip is never disabled, so it
          is the filtered-empty reset's focus target even on a payload with no
          optimization card (the chips then honestly read 0). A layout switch only
          swaps classes — no element remounts, so keyed cards and focus stay. */}
      <div
        ref={controls}
        data-fdt="detections-controls"
        class={detectionsBlockClass(DETECTIONS_CONTROLS, layout())}
      >
        <FilterBar
          chips={chips()}
          selected={filter()}
          onSelect={(value) => {
            // Chip values are this model's own ids (the bar echoes them back).
            setFilter(() => value as DetectionFilterId);
          }}
          filterLabel={DETECTION_FILTER_LABEL}
          showSearch={false}
        />
        <ChoiceGroup
          options={DETECTION_LAYOUTS}
          value={layout()}
          onChange={(next) => {
            layoutStore.setLayout(next);
          }}
          aria-label={LAYOUT_CONTROL_LABEL}
          class={LAYOUT_CONTROL}
        />
      </div>
      <Show when={filteredEmpty()}>
        <div data-fdt="detections-filtered-empty" class={detectionsBlockClass(undefined, layout())}>
          <NoMatches
            chipLabel={detectionFilterLabel(filter())}
            onShowAll={() => setFilter('all')}
            showAllLabel={SHOW_ALL_OPTIMIZATIONS}
            focusAfter={() => controls?.querySelector<HTMLElement>('[data-fdt-filter-chip="all"]')}
          />
        </div>
      </Show>
      <ul
        data-fdt="detections-grid"
        data-fdt-layout={layout()}
        aria-label="Detection results"
        class={detectionsGridClass(layout())}
      >
        <For each={ids()}>
          {(id) => (
            <Show when={byId().get(id)}>
              {(item) => (
                <li class="flex min-w-0">
                  <StatusCard
                    item={item()}
                    linkTo={CARD_PAGE_LINKS.get(id)}
                    now={props.now}
                    layout={layout()}
                  />
                </li>
              )}
            </Show>
          )}
        </For>
      </ul>
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
        />
      )}
    </Show>
  );
}
