/**
 * Keyboard focus by row key for a virtualized list: rows register their
 * focus target while mounted, and a focus request for a row outside the
 * rendered window waits for that row to mount (the caller scrolls it in
 * first). A waiting request expires — a row the list never renders (removed,
 * filtered out) must not grab focus later, when the user scrolls to it.
 */

/** How long a request for an unmounted row waits for it (ms). */
export const ROW_FOCUS_WAIT_MS = 1000;

/** The focus registry one list owns. */
export interface RowFocus {
  /**
   * Register a mounted row's focus target; a pending request for its key
   * lands now.
   *
   * @param key The row key.
   * @param target The row's focusable element (connected).
   * @returns Unregister (call on the row's cleanup).
   */
  register(key: string, target: HTMLElement): () => void;
  /**
   * Focus a row's target — at once when mounted, else when it mounts within
   * {@link ROW_FOCUS_WAIT_MS}. A newer request replaces a waiting one.
   *
   * @param key The row key.
   */
  focus(key: string): void;
  /** Drop a waiting request (the list disposes, or focus went elsewhere on purpose). */
  cancel(): void;
}

/** The timer seam (tests drive time with fake timers). */
export interface RowFocusClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The real timers. */
const REAL_CLOCK: RowFocusClock = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

/**
 * Create a list's focus registry.
 *
 * @param clock The timer seam (default: the real timers).
 * @returns The registry.
 */
export function createRowFocus(clock: RowFocusClock = REAL_CLOCK): RowFocus {
  const targets = new Map<string, HTMLElement>();
  let pending: string | null = null;
  let timer: unknown = null;

  /** Forget the waiting request and its expiry. */
  const cancel = (): void => {
    pending = null;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };

  /**
   * Focus a target without scrolling (the list's scroll request places the
   * row; a focus scroll would fight it).
   *
   * @param target The element to focus.
   */
  const land = (target: HTMLElement): void => {
    target.focus({ preventScroll: true });
  };

  return {
    register(key, target) {
      targets.set(key, target);
      if (pending === key) {
        cancel();
        land(target);
      }
      return () => {
        // A row remounted under the same key may have registered a newer target.
        if (targets.get(key) === target) targets.delete(key);
      };
    },
    focus(key) {
      cancel();
      const target = targets.get(key);
      if (target?.isConnected === true) {
        land(target);
        return;
      }
      pending = key;
      timer = clock.setTimeout(cancel, ROW_FOCUS_WAIT_MS);
    },
    cancel
  };
}
