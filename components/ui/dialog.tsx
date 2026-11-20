/**
 * The modal dialog — the overlay surface shell-level keyboard features render
 * into (the command palette, the shortcuts overlay, and any later modal).
 *
 * Wraps Kobalte's APG dialog: modal = focus trapped inside the content (the
 * outside is pointer-inert and `aria-hidden`), `role="dialog"` titled via the
 * required title, Escape and outside-pointerdown dismissed, and mount-time
 * autofocus on the content's first focusable element (or, in the mount task,
 * the caller's {@link ModalDialogProps.initialFocus}) — so callers keep
 * their first tab stop meaningful (the palette's field, the overlay's close
 * control).
 *
 * The dialog is mount-driven: callers render it inside a `<Show>` while open
 * and react to {@link ModalDialogProps.onClose} by unmounting — which makes
 * every open a fresh surface (autofocus runs per open, transient state never
 * outlives a close). A caller that must outlive the dismissal (an exit
 * motion) passes {@link ModalDialogProps.open}: the dialog then only reports
 * each dismissal request and stays mounted until the caller unmounts it.
 *
 * The scrim is the dialog's outside, and a press on it dismisses at once:
 * the library arms its outside-pointer listener a task after mount, and the
 * browser runs input ahead of timers, so a press in that gap (a quick click,
 * or any click while a busy host page holds the timer back) would otherwise
 * be ignored. A modal dialog ignores a context-menu press there (as the
 * library does outside it); a mounted one dismisses on it (as the library
 * does there too). Every seam the dialog owns (Escape, the scrim, the
 * library's outside checks, the close control) funnels into one guard, so a
 * press two of them see closes once; exits the caller wires itself (a key in
 * {@link ModalDialogProps.onKeyDownCapture}, its own Cancel) call its own
 * handler directly — no dialog seam sees those gestures too.
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
import { isMacPlatform } from '../../utils/platform';
import { FOCUS_RING } from './classes';

export interface ModalDialogProps {
  /**
   * Called when the dialog is dismissed (Escape, an outside pointer, the
   * close control): once per mount, or once per gesture when {@link open}
   * is set.
   */
  onClose: () => void;
  /**
   * Controlled mode: the library's open state, held by the caller. Left
   * undefined (every existing surface), the library closes itself on a
   * dismissal — its presence unmounts the content at once when no keyframe
   * animation runs, before `onClose` fires. Set (`true` while mounted), a
   * dismissal is only a request: nothing unmounts until the caller does, so
   * a class-driven exit can play on the live panel, and the guard re-arms
   * after each gesture's task (the dialog stays up for the next request).
   */
  open?: boolean;
  /**
   * A keydown handler on the panel's capture phase — it runs before the
   * content's own listeners (including composed components the wrapper
   * cannot intercept), so a surface can intercept keys the innards would
   * swallow (the palette's Tab = dismiss). Must call its own preventDefault
   * / stopPropagation decisions per key.
   */
  onKeyDownCapture?: (event: KeyboardEvent) => void;
  /** The `aria-labelledby` heading (visually hidden unless {@link showTitle}). */
  title: string;
  /** The optional `aria-describedby` line under the title. */
  description?: string;
  /**
   * Render the explicit close control (mouse users' dismissal for surfaces
   * with no visible trigger affordance; default off).
   */
  closeButton?: boolean;
  /**
   * The look (default `default`, today's). `panel` — the devtools panel's
   * overlays only: the close control on the control corner, a step larger,
   * set into the plate's padding beside a visible title. Opt-in so an
   * injected UI's dialog keeps its look.
   */
  variant?: ModalDialogVariant;
  /**
   * Render the title visibly, as the plate's heading (default false: the
   * title only names the dialog for assistive tech — devtools-grade overlays
   * present their own fields and lists).
   */
  showTitle?: boolean;
  /** Extra classes on the dialog panel, merged last so callers win. */
  class?: string;
  /** Extra classes on the scrim, merged last so callers win (a variant's own motion). */
  overlayClass?: string;
  /**
   * Render into this node instead of the document body (an injected UI's
   * shadow-root container) — mounted mode, see the module TSDoc.
   */
  mount?: HTMLElement;
  /**
   * The element focused as the dialog mounts — in a microtask of the same
   * task as its insertion, where the library's own autofocus waits a task
   * (any frame or timer callback in that gap would see focus unclaimed and
   * could take it, which a mounted dialog then reads as an outside focus and
   * dismisses on). The microtask runs after the modal focus trap is armed, so
   * the trap records the target and pulls later outside focus moves back to
   * it. Read once, at mount: when it is missing or detached, the library's
   * deferred autofocus on the first focusable runs instead; when it refuses
   * focus, the dialog panel takes it (focus stays inside the dialog).
   */
  initialFocus?: () => HTMLElement | undefined;
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

/** The dialog's looks (see {@link ModalDialogProps.variant}). */
export type ModalDialogVariant = 'default' | 'panel';

/**
 * What a look styles — class strings for the dialog's own chrome; the plate
 * ({@link DIALOG_PANEL_CLASSES}) is shared by every look and callers extend
 * it through {@link ModalDialogProps.class}.
 */
interface DialogLook {
  /**
   * The explicit close control (rendered with {@link ModalDialogProps.closeButton}):
   * its corner position, square size, radius and pointer feedback. The
   * shared focus ring is merged on top, never repeated here.
   */
  readonly close: string;
  /**
   * The title's type when {@link ModalDialogProps.showTitle} renders it
   * visibly (otherwise it is `sr-only` in every look); end padding, where
   * set, keeps a long title clear of the close control.
   */
  readonly title: string;
}

/**
 * Every look — adding one is one row here. `default` is the shipped look
 * (injected UIs rely on it); `panel` is the devtools panel's.
 */
export const DIALOG_LOOKS: Readonly<Record<ModalDialogVariant, DialogLook>> = {
  default: {
    close:
      'absolute end-1.5 top-1.5 inline-grid size-6 place-items-center rounded text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
    title: 'text-sm font-semibold text-fg-primary'
  },
  panel: {
    close:
      'absolute end-2.5 top-2.5 inline-grid size-7 place-items-center rounded-control text-fg-muted hover:bg-surface-3 hover:text-fg-primary',
    title: 'pe-8 text-sm font-semibold text-fg-primary'
  }
};

/** The scrim: above the shell (z-40); the plate (z-50), tooltips (z-50) and the toasts' region (z-[60]) rank above it. */
const OVERLAY_CLASSES = 'fixed inset-0 z-40 bg-[var(--scrim)]';

/**
 * Focus the caller's initial target, or the dialog panel when the target
 * refuses focus (hidden, disabled, inert) — the library's autofocus is
 * already prevented by then, and the panel (`tabindex=-1`, the library's own
 * last resort) keeps focus inside the dialog: the modal trap records it and a
 * mounted dialog does not read the miss as an outside focus.
 *
 * @param target The caller's initial focus element.
 * @param panel The dialog panel (the fallback).
 */
function focusInitial(target: HTMLElement, panel: HTMLElement): void {
  target.focus({ preventScroll: true });
  const root = target.getRootNode() as Document | ShadowRoot;
  if (root.activeElement !== target) panel.focus({ preventScroll: true });
}

/** The button and modifier facts of a press (a pointer event, or a test double). */
export interface PressFacts {
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Whether a press opens the context menu — the secondary button, or a primary
 * press with the platform's Ctrl alone (Cmd without Ctrl on macOS, Ctrl
 * without Meta elsewhere): the presses a modal dialog's outside dismissal
 * ignores, the same set the library ignores.
 *
 * @param press The press's button and modifiers.
 * @param mac Whether the platform is macOS.
 */
export function isContextMenuPress(press: PressFacts, mac: boolean): boolean {
  const ctrl = mac ? press.metaKey && !press.ctrlKey : press.ctrlKey && !press.metaKey;
  return press.button === 2 || (ctrl && press.button === 0);
}

/**
 * Dismiss on a press on the scrim — mouse and pen on `pointerdown` (the
 * library's own moment), touch on the tap's `click` (a tap dismissed on its
 * pointerdown would let its click land on the page below the scrim). A
 * modal dialog ignores a context-menu press, judged on its `pointerdown`
 * (a touch one too), so a Cmd-click's own `click` never dismisses either.
 * Native listeners on the element itself, so the seam works under any
 * delegation setup: a mounted dialog's events stop at its shadow root, where
 * Solid handlers run only because the injected UI's isolation re-delegates
 * them there.
 *
 * @param scrim The dialog's scrim.
 * @param modal Whether the dialog is modal (context-menu presses ignored).
 * @param dismiss The dialog's guarded dismissal.
 * @returns Removes the listeners.
 */
function dismissOnScrimPress(scrim: HTMLElement, modal: boolean, dismiss: () => void): () => void {
  /** Set by a dismissing touch `pointerdown`: its tap's `click` dismisses. */
  let tapPending = false;
  const onPointerDown = (event: PointerEvent): void => {
    const dismissing = !(modal && isContextMenuPress(event, isMacPlatform(globalThis.navigator)));
    const touch = event.pointerType === 'touch';
    tapPending = touch && dismissing;
    if (!touch && dismissing) dismiss();
  };
  const onClick = (): void => {
    if (!tapPending) return;
    tapPending = false;
    dismiss();
  };
  scrim.addEventListener('pointerdown', onPointerDown);
  scrim.addEventListener('click', onClick);
  return () => {
    scrim.removeEventListener('pointerdown', onPointerDown);
    scrim.removeEventListener('click', onClick);
  };
}

/**
 * Render the modal dialog (mount-driven — render inside a `<Show>` while open).
 *
 * The title is visually hidden unless {@link ModalDialogProps.showTitle}:
 * devtools-grade overlays present their own fields/lists, not a heading
 * block — assistive tech still names the dialog.
 *
 * @param props.onClose The dismissal callback (Escape / outside pointer / the
 *   optional close button).
 * @param props.open Controlled mode's open state (optional; see the prop).
 * @param props.title The dialog's accessible name (visually hidden).
 * @param props.description The accessible description (optional, hidden).
 * @param props.closeButton Whether the explicit dismissal control renders.
 * @param props.variant The look (default `default`).
 * @param props.showTitle Whether the title renders visibly (default false).
 * @param props.class Extra classes on the panel.
 * @param props.overlayClass Extra classes on the scrim.
 * @param props.mount The injected UI's render node (mounted mode).
 * @param props.initialFocus The element focused on mount, same task (optional).
 * @param props.children The dialog's content (fields, lists, texts).
 */
export function ModalDialog(props: ModalDialogProps): JSX.Element {
  // Mounted (injected) dialogs never write into the host document. Read once:
  // the root and the scrim must agree, and the mount never changes per mount.
  // eslint-disable-next-line solid/reactivity -- a mount-time read by design
  const modal = props.mount === undefined;
  // eslint-disable-next-line solid/reactivity -- a look is fixed per mount
  const look = DIALOG_LOOKS[props.variant ?? 'default'];
  /** Set by a dismissal: later seams of the same press (one press seen twice) are no-ops. */
  let dismissed = false;
  /** Controlled mode's re-arm timer (pending while a gesture's task runs). */
  let rearm: ReturnType<typeof setTimeout> | undefined;
  const dismiss = (): void => {
    if (dismissed) return;
    dismissed = true;
    // Every seam of one gesture fires within its task (mouse/pen pointerdown,
    // a tap's click, a keydown), so a task later the next gesture is a new
    // request — only while the caller keeps the dialog up (controlled).
    if (props.open !== undefined) {
      rearm = setTimeout(() => {
        dismissed = false;
      }, 0);
    }
    props.onClose();
  };
  onCleanup(() => {
    clearTimeout(rearm);
  });
  return (
    <KobalteDialog.Root
      modal={modal}
      // Mount-driven: the caller renders the dialog only while it is open, so
      // it starts open on every mount (a fresh surface per open) and its only
      // transitions are the dismissals funneled into one branch below.
      // `open` undefined leaves the library uncontrolled (defaultOpen rules).
      defaultOpen
      open={props.open}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <KobalteDialog.Portal mount={props.mount}>
        <KobalteDialog.Overlay
          data-fdt="dialog-overlay"
          class={cn(OVERLAY_CLASSES, props.overlayClass)}
          ref={(element) => {
            onCleanup(dismissOnScrimPress(element, modal, dismiss));
          }}
        />
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
                dismiss();
                return;
              }
              capture?.(event);
            };
            element.addEventListener('keydown', onKeyDown, true);
            onCleanup(() => {
              element.removeEventListener('keydown', onKeyDown, true);
            });
          }}
          onOpenAutoFocus={(event) => {
            const target = props.initialFocus?.();
            if (target === undefined || !target.isConnected) return;
            event.preventDefault();
            const panel = event.currentTarget as HTMLElement;
            queueMicrotask(() => {
              focusInitial(target, panel);
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
          <KobalteDialog.Title
            data-fdt="dialog-title"
            class={props.showTitle === true ? look.title : 'sr-only'}
          >
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
              class={cn(look.close, FOCUS_RING)}
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
