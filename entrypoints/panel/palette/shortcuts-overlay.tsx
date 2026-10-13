/**
 * The `?` shortcuts overlay: every shortcut the panel answers, from the
 * shortcuts table (the single source), in the shared modal dialog. It
 * dismisses through Escape, the explicit close control (its own visible
 * affordance — it has no keyboard trigger of its own beyond `?`), and an
 * outside click (it is an overlay over the panel, not a configuration
 * surface) — the dialog primitive owns all three.
 */
import { For, Show, type JSX } from 'solid-js';
import { ModalDialog } from '../../../components/ui/dialog';
import { PANEL_SHORTCUTS } from './shortcuts';

export interface ShortcutsOverlayProps {
  /** The dismissal callback (the caller's close + focus restore). */
  onClose: () => void;
}

/** The keys column: the shared mono chip treatment. */
const KEYS_CLASSES = 'font-mono text-2xs text-fg-primary';

/** One overlay row: keys chip · action, with its context tag when present. */
function ShortcutEntry(props: { row: (typeof PANEL_SHORTCUTS)[number] }): JSX.Element {
  return (
    <div class="flex items-center gap-2.5" data-fdt="shortcut-row">
      <kbd class={KEYS_CLASSES}>{props.row.keys}</kbd>
      <span class="min-w-0 flex-1 text-xs text-fg-secondary">{props.row.action}</span>
      <Show when={props.row.context}>
        {(context) => <span class="shrink-0 text-2xs text-fg-muted">{context()}</span>}
      </Show>
    </div>
  );
}

/**
 * Render the shortcuts overlay (mount-gated: render while the store is open).
 *
 * The rows are definition-like pairs (keys → action, with the surface tag
 * where the surface is not the panel itself). The dialog provides the
 * title/name, the dismissal seams, and the mount autofocus on its close
 * control.
 *
 * @param props.onClose The dismissal callback.
 */
export function ShortcutsOverlay(props: ShortcutsOverlayProps): JSX.Element {
  return (
    <ModalDialog
      onClose={props.onClose}
      title="Keyboard shortcuts"
      description="Every key the panel answers"
      closeButton
      class="top-24 p-4"
    >
      <div class="grid gap-2">
        <For each={PANEL_SHORTCUTS}>{(row) => <ShortcutEntry row={row} />}</For>
      </div>
    </ModalDialog>
  );
}
