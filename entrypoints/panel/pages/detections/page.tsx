/**
 * The Detections page — the panel's overview: a summary strip with the
 * page-level facts, the status card grid (one card per detection plus the
 * serving facts); `Copy report` is the page's one primary action.
 *
 * State matrix: the shell owns idle/fetching (skeleton), fetch error (+
 * Retry) and render crashes; this body renders only on `ready` and
 * `refreshing`. Within it: plugin absent → the strip says "WP Rocket not
 * detected" and the cards still render; headers not captured → the Server /
 * Known Platform cards are omitted; a RUCSS test applied on the page → the
 * TEST MODE notice above the strip, once. The full header inventory lives on the
 * Headers & Cookies page. A refresh swaps data only: cards are keyed by their
 * id, so their DOM and focus survive.
 *
 * The control row's status filter (All optimizations / Active / Inactive,
 * page-local, default All) narrows only the optimization cards — page-context
 * cards stay under every filter — while the strip and `Copy report` keep
 * reading the full page. A refresh keeps the selection; a selected bucket a
 * refresh emptied stays selected and says so, with the way back to All.
 *
 * Card rendering is registry-driven — the view model's rows are the card
 * set and the page-local link table decides which become links — so a new
 * detection row is a new card with no page edit.
 */
import type { JSX } from 'solid-js';
import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
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
import { useFdtData } from '../../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from '../../status-bar/aging-clock';
import { NoMatches, PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { TestModeNotice } from '../test-mode-notice';
import { CARD_PAGE_LINKS } from './card-presentation';
import { CopyReportButton } from './copy-report-button';
import { StatusCard } from './status-card';
import { SummaryStrip } from './summary-strip';

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
      <SummaryStrip summary={summary()} />
      {/* The page's control row: the status filter now, room for more controls at its end.
          Always mounted, chips included: the All chip is never disabled, so it is the
          filtered-empty reset's focus target even on a payload with no optimization card
          (the chips then honestly read 0). */}
      <div
        ref={controls}
        data-fdt="detections-controls"
        class="flex flex-wrap items-center justify-between gap-2"
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
      </div>
      <Show when={filteredEmpty()}>
        <div data-fdt="detections-filtered-empty">
          <NoMatches
            chipLabel={detectionFilterLabel(filter())}
            onShowAll={() => setFilter('all')}
            showAllLabel={SHOW_ALL_OPTIMIZATIONS}
            focusAfter={() => controls?.querySelector<HTMLElement>('[data-fdt-filter-chip="all"]')}
          />
        </div>
      </Show>
      <ul data-fdt="detections-grid" aria-label="Detection results" class={DETECTIONS_GRID}>
        <For each={ids()}>
          {(id) => (
            <Show when={byId().get(id)}>
              {(item) => (
                <li class="flex min-w-0">
                  <StatusCard item={item()} linkTo={CARD_PAGE_LINKS.get(id)} now={props.now} />
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
        />
      )}
    </Show>
  );
}
