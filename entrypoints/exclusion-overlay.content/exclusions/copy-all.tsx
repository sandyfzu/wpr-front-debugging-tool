/**
 * A lane's copy-all control: copies the lane's exclusions the way WP
 * Rocket's field takes them — one per line, each trimmed, blank rows left
 * out, in list order. States: idle · copying (busy, repeat clicks ignored) ·
 * copied (check + "Copied" for the shared flash window — the accessible name
 * says "Copied" too — announced with the count) · failed (announced, plus
 * an inline line with the way forward) · explained (an empty lane's control
 * was activated: focusable but inert, `aria-disabled`, it announces and
 * shows why nothing was copied). The failed and explained lines last until
 * the next attempt or a change to the lane's rows.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import CircleAlert from 'lucide-solid/icons/circle-alert';
import Info from 'lucide-solid/icons/info';
import { COPIED_FLASH_MS } from '../../../components/ui/copy-flash';
import { exclusionFieldLines, exclusionFieldText } from '../../../lib/exclusion-builder/field-text';
import type { ClipboardWrite, ClipboardWriter } from '../clipboard';
import { COPY_ALL_COPY, LANE_COPY } from '../copy';
import type { LaneKey } from './draft';

/** Props of {@link CopyAll}. */
export interface CopyAllProps {
  readonly lane: LaneKey;
  /** The lane's rows as typed (blank and untrimmed ones included). */
  readonly rows: readonly string[];
  /** Polite announcement in the overlay's live region. */
  readonly announce: (text: string) => void;
  readonly write: ClipboardWriter;
}

/** Where a copy stands. */
type CopyState = 'idle' | 'copying' | 'copied' | 'failed' | 'explained';

/**
 * The copy-all control.
 *
 * @param props See {@link CopyAllProps}.
 */
export function CopyAll(props: CopyAllProps): JSX.Element {
  const [state, setState] = createSignal<CopyState>('idle');
  const text = createMemo(() => exclusionFieldText(props.rows));
  const count = createMemo(() => exclusionFieldLines(props.rows).length);
  const empty = (): boolean => count() === 0;
  const hint = (): string => (empty() ? COPY_ALL_COPY.empty : LANE_COPY[props.lane].copyHint);
  const hintId = (): string => `xo-copy-hint-${props.lane}`;
  const label = (): string => LANE_COPY[props.lane].label;
  let button: HTMLButtonElement | undefined;
  let flash: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(flash);
  });

  // A line about the last attempt goes stale once the lane's rows change.
  createEffect(
    on(
      text,
      () => {
        if (state() === 'failed' || state() === 'explained') setState('idle');
      },
      { defer: true }
    )
  );

  /** One copy: the lane's field text, its outcome announced and shown. */
  const copy = async (): Promise<void> => {
    if (state() === 'copying' || button === undefined) return;
    clearTimeout(flash);
    if (empty()) {
      setState('explained');
      props.announce(COPY_ALL_COPY.empty);
      return;
    }
    const copied = count();
    setState('copying');
    let outcome: ClipboardWrite;
    try {
      outcome = await props.write(text(), button.parentElement ?? button);
    } catch {
      // A writer must not reject; if one does, it is a failed copy all the same.
      outcome = 'failed';
    }
    // Unmounted meanwhile (overlay closed): nothing left to tell or time.
    if (disposed) return;
    if (outcome === 'copied') {
      setState('copied');
      props.announce(COPY_ALL_COPY.copied(copied));
      flash = setTimeout(() => setState('idle'), COPIED_FLASH_MS);
    } else {
      setState('failed');
      props.announce(COPY_ALL_COPY.failed);
    }
  };

  return (
    <>
      <button
        type="button"
        class="xo-button xo-lane-copy"
        data-variant="ghost"
        ref={button}
        aria-label={
          state() === 'copied' ? COPY_ALL_COPY.copiedName(label()) : COPY_ALL_COPY.name(label())
        }
        aria-describedby={hintId()}
        aria-disabled={empty() ? 'true' : undefined}
        aria-busy={state() === 'copying' ? 'true' : undefined}
        title={hint()}
        data-copied={state() === 'copied' ? '' : undefined}
        onClick={() => {
          void copy();
        }}
      >
        <Show when={state() === 'copied'} fallback={<Copy size={14} aria-hidden="true" />}>
          <Check size={14} aria-hidden="true" />
        </Show>
        {state() === 'copied' ? COPY_ALL_COPY.copiedLabel : COPY_ALL_COPY.label}
      </button>
      <span class="xo-sr-only" id={hintId()}>
        {hint()}
      </span>
      <Show when={state() === 'failed'}>
        <p class="xo-row-error xo-copy-line">
          <CircleAlert size={12} aria-hidden="true" />
          <span>{COPY_ALL_COPY.failed}</span>
        </p>
      </Show>
      <Show when={state() === 'explained'}>
        <p class="xo-row-note xo-copy-line">
          <Info size={12} aria-hidden="true" />
          <span>{COPY_ALL_COPY.empty}</span>
        </p>
      </Show>
    </>
  );
}
