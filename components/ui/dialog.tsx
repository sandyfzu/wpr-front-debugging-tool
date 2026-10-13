/**
 * The modal dialog — the overlay surface shell-level keyboard features render
 * into (the command palette, the shortcuts overlay, and any later modal).
 *
 * Wraps Kobalte's APG dialog: modal = focus trapped inside the content (the
 * outside is pointer-inert and `aria-hidden`), `role="dialog"` titled via the
 * required title, Escape and outside-pointerdown dismissed, and mount-time
 * autofocus on the content's first focusable element — so callers keep their
 * first tab stop meaningful (the palette's field, the overlay's close
 * control).
 *
 * The dialog is mount-driven: callers render it inside a `<Show>` while open
 * and react to {@link ModalDialogProps.onClose} by unmounting — which makes
 * every open a fresh surface (autofocus runs per open, transient state never
 * outlives a close).
 *
 * Focus on close is the caller's contract: nothing here remembers what to
 * restore, because only the caller knows its trigger (and a command that
 * navigates elsewhere wants to land focus there instead).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Dialog as KobalteDialog } from '@kobalte/core';
import X from 'lucide-solid/icons/x';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

export interface ModalDialogProps {
  /** Called once when the dialog is dismissed by Escape or an outside pointer. */
  onClose: () => void;
  /** The `aria-labelledby` heading (rendered visually-hidden in the panel). */
  title: string;
  /** The optional `aria-describedby` line under the title. */
  description?: string;
  /**
   * Render the explicit close control (mouse users' dismissal for surfaces
   * with no visible trigger affordance; default off).
   */
  closeButton?: boolean;
  /** Extra classes on the dialog panel, merged last so callers win. */
  class?: string;
  children: JSX.Element;
}

/** The dialog panel: floating, token-surfaced, above its scrim. */
const PANEL_CLASSES =
  'fixed left-1/2 top-16 z-50 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-line-2 bg-surface-2 shadow-elev-3';

/** The scrim: above the shell (z-40) and under both the panel and the toasts. */
const OVERLAY_CLASSES = 'fixed inset-0 z-40 bg-scrim';

/**
 * Render the modal dialog (mount-driven — render inside a `<Show>` while open).
 *
 * The title is visually hidden: devtools-grade overlays present their own
 * fields/lists, not a heading block — assistive tech still names the dialog.
 *
 * @param props.onClose The dismissal callback (Escape / outside pointer / the
 *   optional close button).
 * @param props.title The dialog's accessible name (visually hidden).
 * @param props.description The accessible description (optional, hidden).
 * @param props.closeButton Whether the explicit dismissal control renders.
 * @param props.class Extra classes on the panel.
 * @param props.children The dialog's content (fields, lists, texts).
 */
export function ModalDialog(props: ModalDialogProps): JSX.Element {
  return (
    <KobalteDialog.Root
      modal
      // Mount-driven: the caller renders the dialog only while it is open, so
      // it starts open on every mount (a fresh surface per open) and its only
      // transitions are the dismissals funneled into one branch below.
      defaultOpen
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <KobalteDialog.Portal>
        <KobalteDialog.Overlay data-fdt="dialog-overlay" class={OVERLAY_CLASSES} />
        <KobalteDialog.Content
          data-fdt="dialog"
          class={cn(PANEL_CLASSES, props.class)}
          onCloseAutoFocus={(event) => {
            // No `<Dialog.Trigger>` exists (the caller opens the dialog itself
            // through its own control), so the built-in restore-to-trigger
            // would be a no-op — neutralize it and leave every close's focus
            // decision to the caller, which knows the real target.
            event.preventDefault();
          }}
        >
          <KobalteDialog.Title data-fdt="dialog-title" class="sr-only">
            {props.title}
          </KobalteDialog.Title>
          <Show when={props.description !== undefined}>
            <KobalteDialog.Description data-fdt="dialog-description" class="sr-only">
              {props.description}
            </KobalteDialog.Description>
          </Show>
          <Show when={props.closeButton ?? false}>
            <KobalteDialog.CloseButton
              data-fdt="dialog-close"
              aria-label="Close dialog"
              class={cn(
                'absolute end-1.5 top-1.5 inline-grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
                FOCUS_RING
              )}
            >
              <X size={12} aria-hidden="true" />
            </KobalteDialog.CloseButton>
          </Show>
          {props.children}
        </KobalteDialog.Content>
      </KobalteDialog.Portal>
    </KobalteDialog.Root>
  );
}
