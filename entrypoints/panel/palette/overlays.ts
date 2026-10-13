/**
 * The shell's overlay state — the two overlays (command palette, shortcuts
 * list) never coexist, one restores focus to where the user was, and running
 * a command hands final focus over to that command's own outcome.
 *
 * Focus restoration is eager (the close call focuses right away, while the
 * dismissed surface still exists): a command that navigates refocuses the
 * page heading over it in the same flush, and opening one overlay while
 * another is up captures the *settled* restore point (the shell trigger
 * behind the stack) — both read naturally because the restore already ran.
 */
import { createSignal, type Accessor } from 'solid-js';
import { createLogger } from '../../../lib/logger';

const log = createLogger('panel');

/** An element focus can return to when an overlay closes. */
export interface FocusRestoreTarget {
  focus(options?: FocusOptions): void;
}

export interface OverlayStoreDeps {
  /**
   * The focused element at call time (the panel document's active element in
   * production; tests hand fakes).
   */
  activeElement(): FocusRestoreTarget | null;
}

export interface OverlayStore {
  /** The command palette's open state (the dialog renders inside it). */
  readonly paletteOpen: Accessor<boolean>;
  /** The shortcuts overlay's open state. */
  readonly shortcutsOpen: Accessor<boolean>;
  /** Open the palette (idempotent; a live shortcuts overlay closes first). */
  openPalette(): void;
  /** Open when closed, close when open. */
  togglePalette(): void;
  /** Close the palette and return focus to the element the open captured. */
  closePalette(): void;
  /**
   * Open the shortcuts overlay. The palette (if open) closes first — the
   * "overlay closes before the next" rule — and the resulting restore point
   * becomes the overlay's own (the shell trigger behind both).
   */
  openShortcuts(): void;
  /** Open when closed, close when open. */
  toggleShortcuts(): void;
  /** Close the overlay and restore the captured focus point. */
  closeShortcuts(): void;
  /**
   * Run one palette command's execution after closing its palette: the
   * close's restore puts focus back at the opener, then the run may move it
   * (a route switch lands on the page heading; the shortcuts overlay takes
   * focus as it mounts).
   *
   * @param run The command's execution (its rejections are logged, never
   *   thrown past the invocation — the action rows guard their own failures).
   */
  runCommand(run: () => void | Promise<void>): void;
}

/**
 * The panel document's active element narrowed to the focusable shape (an
 * `instanceof` check, never a blind cast — non-element actives have nothing
 * to restore to).
 */
function documentRestoreTarget(): FocusRestoreTarget | null {
  const element = document.activeElement;
  return element instanceof HTMLElement ? element : null;
}

/**
 * Create the overlay store.
 *
 * @param deps The focused-element seam (defaults to the panel document).
 */
export function createOverlayStore(
  deps: OverlayStoreDeps = { activeElement: documentRestoreTarget }
): OverlayStore {
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [shortcutsOpen, setShortcutsOpen] = createSignal(false);

  /** The element the last palette open captured (the close restores to it). */
  let paletteRestore: FocusRestoreTarget | null = null;
  /** The same, for the shortcuts overlay. */
  let shortcutsRestore: FocusRestoreTarget | null = null;

  /** Shorthand-free close (the object literal reads cleaner without `this`). */
  const closePaletteNow = (): void => {
    if (!paletteOpen()) return;
    setPaletteOpen(false);
    // Restore eagerly: the dismissed surface is still mounted this flush,
    // and a same-flush command run (route switch) may move focus after it.
    paletteRestore?.focus();
    paletteRestore = null;
  };

  /** Shorthand-free close for the shortcuts overlay (same reasoning). */
  const closeShortcutsNow = (): void => {
    if (!shortcutsOpen()) return;
    setShortcutsOpen(false);
    shortcutsRestore?.focus();
    shortcutsRestore = null;
  };

  /** Eager-open the palette (the toggle's half, kept receiver-free). */
  const openPaletteNow = (): void => {
    if (paletteOpen()) return;
    // Only one overlay at a time: the shortcuts surface yields (its own
    // restore runs now, so this open captures the settled trigger).
    if (shortcutsOpen()) {
      setShortcutsOpen(false);
      shortcutsRestore?.focus();
      shortcutsRestore = null;
    }
    paletteRestore = deps.activeElement();
    setPaletteOpen(true);
  };

  /** Eager-open the overlay (the toggle's other half). */
  const openShortcutsNow = (): void => {
    if (shortcutsOpen()) return;
    // The palette closes before the overlay opens, and its restore point
    // (the shell trigger) becomes the overlay's own.
    if (paletteOpen()) closePaletteNow();
    shortcutsRestore = deps.activeElement();
    setShortcutsOpen(true);
  };

  return {
    paletteOpen,
    shortcutsOpen,
    openPalette: openPaletteNow,
    togglePalette() {
      if (paletteOpen()) closePaletteNow();
      else openPaletteNow();
    },
    closePalette: closePaletteNow,
    openShortcuts: openShortcutsNow,
    toggleShortcuts() {
      if (shortcutsOpen()) closeShortcutsNow();
      else openShortcutsNow();
    },
    closeShortcuts: closeShortcutsNow,
    runCommand(run) {
      closePaletteNow();
      void Promise.resolve(run()).catch((cause: unknown) => {
        // The action rows own their failures; a rejection escaping here is a
        // wiring bug — logged with the shared prefix, never a silent swallow.
        log.error('A palette command rejected past its own guarding', {
          cause: cause instanceof Error ? { message: cause.message } : cause
        });
      });
    }
  };
}
