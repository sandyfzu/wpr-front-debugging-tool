/**
 * The overlay's note disclosure: a compact "N <things>" toggle, collapsed by
 * default, opening in place onto one line per note — a simulated lane's
 * limits, a banner's session notes. Local view state only: each mount starts
 * collapsed, and so does each return of lines after none.
 */
import { createSignal, For, Show, type JSX } from 'solid-js';
import ChevronDown from 'lucide-solid/icons/chevron-down';
import type { NoteText } from './copy';
import { NoteRuns } from './exclusions/note-runs';

/** Props of {@link NoteDisclosure}. */
export interface NoteDisclosureProps {
  /** The open list's id (unique in the overlay: the toggle's `aria-controls` target). */
  readonly id: string;
  /** The notes, one line each. */
  readonly lines: readonly NoteText[];
  /**
   * The toggle's words for a count of notes ("2 limits", "1 session note").
   *
   * @param count Notes behind it (≥ 1).
   */
  readonly label: (count: number) => string;
}

/**
 * The disclosure (nothing without lines). The toggle and its open state
 * mount only while there are lines, so lines that come back after none
 * start collapsed.
 *
 * @param props See {@link NoteDisclosureProps}.
 */
export function NoteDisclosure(props: NoteDisclosureProps): JSX.Element {
  return (
    <Show when={props.lines.length > 0}>
      <DisclosureToggle {...props} />
    </Show>
  );
}

/**
 * The toggle and, while open, the list (`props.lines` non-empty).
 *
 * @param props See {@link NoteDisclosureProps}.
 */
function DisclosureToggle(props: NoteDisclosureProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      {/* The open state is styled from `aria-expanded` (fill + the turned
          chevron); the list mounts only while open, so `aria-controls` is
          set only then — it never names a missing id. */}
      <button
        type="button"
        class="xo-button xo-disclosure xo-note-disclosure"
        aria-expanded={open()}
        aria-controls={open() ? props.id : undefined}
        onClick={() => setOpen((isOpen) => !isOpen)}
      >
        {props.label(props.lines.length)}
        <ChevronDown size={12} class="xo-chevron" aria-hidden="true" />
      </button>
      <Show when={open()}>
        <ul class="xo-note-disclosure-list" id={props.id}>
          <For each={props.lines}>
            {(line) => (
              <li class="xo-note-disclosure-item">
                <NoteRuns note={line} />
              </li>
            )}
          </For>
        </ul>
      </Show>
    </>
  );
}
