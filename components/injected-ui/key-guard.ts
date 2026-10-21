/**
 * Keeps keystrokes typed into the exclusion builder overlay away from the
 * page. Pages register window-capture key handlers (a `/` search shortcut, a
 * hotkey library) that run before any listener inside the overlay can stop
 * them; only a window-capture listener registered *before* the page's own
 * beats them — the isolated content script installs this one at
 * `document_start`.
 *
 * For a key, input or clipboard event whose path runs through the overlay's
 * shadow host, the guard stops the event at the window (no page listener
 * sees it) and re-dispatches a non-composed copy at its target, so the
 * overlay's own handlers still run and never leak back out; a
 * `preventDefault` on the copy is handed to the original (whose default —
 * typing, focus moves — still happens). Anything unexpected fails open: the
 * event goes on untouched, and nothing ever throws into the page.
 */

/** The overlay's shadow host tag name (declared once: the overlay mounts under it). */
export const OVERLAY_HOST_NAME = 'wpr-fdt-exclusion-builder';

/** The events the guard keeps from the page. */
const GUARDED_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'paste',
  'copy',
  'cut'
] as const;

/** Fields every copy shares: bubbles inside the shadow tree, never out of it. */
function base(event: Event): EventInit {
  return { bubbles: event.bubbles, cancelable: event.cancelable, composed: false };
}

/**
 * A non-composed copy of an event, built with the window's own constructors,
 * or null for a kind the guard does not know (then it is left alone).
 *
 * @param win The window whose event constructors build the copy.
 * @param event The original.
 */
function copyOf(win: Window & typeof globalThis, event: Event): Event | null {
  if (event instanceof win.KeyboardEvent) {
    return new win.KeyboardEvent(event.type, {
      ...base(event),
      key: event.key,
      code: event.code,
      location: event.location,
      repeat: event.repeat,
      isComposing: event.isComposing,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });
  }
  if (event instanceof win.InputEvent) {
    return new win.InputEvent(event.type, {
      ...base(event),
      data: event.data,
      inputType: event.inputType,
      isComposing: event.isComposing
    });
  }
  if (event instanceof win.CompositionEvent) {
    return new win.CompositionEvent(event.type, { ...base(event), data: event.data });
  }
  if (typeof win.ClipboardEvent === 'function' && event instanceof win.ClipboardEvent) {
    return new win.ClipboardEvent(event.type, {
      ...base(event),
      clipboardData: event.clipboardData
    });
  }
  return null;
}

/**
 * Install the guard on a window (capture phase), until `signal` aborts.
 *
 * @param win The page's window, as the content script sees it.
 * @param hostName The overlay's shadow host tag name.
 * @param signal Ends the guard (the content script's context).
 */
export function installKeyGuard(
  win: Window & typeof globalThis,
  hostName: string,
  signal: AbortSignal
): void {
  const guard = (event: Event): void => {
    try {
      const path = event.composedPath();
      const host = path.find((node) => node instanceof win.Element && node.localName === hostName);
      const target = path[0];
      // Only events from inside the shadow tree (not aimed at the host itself).
      if (host === undefined || !(target instanceof win.Node) || target === host) return;
      const copy = copyOf(win, event);
      if (copy === null) return;
      event.stopImmediatePropagation();
      target.dispatchEvent(copy);
      if (copy.defaultPrevented) event.preventDefault();
    } catch {
      // Fail open, silently by design: a guard error must neither break the
      // page nor log into its console; the event simply goes on.
    }
  };
  for (const type of GUARDED_EVENTS) {
    win.addEventListener(type, guard, { capture: true, signal });
  }
}
