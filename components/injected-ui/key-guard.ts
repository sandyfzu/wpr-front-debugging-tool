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
 * overlay's own handlers still run and never leak back out (a copy the
 * engine would compose is never sent: the original goes on instead); a
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

/**
 * The fields the overlay's handlers read, carried over from the original when
 * it has them (key, input and clipboard events alike).
 */
const COPIED_FIELDS = [
  'key',
  'code',
  'location',
  'repeat',
  'isComposing',
  'ctrlKey',
  'shiftKey',
  'altKey',
  'metaKey',
  'data',
  'inputType',
  'clipboardData'
] as const;

/**
 * A non-composed copy of an event: a plain `Event` carrying the original's
 * fields as own read-only properties. Plain, because Firefox ignores
 * `composed: false` for constructed `KeyboardEvent`s — a typed copy would
 * escape the shadow root (and loop back into the guard).
 *
 * @param win The window whose `Event` constructor builds the copy.
 * @param event The original.
 * @returns The copy, or null when the engine would compose it anyway.
 */
function copyOf(win: Window & typeof globalThis, event: Event): Event | null {
  const copy = new win.Event(event.type, {
    bubbles: event.bubbles,
    cancelable: event.cancelable,
    composed: false
  });
  if (copy.composed) return null;
  const fields = event as unknown as Record<string, unknown>;
  for (const name of COPIED_FIELDS) {
    if (name in event) Object.defineProperty(copy, name, { value: fields[name] });
  }
  return copy;
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
  /** The copies in flight: if one escapes after all, it is let through, never copied again. */
  const copies = new WeakSet<Event>();
  const guard = (event: Event): void => {
    try {
      if (copies.has(event)) return;
      const path = event.composedPath();
      const host = path.find((node) => node instanceof win.Element && node.localName === hostName);
      const target = path[0];
      // Only events from inside the shadow tree (not aimed at the host itself).
      if (host === undefined || !(target instanceof win.Node) || target === host) return;
      const copy = copyOf(win, event);
      if (copy === null) return;
      copies.add(copy);
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
