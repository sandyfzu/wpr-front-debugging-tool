/**
 * The bottom sheet's presence machine (pure): when the sheet's dialog is
 * mounted, and when a close has finished its exit motion.
 *
 * `closed` → (show) → `open` → (hide) → `closing` → (exited) → `closed`.
 * The caller's `open` flag is the state; `closing` only keeps the surface
 * mounted while the exit plays, and `exited` comes from a timer (the exit's
 * computed duration), never from a transition event — so a skipped or
 * collapsed transition cannot strand the sheet on screen. A show while
 * closing starts a fresh mount (`mount` + 1): the dialog is mount-driven, so
 * a reused one would keep its spent dismissal guard and its old focus.
 */

/** Where the sheet is in its lifecycle. */
export type SheetPhase = 'closed' | 'open' | 'closing';

/** The machine's state: the phase plus the mount generation (bumped per fresh mount). */
export interface SheetPresence {
  readonly phase: SheetPhase;
  /** The dialog mount's generation: a change remounts the dialog. */
  readonly mount: number;
}

/** `show`/`hide` = the caller's open flag; `exited` = the exit timer fired. */
export type SheetPresenceEvent = 'show' | 'hide' | 'exited';

/** The resting state before any open. */
export const SHEET_CLOSED: SheetPresence = { phase: 'closed', mount: 0 };

/**
 * The next presence for an event; the same object when the event does not
 * apply (a repeated flag, a stale timer), so callers can skip no-op updates.
 *
 * @param state The current presence.
 * @param event What happened.
 * @returns The next presence.
 */
export function nextSheetPresence(state: SheetPresence, event: SheetPresenceEvent): SheetPresence {
  switch (state.phase) {
    case 'closed':
    case 'closing':
      if (event === 'show') return { phase: 'open', mount: state.mount + 1 };
      if (event === 'exited' && state.phase === 'closing')
        return { phase: 'closed', mount: state.mount };
      return state;
    case 'open':
      return event === 'hide' ? { phase: 'closing', mount: state.mount } : state;
  }
}
