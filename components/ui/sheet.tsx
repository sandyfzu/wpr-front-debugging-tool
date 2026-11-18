/**
 * The bottom sheet — a modal surface anchored to the bottom edge (the
 * compact list pages' Filters sheet), built on {@link ModalDialog}, so it
 * keeps every dialog seam: focus trap, Escape and scrim dismissal (one
 * guarded close), the title as its accessible name.
 *
 * Unlike the mount-driven dialog, the sheet is driven by its `open` flag and
 * stays mounted for its exit motion (see `sheet-presence.ts`): the exit is a
 * class-driven transition, and a timer of its computed end — not a
 * transition event — unmounts it, so the global reduced-motion collapse (a
 * near-zero duration) closes it at once and nothing can strand it on screen.
 * The dialog runs controlled (`open` while mounted): a dismissal is only a
 * request to the caller, never the library unmounting the panel itself (it
 * would, at once, with no keyframe animation running — before the exit or
 * the restore could happen). A caller that ignores the request keeps the
 * sheet visibly open, and the next gesture asks again.
 *
 * The sheet owns focus restore (the dialog leaves it to callers): when the
 * close leaves focus lost (inside the closing sheet, or on the body) it focuses
 * {@link SheetProps.restoreFocusTo}; focus already outside the sheet (a
 * top-layer surface the trap lets through) is left alone, and a missing,
 * disconnected or unfocusable target
 * leaves focus where it is (no throw, no jump to an arbitrary control).
 *
 * Layout: full width, rounded top, a height clamp below the viewport (the
 * scrim strip above stays pressable to dismiss) and one inner scroller, so a
 * short docked panel scrolls the content while a sticky footer keeps its
 * primary action in view.
 */
import type { JSX } from 'solid-js';
import { createEffect, createSignal, on, onCleanup, Show, untrack } from 'solid-js';
import { cn } from '../../utils/cn';
import { transitionEndMs } from '../../utils/css-duration';
import { ModalDialog } from './dialog';
import { nextSheetPresence, SHEET_CLOSED, type SheetPresenceEvent } from './sheet-presence';

export interface SheetProps {
  /** Whether the sheet is shown; the caller flips it (to `false` from {@link SheetProps.onClose}). */
  open: boolean;
  /** A dismissal request (Escape, a scrim press) while open; the caller closes by clearing `open`. */
  onClose: () => void;
  /** The sheet's accessible name, also shown as its heading. */
  title: string;
  /** The optional `aria-describedby` line (visually hidden). */
  description?: string;
  /** The element focused once a close finishes (the control that opened the sheet). */
  restoreFocusTo: () => HTMLElement | undefined;
  /** The element focused on open (default: the content's first focusable). */
  initialFocus?: () => HTMLElement | undefined;
  /** Controls at the heading's end (e.g. a reset action). */
  actions?: JSX.Element;
  /** The bottom row pinned in view while the content scrolls (e.g. the apply action). */
  footer?: JSX.Element;
  /** Extra classes on the sheet panel, merged last. */
  class?: string;
  /** The sheet's content (e.g. the facet segments), between the heading and the footer. */
  children: JSX.Element;
}

/**
 * The sheet's geometry over the dialog plate: bottom-anchored full width
 * (the plate's centering undone), rounded top, top border only, and a height
 * clamp that leaves a 1.5rem scrim strip to press.
 */
const SHEET_PANEL_CLASSES =
  'left-0 right-0 top-auto bottom-0 w-auto max-h-[calc(100dvh-1.5rem)] translate-x-0 rounded-none rounded-t-xl border-0 border-t';

/**
 * Panel motion — the floating-chrome moment: slides up from the bottom edge
 * on insertion (`--motion-slow`, entrance easing), back down on close
 * (`--motion-base`, standard easing). `translate` only, never layout.
 */
const PANEL_ENTER =
  'transition-[translate] duration-[var(--motion-slow)] ease-[var(--ease-entrance)] starting:translate-y-full';
const PANEL_EXIT =
  'pointer-events-none translate-y-full transition-[translate] duration-[var(--motion-base)] ease-[var(--ease-standard)]';

/** Scrim motion: fades with the panel, same durations. */
const SCRIM_ENTER =
  'transition-opacity duration-[var(--motion-slow)] ease-[var(--ease-entrance)] starting:opacity-0';
const SCRIM_EXIT =
  'pointer-events-none opacity-0 transition-opacity duration-[var(--motion-base)] ease-[var(--ease-standard)]';

/**
 * The exit's length: the panel's computed transition end (its exit classes
 * are rendered by now; the scrim's exit shares the token), so the
 * reduced-motion collapse and any token change reach the timer with no
 * re-typed value.
 *
 * @param panel The sheet's dialog panel (absent → 0, close at once).
 * @returns The exit's length in ms.
 */
function exitDurationMs(panel: HTMLElement | null): number {
  const view = panel?.ownerDocument.defaultView ?? null;
  if (panel === null || view === null) return 0;
  return transitionEndMs(view.getComputedStyle(panel));
}

/**
 * Whether focus would be lost when the sheet unmounts — on the body, nowhere,
 * or inside the sheet. Focus a close already moved elsewhere is the mover's.
 *
 * @param doc The sheet's document.
 * @param panel The sheet's dialog panel as the close began (null when none was mounted).
 * @returns True when the sheet should restore focus.
 */
export function focusWouldBeLost(doc: Document, panel: HTMLElement | null): boolean {
  const active = doc.activeElement;
  return active === null || active === doc.body || (panel?.contains(active) ?? false);
}

/**
 * Focus the restore target when it is still in the document; a missing,
 * disconnected or unfocusable target is a no-op (focus stays where the close
 * left it — never a jump to an unrelated control).
 *
 * @param target The caller's restore target.
 * @returns Whether the target holds focus afterwards.
 */
export function restoreFocus(target: HTMLElement | undefined): boolean {
  if (target === undefined || !target.isConnected) return false;
  target.focus({ preventScroll: true });
  return (target.getRootNode() as Document | ShadowRoot).activeElement === target;
}

/**
 * Render the bottom sheet (always rendered by its caller; shown by `open`).
 *
 * @param props See {@link SheetProps}.
 */
export function Sheet(props: SheetProps): JSX.Element {
  const [presence, setPresence] = createSignal(
    untrack(() => props.open) ? nextSheetPresence(SHEET_CLOSED, 'show') : SHEET_CLOSED
  );
  const send = (event: SheetPresenceEvent): void => {
    setPresence((state) => nextSheetPresence(state, event));
  };
  const closing = (): boolean => presence().phase === 'closing';
  /** The current mount's content root (set per mount, cleared on its unmount). */
  let root: HTMLElement | undefined;
  /** The current mount's dialog panel, or null when none is mounted. */
  const panel = (): HTMLElement | null => root?.closest<HTMLElement>('[data-fdt="dialog"]') ?? null;

  createEffect(
    on(
      () => props.open,
      (open) => {
        send(open ? 'show' : 'hide');
      },
      { defer: true }
    )
  );

  // Entering `closing` (exit classes already rendered): unmount after the
  // exit's computed end. The panel is read once, here, so the restore check
  // still knows it if it vanished early. Re-runs on any presence change, so a
  // reopen or the sheet's own unmount clears a pending timer.
  createEffect(
    on(presence, (state) => {
      if (state.phase !== 'closing') return;
      const closingPanel = panel();
      const timer = setTimeout(() => {
        const restore = focusWouldBeLost(closingPanel?.ownerDocument ?? document, closingPanel);
        send('exited');
        if (restore) restoreFocus(props.restoreFocusTo());
      }, exitDurationMs(closingPanel));
      onCleanup(() => {
        clearTimeout(timer);
      });
    })
  );

  return (
    <Show when={presence().phase === 'closed' ? false : presence().mount} keyed>
      <ModalDialog
        // Controlled: only this sheet's presence unmounts the panel (see the module TSDoc).
        open
        title={props.title}
        description={props.description}
        initialFocus={props.initialFocus}
        onClose={() => {
          // A dismissal seen while the exit plays is the same close again.
          if (!closing()) props.onClose();
        }}
        class={cn(SHEET_PANEL_CLASSES, closing() ? PANEL_EXIT : PANEL_ENTER, props.class)}
        overlayClass={closing() ? SCRIM_EXIT : SCRIM_ENTER}
      >
        <div
          data-fdt="sheet"
          data-state={closing() ? 'closing' : 'open'}
          class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
          ref={(element) => {
            root = element;
            onCleanup(() => {
              if (root === element) root = undefined;
            });
          }}
        >
          <span
            aria-hidden="true"
            data-fdt="sheet-handle"
            class="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-3"
          />
          <div data-fdt="sheet-header" class="flex min-h-6 items-center gap-2 px-4 pt-2">
            {/* The dialog's hidden title names the sheet; this is its visual twin. */}
            <div aria-hidden="true" class="min-w-0 flex-1 truncate text-sm font-semibold">
              {props.title}
            </div>
            {props.actions}
          </div>
          <div
            data-fdt="sheet-body"
            class={cn('px-4 pt-3', props.footer === undefined ? 'pb-4' : 'pb-2')}
          >
            {props.children}
          </div>
          <Show when={props.footer !== undefined}>
            <div data-fdt="sheet-footer" class="sticky bottom-0 bg-surface-2 px-4 pt-2 pb-4">
              {props.footer}
            </div>
          </Show>
        </div>
      </ModalDialog>
    </Show>
  );
}
