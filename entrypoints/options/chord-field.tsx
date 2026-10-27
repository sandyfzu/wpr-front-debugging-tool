/**
 * The press-a-combination field for the palette shortcut — a toggle button
 * that records the next combination while pressed.
 *
 * States: **idle** (shows the bound chord in platform notation) →
 * activate (click, Enter or Space) → **recording** (`aria-pressed`, the prompt
 * announced). While recording, keydowns are classified by the pure capture
 * rules: a valid combination is handed to `onCapture` and recording ends; a
 * refused one stays recording and announces why (live region, polite);
 * Escape cancels; Tab passes through and leaving the field (blur) cancels;
 * lone modifiers, auto-repeats and IME keystrokes keep waiting. A pointer
 * click while recording cancels too, and so does the field turning disabled
 * (the gate switched off elsewhere). Re-pressing the bound chord ends with
 * the cancel line — nothing to write. Nothing outside the field ever listens.
 *
 * Accessible name: the row label plus the bound chord in words (glyphs are
 * read poorly). The button's visible content is the bound chord in every
 * state (the chord stays bound until a capture replaces it), so the visible
 * text is always part of the name (WCAG 2.5.3) and the name never changes.
 * Recording shows as the pressed state (accent ring) and the prompt in the
 * visible live region under the field — the one announcement recording
 * makes besides the pressed state.
 */
import type { JSX } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';
import { Button } from '../../components/ui/button';
import { cn } from '../../utils/cn';
import {
  CAPTURE_CANCELLED,
  capturePrompt,
  captureRejectionMessage,
  classifyCaptureKey
} from '../../lib/options/chord-capture';
import { chordsEqual, formatChord, type PaletteChord } from '../../lib/storage/palette-chord';
import type { ChordPlatform } from '../../lib/storage/palette-chord-platform';

/** The field's inputs. */
export interface ChordFieldProps {
  /** Prefix for the field's element ids (the row id). */
  idBase: string;
  /** The row label (the field's accessible name leads with it). */
  label: string;
  /** Space-separated ids describing the field (description, notes, caveat). */
  describedBy: string;
  /** The bound chord. */
  chord: PaletteChord;
  /** The keyboard convention notation and capture follow. */
  platform: ChordPlatform;
  /** The key legend for a chord (layout-true when the layout is known). */
  legend: (chord: PaletteChord) => string;
  /** Held by the on-page UI gate (the row renders the reason). */
  disabled: boolean;
  /** A write of the shortcut is in flight. */
  busy: boolean;
  /** Receives a valid captured chord (the instant write). */
  onCapture: (chord: PaletteChord) => void;
  /** Recording starts — the moment to refresh the layout legends. */
  onRecordStart?: () => void;
}

/**
 * Render the shortcut field.
 *
 * @param props See {@link ChordFieldProps}.
 */
export function ChordField(props: ChordFieldProps): JSX.Element {
  const [recording, setRecording] = createSignal(false);
  const [announcement, setAnnouncement] = createSignal('');

  const shown = (chord: PaletteChord, notation: 'symbols' | 'words'): string =>
    formatChord(chord, props.platform, notation, props.legend(chord));

  /** Enter recording, announcing the prompt. */
  const start = (): void => {
    setRecording(true);
    setAnnouncement(capturePrompt(props.platform));
    props.onRecordStart?.();
  };

  /**
   * Leave recording.
   *
   * @param message What to announce (the cancel line, or nothing).
   */
  const stop = (message: string): void => {
    setRecording(false);
    setAnnouncement(message);
  };

  // A field disabled mid-recording (the gate turned off elsewhere, a late
  // gate read) can no longer capture: stop, never leave a dead recording.
  createEffect(() => {
    if (props.disabled && recording()) stop(CAPTURE_CANCELLED);
  });

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!recording()) return;
    const verdict = classifyCaptureKey(event, props.platform);
    if (verdict.kind === 'pass') return; // Focus moves on; blur cancels.
    // Every other recorded keystroke is ours: no activation, no page shortcut.
    event.preventDefault();
    event.stopPropagation();
    switch (verdict.kind) {
      case 'cancel':
        stop(CAPTURE_CANCELLED);
        return;
      case 'wait':
        return;
      case 'captured':
        // The bound chord again: nothing to write, and the user hears so.
        if (chordsEqual(verdict.chord, props.chord)) {
          stop(CAPTURE_CANCELLED);
          return;
        }
        stop('');
        props.onCapture(verdict.chord);
        return;
      case 'rejected':
        setAnnouncement(captureRejectionMessage(verdict, props.platform, props.legend));
        return;
    }
  };

  // Space activates a button on keyup; while recording it is a refused key.
  const onKeyUp = (event: KeyboardEvent): void => {
    if (recording() && event.code === 'Space') event.preventDefault();
  };

  const onClick = (event: MouseEvent): void => {
    if (!recording()) {
      start();
      return;
    }
    // A pointer click while recording cancels; keyboard activation (detail 0)
    // was already handled as a keystroke.
    if (event.detail > 0) stop(CAPTURE_CANCELLED);
  };

  const accessibleName = (): string => `${props.label}: ${shown(props.chord, 'words')}`;

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <Button
        id={`option-${props.idBase}-field`}
        data-fdt="chord-field"
        data-fdt-recording={recording() ? '' : undefined}
        variant="secondary"
        size="sm"
        class={cn(
          'min-w-24 self-start font-mono tabular-nums',
          recording() && 'border-accent ring-1 ring-accent'
        )}
        aria-label={accessibleName()}
        aria-describedby={props.describedBy}
        aria-pressed={recording()}
        disabled={props.disabled}
        // Busy is announced, never a disabled state: disabling the focused
        // field would drop keyboard focus mid-write.
        aria-busy={props.busy || undefined}
        onClick={onClick}
        // Native (non-delegated) listeners: a recorded keystroke must stop at
        // the field, before any document-level shortcut handler sees it.
        on:keydown={onKeyDown}
        on:keyup={onKeyUp}
        onBlur={() => {
          if (recording()) stop('');
        }}
      >
        <kbd class="font-mono">{shown(props.chord, 'symbols')}</kbd>
      </Button>
      {/* The live region, visible: the recording prompt, refusal reasons and
          the cancel line, read politely once each (never per keystroke —
          only verdicts write it). */}
      <p
        id={`option-${props.idBase}-status`}
        role="status"
        class="min-h-4 text-2xs leading-snug text-fg-secondary"
      >
        {announcement()}
      </p>
    </div>
  );
}
