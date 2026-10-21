/**
 * Picking on the page without covering it: while active, window-capture
 * listeners follow the pointer (hover → highlight), take the click that
 * picks (cancelled before the page sees it, so a link never navigates and a
 * button never fires) and own Escape and Tab — nothing sits over the page,
 * so wheel and touch scrolling stay native everywhere (app-shell scrollers
 * included). Input aimed at the overlay itself (its shadow host) passes
 * through untouched.
 */

/** What the picker reports. */
export interface PickerEvents<T> {
  /** The pointer moved over a pickable target, or off one (null). */
  readonly hover: (target: T | null) => void;
  /** A click picked `target` — null when nothing pickable was there. */
  readonly pick: (target: T | null, pointed: Element | null) => void;
  /** Escape. */
  readonly cancel: () => void;
  /** Tab or Shift+Tab: focus must stay with the picking controls. */
  readonly tab: (backward: boolean) => void;
}

/** The page seams the picker needs. */
export interface PickerDeps<T> {
  readonly win: Window;
  /** The overlay's shadow host: input aimed at it is the overlay's own. */
  readonly host: Element;
  /** What a viewport point targets, if anything. */
  readonly resolve: (x: number, y: number) => T | null;
  /** The topmost page element at a point (feedback for misses). */
  readonly pointed: (x: number, y: number) => Element | null;
  /** One animation frame (context-owned). */
  readonly requestFrame: (run: () => void) => void;
  /** Ends every listener with the content-script context. */
  readonly signal: AbortSignal;
}

/** Pointer/mouse events a pick must keep from the page (the whole click gesture). */
const SWALLOWED = [
  'pointerdown',
  'mousedown',
  'pointerup',
  'mouseup',
  'auxclick',
  'dblclick',
  'contextmenu'
];

/**
 * Start picking; returns the stop (idempotent).
 *
 * @param deps The page seams.
 * @param events Where outcomes go.
 */
export function startPicking<T>(deps: PickerDeps<T>, events: PickerEvents<T>): () => void {
  const local = new AbortController();
  const options = { capture: true, signal: AbortSignal.any([local.signal, deps.signal]) };
  const ours = (event: Event): boolean => event.composedPath().includes(deps.host);
  let queued = false;
  let last = { x: 0, y: 0 };

  deps.win.addEventListener(
    'pointermove',
    (event) => {
      if (ours(event)) return;
      last = { x: event.clientX, y: event.clientY };
      if (queued) return;
      queued = true;
      deps.requestFrame(() => {
        queued = false;
        if (!local.signal.aborted) events.hover(deps.resolve(last.x, last.y));
      });
    },
    options
  );
  for (const type of SWALLOWED) {
    deps.win.addEventListener(
      type,
      (event) => {
        if (ours(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      options
    );
  }
  // Touch: the page never sees the gesture; touchstart stays passive (so
  // touch scrolling stays native), and a tap is picked on touchend, whose
  // default (the compatibility click) is cancelled.
  deps.win.addEventListener(
    'touchstart',
    (event) => {
      if (!ours(event)) event.stopImmediatePropagation();
    },
    { ...options, passive: true }
  );
  deps.win.addEventListener(
    'touchend',
    (event) => {
      if (ours(event)) return;
      event.stopImmediatePropagation();
      const touch = event.changedTouches[0];
      if (touch === undefined) return;
      event.preventDefault();
      events.pick(
        deps.resolve(touch.clientX, touch.clientY),
        deps.pointed(touch.clientX, touch.clientY)
      );
    },
    { ...options, passive: false }
  );
  deps.win.addEventListener(
    'click',
    (event) => {
      if (ours(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      events.pick(
        deps.resolve(event.clientX, event.clientY),
        deps.pointed(event.clientX, event.clientY)
      );
    },
    options
  );
  deps.win.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        events.cancel();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        events.tab(event.shiftKey);
      }
    },
    options
  );
  return () => {
    local.abort();
  };
}
