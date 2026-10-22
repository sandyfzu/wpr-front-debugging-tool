/**
 * "On this page": every element a lane can exclude, filterable by lane —
 * the keyboard path to picking and the only path to scripts. Hovering or
 * focusing an entry highlights its element on the page (when it renders
 * anything). Always virtualized.
 */
import { createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Plus from 'lucide-solid/icons/plus';
import { VirtualList, type VirtualizerFactory } from '../../../components/ui/virtual-list';
import { LANE_COPY } from '../copy';
import type { PageCandidate } from './page-scan';
import { holdsRow, laneIdentities, LANE_ORDER, type Draft, type LaneKey } from './draft';

/** Seed entry height (px). */
const ENTRY_ESTIMATE_PX = 37;

/** Props of {@link Candidates}. */
export interface CandidatesProps {
  readonly candidates: readonly PageCandidate[];
  readonly draft: Draft;
  readonly locked: boolean;
  /** The virtualizer seam (tests). */
  readonly createVirtualizer?: VirtualizerFactory | undefined;
  /** Add one candidate's row to its lane (or show the row when it is already there). */
  readonly onAdd: (candidate: PageCandidate, alreadyAdded: boolean) => void;
  /** The entry under the pointer or focus (null when none). */
  readonly onHover: (candidate: PageCandidate | null) => void;
}

/**
 * The candidate list.
 *
 * @param props See {@link CandidatesProps}.
 */
export function Candidates(props: CandidatesProps): JSX.Element {
  const [lane, setLane] = createSignal<LaneKey | null>(null);
  const counts = createMemo(() => {
    const byLane = new Map<LaneKey, number>(LANE_ORDER.map((key) => [key, 0]));
    for (const candidate of props.candidates)
      byLane.set(candidate.lane, (byLane.get(candidate.lane) ?? 0) + 1);
    return byLane;
  });
  const visible = createMemo(() => {
    const filter = lane();
    return filter === null
      ? props.candidates
      : props.candidates.filter((candidate) => candidate.lane === filter);
  });
  // What each lane holds as WP Rocket would store it, once per draft change.
  const held = createMemo(
    () => new Map(LANE_ORDER.map((key) => [key, laneIdentities(props.draft, key)]))
  );
  const added = (candidate: PageCandidate): boolean => {
    const identities = held().get(candidate.lane);
    return identities !== undefined && holdsRow(identities, candidate.row);
  };

  return (
    <section class="xo-candidates" aria-labelledby="xo-candidates-title">
      <div class="xo-candidates-head">
        <h2 class="xo-lane-title" id="xo-candidates-title">
          On this page
        </h2>
        <div class="xo-chips" role="group" aria-label="Show elements of">
          <button
            type="button"
            class="xo-chip"
            aria-pressed={lane() === null}
            onClick={() => setLane(null)}
          >
            All <span class="xo-count">{props.candidates.length}</span>
          </button>
          <For each={LANE_ORDER}>
            {(key) => (
              <button
                type="button"
                class="xo-chip"
                aria-pressed={lane() === key}
                onClick={() => setLane(key)}
              >
                {LANE_COPY[key].label} <span class="xo-count">{counts().get(key) ?? 0}</span>
              </button>
            )}
          </For>
        </div>
      </div>
      <Show
        when={visible().length > 0}
        fallback={
          <p class="xo-empty-note">
            {lane() === null
              ? 'Nothing on this page that an exclusion can act on.'
              : `No ${LANE_COPY[lane() ?? 'delayJs'].noun} on this page.`}
          </p>
        }
      >
        <VirtualList
          scrollerRole="list"
          aria-label="Elements on this page"
          count={visible().length}
          estimateSize={() => ENTRY_ESTIMATE_PX}
          getItemKey={(index) => visible()[index]?.key ?? `missing-${String(index)}`}
          overscan={8}
          createVirtualizer={props.createVirtualizer}
          class={visible().length > 6 ? 'xo-scroller xo-scroller-own' : 'xo-scroller'}
        >
          {(item) => (
            <Show when={visible()[item.index]}>
              {(candidate) => (
                <div
                  class="xo-candidate"
                  role="listitem"
                  aria-setsize={visible().length}
                  aria-posinset={item.index + 1}
                  onPointerEnter={() => {
                    props.onHover(candidate());
                  }}
                  onPointerLeave={() => {
                    props.onHover(null);
                  }}
                >
                  <div class="xo-candidate-main">
                    <span class="xo-candidate-subject" title={candidate().row}>
                      {candidate().subject}
                    </span>
                    <span class="xo-candidate-lane">{LANE_COPY[candidate().lane].label}</span>
                  </div>
                  <button
                    type="button"
                    class="xo-candidate-add"
                    data-added={added(candidate())}
                    aria-disabled={props.locked ? 'true' : undefined}
                    // Names start with the visible words ("Add" / "Added").
                    aria-label={
                      added(candidate())
                        ? `Added: ${candidate().subject} is in ${LANE_COPY[candidate().lane].label} — show its row`
                        : `Add ${candidate().subject} to ${LANE_COPY[candidate().lane].label}`
                    }
                    onFocus={() => {
                      props.onHover(candidate());
                    }}
                    onBlur={() => {
                      props.onHover(null);
                    }}
                    onClick={() => {
                      if (!props.locked) props.onAdd(candidate(), added(candidate()));
                    }}
                  >
                    <Show
                      when={added(candidate())}
                      fallback={<Plus size={12} aria-hidden="true" />}
                    >
                      <Check size={12} aria-hidden="true" />
                    </Show>
                    {added(candidate()) ? 'Added' : 'Add'}
                  </button>
                </div>
              )}
            </Show>
          )}
        </VirtualList>
      </Show>
    </section>
  );
}
