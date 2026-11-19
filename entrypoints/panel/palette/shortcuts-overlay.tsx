/**
 * The shortcuts overlay: every shortcut the panel answers, from the
 * shortcuts table (the single source), in the shared modal dialog. It
 * dismisses through Escape, the explicit close control (its own visible
 * affordance — its keyboard trigger is the declared overlay binding, `/`),
 * and an outside click (it is an overlay over the panel, not a configuration
 * surface) — the dialog primitive owns all three.
 */
import { For, Show, type JSX } from 'solid-js';
import { FOCUS_RING, KEY_CHIP } from '../../../components/ui/classes';
import { ModalDialog } from '../../../components/ui/dialog';
import type { ChordBinding } from '../../../lib/palette-chord/keydown';
import { cn } from '../../../utils/cn';
import { PANEL_SHORTCUTS, shortcutKeys, type ShortcutRow } from './shortcuts';

export interface ShortcutsOverlayProps {
  /** The dismissal callback (the caller's close + focus restore). */
  onClose: () => void;
  /** The live chosen palette chord (the palette row names it); null while unresolved. */
  paletteChord: () => ChordBinding | null;
}

/** The keys column: the shared key chip, in the primary tone (the keys are this list's content). */
const KEYS_CLASSES = cn(KEY_CHIP, 'justify-self-start text-fg-primary');

/**
 * The plate: lower than the dialog's default top (it clears the top bar's
 * controls), its height cap following that offset — 6 rem down, 1 rem kept
 * free below — so a short panel never pushes its bottom off-screen.
 */
const PLATE_CLASSES = 'top-24 max-h-[calc(100dvh-7rem)] w-[min(34rem,calc(100%-1.5rem))] gap-3 p-4';

/**
 * The rows' grid: the keys column as wide as its widest chip, the words
 * beside it; rows are subgrid rows, so every row's words start on one line.
 * It is the rows' container too: one tier decides where every context tag
 * sits, so the tags never mix beside and under within one list.
 *
 * It is also the plate's one scroller: it shrinks (`min-h-0`) when the
 * clamped plate runs short, so the title and close control stay put while
 * the rows scroll; `pe-1` keeps a painted scrollbar off the words. The rows
 * hold nothing focusable, so the scroller itself is a tab stop (keyboard
 * scrolling) with the shared focus ring.
 */
const ROWS_CLASSES = cn(
  '@container grid min-h-0 grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-2 overflow-y-auto overscroll-contain pe-1',
  FOCUS_RING
);

/** A row's words: the context tag under the action when compact, beside it from the regular tier. */
const WORDS_CLASSES =
  'flex min-w-0 flex-col @regular:flex-row @regular:items-baseline @regular:justify-between @regular:gap-x-2';

/**
 * One overlay row: keys chip · action, with its context tag when present
 * (under the action on a compact plate, beside it from the regular tier).
 *
 * @param props.row The table row.
 * @param props.paletteChord The live chosen chord (the palette row's keys follow it).
 */
function ShortcutEntry(props: {
  row: ShortcutRow;
  paletteChord: () => ChordBinding | null;
}): JSX.Element {
  return (
    <div class="col-span-2 grid grid-cols-subgrid items-baseline" data-fdt="shortcut-row">
      <kbd class={KEYS_CLASSES}>{shortcutKeys(props.row, props.paletteChord())}</kbd>
      <div class={WORDS_CLASSES}>
        <span class="min-w-0 text-xs text-fg-secondary">{props.row.action}</span>
        <Show when={props.row.context}>
          {(context) => <span class="shrink-0 text-2xs text-fg-muted">{context()}</span>}
        </Show>
      </div>
    </div>
  );
}

/**
 * Render the shortcuts overlay (mount-gated: render while the store is open).
 *
 * The rows are definition-like pairs (keys → action, with the surface tag
 * where the surface is not the panel itself) under the dialog's visible
 * title; on a short plate only the rows scroll. The dialog provides the
 * title/name, the dismissal seams, and the mount autofocus on its close
 * control (the first focusable — the rows' scroller comes after it).
 *
 * @param props.onClose The dismissal callback.
 * @param props.paletteChord The live chosen palette chord.
 */
export function ShortcutsOverlay(props: ShortcutsOverlayProps): JSX.Element {
  return (
    <ModalDialog
      onClose={props.onClose}
      title="Keyboard shortcuts"
      description="Every key the panel answers"
      variant="panel"
      showTitle
      closeButton
      class={PLATE_CLASSES}
    >
      <div class={ROWS_CLASSES} data-fdt="shortcut-rows" tabindex="0">
        <For each={PANEL_SHORTCUTS}>
          {(row) => <ShortcutEntry row={row} paletteChord={props.paletteChord} />}
        </For>
      </div>
    </ModalDialog>
  );
}
