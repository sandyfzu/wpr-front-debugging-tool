/**
 * A simulated lane's limits disclosure: "N limits", collapsed by default,
 * opening in place onto the page's limit lines. Local view state only (each
 * mount starts collapsed, and so does each return of lines after none); every
 * simulated lane shares it.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import { SIMULATION_LANE_COPY, type NoteText } from '../copy';
import { NoteRuns } from './note-runs';

/** Props of {@link LaneLimits}. */
interface LaneLimitsProps {
  /** The open list's id (unique in the overlay: the toggle's `aria-controls` target). */
  readonly id: string;
  /** The lane's limit lines, one per limit (see `simulationLaneLimits`). */
  readonly lines: readonly NoteText[];
}

/**
 * The disclosure (nothing without limits). The toggle and its open state
 * mount only while there are lines, so lines that come back after none
 * start collapsed.
 *
 * @param props See {@link LaneLimitsProps}.
 */
export function LaneLimits(props: LaneLimitsProps): JSX.Element {
  return (
    <Show when={props.lines.length > 0}>
      <LimitsToggle id={props.id} lines={props.lines} />
    </Show>
  );
}

/**
 * The toggle and, while open, the list (`props.lines` non-empty).
 *
 * @param props See {@link LaneLimitsProps}.
 */
function LimitsToggle(props: LaneLimitsProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      {/* The open state is styled from `aria-expanded` (fill + the turned
          chevron); the list mounts only while open, so `aria-controls` is
          set only then — it never names a missing id. */}
      <button
        type="button"
        class="xo-button xo-disclosure xo-lane-limits"
        aria-expanded={open()}
        aria-controls={open() ? props.id : undefined}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {SIMULATION_LANE_COPY.limits(props.lines.length)}
        <ChevronDown size={12} class="xo-chevron" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <ul class="xo-lane-limit-list" id={props.id}>
          <For each={props.lines}>
            {(line) => (
              <li class="xo-lane-limit">
                <NoteRuns note={line} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}
