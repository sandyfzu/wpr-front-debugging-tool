/**
 * A lane's copy-all control: copies the lane's exclusions as WP Rocket
 * stores them, in the form it takes them (`exclusionCopyText`: the settings
 * field's lines, or the `rocket_lrc_exclusions` filter where there is no
 * field), in list order, blank rows left out. The lane is committed first,
 * so a row still being typed is copied in its stored form; while a long
 * paste lands it copies nothing and says why (held).
 * States: idle · copying (busy, repeat clicks ignored) · copied (check +
 * "Copied" for the shared flash window — the accessible name says "Copied"
 * too — announced with the count) · failed (announced, plus an inline line
 * with the way forward) · explained (an empty lane's control was
 * activated: focusable but inert,
 * `aria-disabled`, it announces and shows why nothing was copied). The
 * failed and explained lines last until
 * the next attempt or a change to the lane's rows.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, Show, type JSX } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import Copy from 'lucide-solid/icons/copy';
import CircleAlert from 'lucide-solid/icons/circle-alert';
import Info from 'lucide-solid/icons/info';
import { COPIED_FLASH_MS } from '../../../components/ui/copy-flash';
import { exclusionCopyText } from '../../../lib/exclusion-builder/copy-form';
import type { ClipboardWrite, ClipboardWriter } from '../clipboard';
import { COPY_ALL_COPY, LANE_COPY } from '../copy';
import { laneFeature, nonBlankRows, type LaneKey } from './draft';

/** Props of {@link CopyAll}. */
export interface CopyAllProps {
  readonly lane: LaneKey;
  /** The lane's rows (blank ones included; stored once committed). */
  readonly rows: readonly string[];
  /**
   * Commit the lane's rows before copying (a row still being typed — the
   * control was activated without focus leaving it — is copied stored).
   */
  readonly commit: () => void;
  /**
   * A long paste is landing: the lane's rows are not what will be stored
   * yet, so nothing is copied (the control says why through `onHeld`).
   */
  readonly held: boolean;
  /** Say why a held control did nothing. */
  readonly onHeld: () => void;
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
  // The lane's rows are WP Rocket's stored form (blank ones are unfinished edits).
  const stored = createMemo(() => nonBlankRows(props.rows));
  const text = createMemo(() => exclusionCopyText(laneFeature(props.lane).id, stored()));
  const count = (): number => stored().length;
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
    if (props.held) {
      props.onHeld();
      return;
    }
    clearTimeout(flash);
    // The rows update synchronously: what follows reads the stored form.
    props.commit();
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
      props.announce(COPY_ALL_COPY.copied(copied, LANE_COPY[props.lane].copiedAs));
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
        aria-disabled={empty() || props.held ? 'true' : undefined}
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
