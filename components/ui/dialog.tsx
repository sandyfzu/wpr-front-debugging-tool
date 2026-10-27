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
 *
 * Mounted mode ({@link ModalDialogProps.mount}) is for UI injected into a
 * host page's shadow root: the dialog renders into the given node, and it is
 * non-modal toward the host document — a modal dialog would `aria-hide`
 * the page's body, lock its scroll and block its pointer events, which are
 * writes into the page being debugged (and would hide the shadow host
 * itself from assistive tech). The surface stays dismissable all the same:
 * an outside pointer or focus move dismisses (the library's outside checks
 * read composed paths, so they see through the shadow root), and Escape is
 * handled on the panel itself, since an injected root keeps its key events
 * from the document listener the library's Escape relies on.
 */
import type { JSX } from 'solid-js';
import { onCleanup, Show } from 'solid-js';
import { Dialog as KobalteDialog } from '@kobalte/core';
import X from 'lucide-solid/icons/x';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';

export interface ModalDialogProps {
  /** Called once when the dialog is dismissed by Escape or an outside pointer. */
  onClose: () => void;
  /**
   * A keydown handler on the panel's capture phase — it runs before the
   * content's own listeners (including composed components the wrapper
   * cannot intercept), so a surface can intercept keys the innards would
   * swallow (the palette's Tab = dismiss). Must call its own preventDefault
   * / stopPropagation decisions per key.
   */
  onKeyDownCapture?: (event: KeyboardEvent) => void;
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
  /**
   * Render into this node instead of the document body (an injected UI's
   * shadow-root container) — mounted mode, see the module TSDoc.
   */
  mount?: HTMLElement;
  children: JSX.Element;
}

/**
 * The dialog panel: floating, token-surfaced, above its scrim. Exported so
 * wrapper surfaces that compose their own content into the same chrome (the
 * command palette) mean one floating-shell shape across the design system.
 *
 * The height clamp (5rem = the top offset plus breathing room): the plate
 * never grows past the viewport, so a short docked-bottom DevTools panel
 * cannot clip the plate's bottom rows — the clamped plate shrinks its
 * scroll-owning content (each surface decides what scrolls inside).
 */
export const DIALOG_PANEL_CLASSES =
  'fixed left-1/2 top-16 z-50 flex max-h-[calc(100dvh-5rem)] w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col rounded-lg border border-line-2 bg-surface-2 shadow-elev-3';

/** The scrim: above the shell (z-40); the plate (z-50), tooltips (z-50) and the toasts' region (z-[60]) rank above it. */
const OVERLAY_CLASSES = 'fixed inset-0 z-40 bg-[var(--scrim)]';

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
 * @param props.mount The injected UI's render node (mounted mode).
 * @param props.children The dialog's content (fields, lists, texts).
 */
export function ModalDialog(props: ModalDialogProps): JSX.Element {
  return (
    <KobalteDialog.Root
      // Mounted (injected) dialogs never write into the host document.
      modal={props.mount === undefined}
      // Mount-driven: the caller renders the dialog only while it is open, so
      // it starts open on every mount (a fresh surface per open) and its only
      // transitions are the dismissals funneled into one branch below.
      defaultOpen
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <KobalteDialog.Portal mount={props.mount}>
        <KobalteDialog.Overlay data-fdt="dialog-overlay" class={OVERLAY_CLASSES} />
        <KobalteDialog.Content
          data-fdt="dialog"
          class={cn(DIALOG_PANEL_CLASSES, props.class)}
          ref={(element) => {
            // The capture-phase keydown hook: an addEventListener-capture
            // binding (a delegated Solid handler could never order itself
            // ahead of the content's own target-phase listeners), released
            // with the surface. Mounted dialogs add their own Escape there.
            const capture = props.onKeyDownCapture;
            const mounted = props.mount !== undefined;
            if (capture === undefined && !mounted) return;
            const onKeyDown = (event: KeyboardEvent): void => {
              if (mounted && event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                props.onClose();
                return;
              }
              capture?.(event);
            };
            element.addEventListener('keydown', onKeyDown, true);
            onCleanup(() => {
              element.removeEventListener('keydown', onKeyDown, true);
            });
          }}
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
