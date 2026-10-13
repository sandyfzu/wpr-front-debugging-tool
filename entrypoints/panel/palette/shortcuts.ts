/**
 * The panel's keyboard shortcuts — the single table the `?` overlay renders,
 * plus the global document listener behind `Cmd/Ctrl K` and `?`.
 *
 * The table lists what is real: the palette's keys, this overlay's own, and
 * the DevTools find bar's (Enter/Shift+Enter next-previous, Escape clear),
 * which the panel never sees as raw keys — the search stream arrives through
 * the panel's protocol receiver, so its rows name the DevTools surface that
 * produces them.
 *
 * Esc handling is deliberately NOT here: the dialogs dismiss themselves
 * (topmost first — they never stack), and the search-Esc clearing stays the
 * data layer's single rule (the protocol's `cancelSearch`). This listener
 * ignores Escape entirely.
 */
import { createLogger } from '../../../lib/logger';
import type { OverlayStore } from './overlays';

const log = createLogger('panel');

/** One row of the shortcuts overlay. */
export interface ShortcutRow {
  /** The keys as they read on any platform. */
  keys: string;
  /** What the keys do. */
  action: string;
  /** Where they apply (chip copy; absent = the panel itself). */
  context?: string;
}

/**
 * The overlay's rows, in read order. The DevTools rows mirror the browser's
 * own find-bar behavior (the panel's `panelSearch` receiver wires the
 * stream); the appearance cycle has no direct key — it is a palette row.
 */
export const PANEL_SHORTCUTS: readonly ShortcutRow[] = [
  { keys: 'Ctrl / ⌘ K', action: 'Open or close the command palette' },
  { keys: '↑ ↓', action: 'Highlight the previous / next command', context: 'Command palette' },
  { keys: 'Home / End', action: 'First / last command', context: 'Command palette' },
  { keys: 'Enter', action: 'Run the highlighted command', context: 'Command palette' },
  { keys: 'Tab', action: 'Dismiss the palette', context: 'Command palette' },
  { keys: '?', action: 'Open or close this list' },
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
 * of the palette's own field. `?` toggles the shortcuts overlay, but only
 * when the keystroke is not headed for an editable target (typing `?` into
 * the palette field queries it). Both keys preventDefault so the browser's
 * own handler does not race.
 *
 * @param handlers The overlay store (only its toggles are consumed).
 * @returns The stop handle (the shell's cleanup).
 */
export function registerPanelShortcuts(
  handlers: Pick<OverlayStore, 'togglePalette' | 'toggleShortcuts'>
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    // One listener body carries both chords; a wiring bug in one branch must
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
      if (event.key === '?' && !isEditableTarget(event.target)) {
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
