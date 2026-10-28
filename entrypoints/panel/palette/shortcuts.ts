/**
 * The panel's keyboard shortcuts — the single table the shortcuts overlay
 * renders, plus the global document listener behind `Cmd/Ctrl K` and the
 * overlay's own binding (`/`, with `?` kept as an unadvertised alias).
 *
 * The table lists what is real: the palette's keys, this overlay's own, and
 * the DevTools find bar's (Enter/Shift+Enter next-previous, Escape clear),
 * which the panel never sees as raw keys — the search stream arrives through
 * the panel's protocol receiver, so its rows name the DevTools surface that
 * produces them.
 *
 * The palette also answers the user's chosen page-palette chord (the
 * options' rebindable shortcut, Alt+K by default), followed live: the same
 * shared decision the page trigger runs, so a may-type chord types inside
 * fields instead. A chord DevTools itself claims never toggles here: in
 * Chrome, the script DevTools injects into every extension frame (at frame
 * creation, so its document `keydown` listener presumably precedes ours —
 * inferred, not observed) default-prevents and forwards its global chords,
 * and the shared decision
 * passes a handled key, so DevTools acts alone. Chords the browser or
 * DevTools own are refused at capture (the reserved table), so a stored
 * binding rarely meets one.
 *
 * Esc handling is deliberately NOT here: the dialogs dismiss themselves
 * (topmost first — they never stack), and the search-Esc clearing stays the
 * data layer's single rule (the protocol's `cancelSearch`). This listener
 * ignores Escape entirely.
 */
import { createLogger } from '../../../lib/logger';
import {
  chordKeydownAction,
  takesTypedText,
  type ChordBinding
} from '../../../lib/palette-chord/keydown';
import { chordsEqual, formatChord, type PaletteChord } from '../../../lib/storage/palette-chord';
import type { OverlayStore } from './overlays';

const log = createLogger('panel');

/**
 * The shortcuts overlay's own activation — one declaring site: the global
 * listener accepts {@link SHORTCUTS_OVERLAY_BINDING.accepts}, the overlay's
 * table row and the palette row render
 * {@link SHORTCUTS_OVERLAY_BINDING.hint}, so the two can never drift.
 *
 * The advertised hint is **`/`, exactly the typed key** (a bare `event.key`
 * match, so no layout or Shift chord is assumed): it types unshifted on the
 * common layouts and is not one of DevTools' reserved chords — the
 * documented global list binds Settings to `?` and the find bar to
 * `Ctrl/Cmd F`, leaving bare `/` free. `?` stays an accepted *alias* for
 * muscle memory and host contexts that do not claim it, but it is
 * unadvertised: in a DevTools window the `?` Chord is the host's own
 * settings shortcut (owner-observed: `Shift+?` opens DevTools Settings and
 * hides this panel) — advertising it is the copy trap this binding re-owns.
 */
export const SHORTCUTS_OVERLAY_BINDING = {
  /** The advertised key hint, exactly as typed (the copy side of the binding). */
  hint: '/',
  /** The keys the global listener accepts (the hint included; the alias after). */
  accepts: ['/', '?'] as readonly string[]
} as const;

/** One row of the shortcuts overlay. */
export interface ShortcutRow {
  /** The keys as they read on any platform. */
  keys: string;
  /** What the keys do. */
  action: string;
  /** Where they apply (chip copy; absent = the panel itself). */
  context?: string;
  /** The palette's toggle row: its keys also name the chosen chord (see {@link shortcutKeys}). */
  opensPalette?: true;
}

/** The fixed palette toggle as a chord (`mod` is Command on macOS, Ctrl elsewhere). */
const FIXED_PALETTE_CHORD: PaletteChord = Object.freeze({ code: 'KeyK', mod: true });

/**
 * The overlay's rows, in read order. The DevTools rows mirror the browser's
 * own find-bar behavior (the panel's `panelSearch` receiver wires the
 * stream); the appearance cycle has no direct key — it is a palette row.
 */
export const PANEL_SHORTCUTS: readonly ShortcutRow[] = [
  { keys: 'Ctrl / ⌘ K', action: 'Open or close the command palette', opensPalette: true },
  { keys: '↑ ↓', action: 'Highlight the previous / next command', context: 'Command palette' },
  { keys: 'Home / End', action: 'First / last command', context: 'Command palette' },
  { keys: 'Enter', action: 'Run the highlighted command', context: 'Command palette' },
  { keys: 'Tab', action: 'Dismiss the palette', context: 'Command palette' },
  {
    keys: SHORTCUTS_OVERLAY_BINDING.hint,
    action: 'Open or close this list'
  },
  { keys: 'Esc', action: 'Close the palette or this list', context: 'Overlays' },
  {
    keys: 'palette row',
    action: 'Cycle appearance (system → dark → light)',
    context: 'Command palette'
  },
  { keys: 'Ctrl / ⌘ F', action: 'Find in the panel', context: 'DevTools find bar' },
  { keys: 'Enter / Shift+Enter', action: 'Next / previous match', context: 'DevTools find bar' },
  { keys: 'Esc', action: 'Clear the search', context: 'DevTools find bar' }
];

/**
 * A row's keys as the overlay shows them: the palette row adds the chosen
 * chord in the platform's notation ("Ctrl / ⌘ K or ⌥K") once it is known —
 * unless it is the fixed chord itself, which the row already names.
 *
 * @param row An overlay row.
 * @param chosen The live binding, or null while unresolved.
 */
export function shortcutKeys(row: ShortcutRow, chosen: ChordBinding | null): string {
  if (row.opensPalette !== true || chosen === null) return row.keys;
  if (chordsEqual(chosen.chord, FIXED_PALETTE_CHORD)) return row.keys;
  return `${row.keys} or ${formatChord(chosen.chord, chosen.platform)}`;
}

/**
 * Whether the event's target must receive its keystrokes instead of the
 * shell (the palette field, the search inputs, any editable surface).
 *
 * @param target The event target (any EventTarget shape; null = ignore).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Register the shell's global shortcuts.
 *
 * `Ctrl/⌘ K` toggles the palette from anywhere in the panel — including out
 * of the palette's own field. The chosen chord toggles it too, by the shared
 * decision (trusted, unhandled, exact match; a may-type chord is left to
 * typed-text fields); it is checked after `Ctrl/⌘ K`, so a chosen chord
 * equal to it toggles once. The shortcuts overlay answers its declared
 * binding (`/`, `?` alias) on an **unmodified** key: `Ctrl/⌘/Alt + /` are
 * not our chord — the palette branch already requires that exactness, the
 * overlay branch mirrors it. `Shift` is deliberately ungated: the binding is
 * a character (`event.key`), and the glyphs it accepts arrive with Shift
 * legitimately held — the `?` composition, or whatever a layout needs to
 * produce `/` — so the shift flag carries no meaning for this contract. The
 * toggle only fires when the keystroke is not headed for an editable target
 * (typing `/` into the palette field queries it). Both chords
 * preventDefault so the browser's own handler does not race.
 *
 * @param handlers The overlay store (only its toggles are consumed).
 * @param chosenChord The live chosen binding (null while unresolved); absent,
 *   only the fixed chord opens the palette.
 * @returns The stop handle (the shell's cleanup).
 */
export function registerPanelShortcuts(
  handlers: Pick<OverlayStore, 'togglePalette' | 'toggleShortcuts'>,
  chosenChord: () => ChordBinding | null = () => null
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // One listener body carries every chord; a wiring bug in one branch must
    // not skip or break the other (a store toggle cannot throw by contract,
    // so this guard is containment for the impossible, not error handling).
    try {
      if (
        !event.altKey &&
        !event.shiftKey &&
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'k' || event.key === 'K')
      ) {
        event.preventDefault();
        handlers.togglePalette();
        return;
      }
      const chosen = chosenChord();
      if (
        chosen !== null &&
        chordKeydownAction(event, chosen, () => takesTypedText(event.composedPath())) === 'open'
      ) {
        event.preventDefault();
        handlers.togglePalette();
        return;
      }
      if (
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        SHORTCUTS_OVERLAY_BINDING.accepts.includes(event.key) &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        handlers.toggleShortcuts();
      }
    } catch (cause: unknown) {
      log.error('The panel shortcut dispatch failed', {
        key: event.key,
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    }
  };
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
