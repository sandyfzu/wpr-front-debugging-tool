/**
 * The Detections page — the panel's overview: a summary strip with the
 * page-level facts, the status card grid (one card per detection plus the
 * serving facts), and the "Response headers" preview; `Copy report` is the
 * page's one primary action.
 *
 * State matrix: the shell owns idle/fetching (skeleton), fetch error (+
 * Retry) and render crashes; this body renders only on `ready` and
 * `refreshing`. Within it: plugin absent → the strip says "WP Rocket not
 * detected" and the cards still render; headers not captured → the Server /
 * Known Platform cards and the headers section are omitted; an empty header
 * capture → the section's one-line empty state. A refresh swaps data only:
 * cards are keyed by their id, so focus, the open disclosure and its scroll
 * survive.
 *
 * Card rendering is registry-driven — the view model's rows are the card
 * set and the page-local link table decides which become links — so a new
 * detection row is a new card with no page edit.
 */
import type { JSX } from 'solid-js';
import { createMemo, For, onCleanup, Show } from 'solid-js';
import { buildStatusItems } from '../../../../lib/panel/detections-view-model';
import { summarizeDetections } from '../../../../lib/panel/detections-summary';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { useFdtData } from '../../state/use-fdt-data';
import { createAgingClock, realAgingClockDeps } from '../../status-bar/aging-clock';
import { PageFrame } from '../page-frame';
import { CARD_PAGE_LINKS } from './card-presentation';
import { CopyReportButton } from './copy-report-button';
import { HeadersPreview } from './headers-preview';
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

/** Props of {@link DetectionsView}. */
export interface DetectionsViewProps {
  /** The loaded page data. */
  data: FdtData;
  /** The page clock reading (epoch ms) relative ages read. */
  now: number;
}

/**
 * The page body over explicit inputs (data + clock) — the testable half;
 * {@link DetectionsPage} wires it to the shell's store and a live clock.
 *
 * @param props See {@link DetectionsViewProps}.
 * @returns The page frame with its sections.
 */
export function DetectionsView(props: DetectionsViewProps): JSX.Element {
  const items = createMemo(() => buildStatusItems(props.data));
  const byId = createMemo(() => new Map(items().map((item) => [item.id, item])));
  // The ids are strings, so `For` keeps each card's DOM across refreshes
  // (a fresh item object per push would otherwise remount every card).
  const ids = createMemo(() => items().map((item) => item.id));
  const summary = createMemo(() => summarizeDetections(items()));

  return (
    <PageFrame
      id="detections"
      title="Detections"
      subtitle={DETECTIONS_SUBTITLE}
      actions={<CopyReportButton data={props.data} />}
    >
      <SummaryStrip summary={summary()} />
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
      <Show when={props.data.pageHeaders}>
        {(headers) => <HeadersPreview headers={headers()} />}
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
    <Show when={data()}>{(loaded) => <DetectionsView data={loaded()} now={clock.now()} />}</Show>
  );
}
