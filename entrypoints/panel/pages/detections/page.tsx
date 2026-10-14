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
      <SummaryStrip summary={summary()} now={props.now} />
      <ul
        data-fdt="detections-grid"
        aria-label="Detection results"
        class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2"
      >
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
