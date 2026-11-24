/**
 * Where the What's new tab opens: the last-focused normal window, never a
 * private one. Pure over the window facts the background reads (the
 * `windows` API needs no permission for them), plus a bounded wait for the
 * browser's first window: an update applied at browser start runs before
 * session restore opens any, and creating one then would add a window
 * beside the restored ones.
 */

/** The window facts the choice needs. */
export interface WindowFacts {
  readonly id?: number;
  readonly type?: string;
  readonly incognito: boolean;
  readonly focused: boolean;
}

/** A window that can take the page. */
export type UsableWindow = WindowFacts & { readonly id: number };

/** Where to open. */
export type TabTarget =
  /** A tab in this window. */
  | { readonly kind: 'window'; readonly windowId: number }
  /** No usable window: a new normal window. */
  | { readonly kind: 'new-window' };

/**
 * Whether a window can take the page.
 *
 * @param window One window.
 */
export function isUsableWindow(window: WindowFacts): window is UsableWindow {
  return window.id !== undefined && window.type === 'normal' && !window.incognito;
}

/**
 * Pick the target window.
 *
 * @param lastFocused The browser's last-focused normal window (null when none answered).
 * @param all Every normal window.
 * @returns The last-focused window when usable, else the focused or first usable
 *   one, else a new window.
 */
export function pickTabTarget(
  lastFocused: WindowFacts | null,
  all: readonly WindowFacts[]
): TabTarget {
  if (lastFocused !== null && isUsableWindow(lastFocused)) {
    return { kind: 'window', windowId: lastFocused.id };
  }
  const candidates = all.filter(isUsableWindow);
  const chosen = candidates.find((window) => window.focused) ?? candidates[0];
  return chosen === undefined ? { kind: 'new-window' } : { kind: 'window', windowId: chosen.id };
}

/** How long the opening waits for the browser's first window before creating one. */
export const FIRST_WINDOW_WAIT_MS = 3_000;

/** The timer calls the wait uses (injected for tests). */
export interface WaitTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/**
 * Wait for the first usable window the browser creates.
 *
 * @param subscribe Adds a window-created listener; returns its removal (always called).
 * @param timeoutMs How long to wait.
 * @param timers The timer calls (default the global ones).
 * @returns The window, or null when none came in time.
 */
export function waitForUsableWindow(
  subscribe: (listener: (window: WindowFacts) => void) => () => void,
  timeoutMs: number,
  timers: WaitTimers = {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
    }
  }
): Promise<UsableWindow | null> {
  return new Promise((resolve) => {
    // Read from the closures too, so an object (flow analysis sees no write through it).
    const state: { settled: boolean; unsubscribe: (() => void) | null } = {
      settled: false,
      unsubscribe: null
    };
    const finish = (window: UsableWindow | null): void => {
      if (state.settled) return;
      state.settled = true;
      timers.clearTimeout(handle);
      state.unsubscribe?.();
      resolve(window);
    };
    const handle = timers.setTimeout(() => {
      finish(null);
    }, timeoutMs);
    const unsubscribe = subscribe((window) => {
      if (isUsableWindow(window)) finish(window);
    });
    // A window reported during `subscribe` settled before its removal existed.
    if (state.settled) unsubscribe();
    else state.unsubscribe = unsubscribe;
  });
}
