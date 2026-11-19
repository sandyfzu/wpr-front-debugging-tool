/**
 * Test-only `ResizeObserver` double (happy-dom lays nothing out): install it
 * on the window, then report a width for every observed element. No shipped
 * module imports this file.
 */
import { vi } from 'vitest';

/** The installed double's handles. */
export interface FakeResizeObservers {
  /**
   * Report a content-box width to every live observer (each observes one list root).
   *
   * @param width The width in px.
   */
  resize(width: number): void;
  /** How many observers are observing right now. */
  live(): number;
}

/**
 * Stub `window.ResizeObserver` with a controllable double for the current
 * test (restore with `vi.unstubAllGlobals()`).
 *
 * @returns The double's handles.
 */
export function installFakeResizeObserver(): FakeResizeObservers {
  const observers = new Set<{
    callback: ResizeObserverCallback;
    targets: Element[];
    self: unknown;
  }>();
  class FakeObserver {
    readonly #entry: { callback: ResizeObserverCallback; targets: Element[]; self: unknown };
    /** @param callback The observer callback. */
    constructor(callback: ResizeObserverCallback) {
      this.#entry = { callback, targets: [], self: this };
      observers.add(this.#entry);
    }
    /** @param target The element to observe. */
    observe(target: Element): void {
      this.#entry.targets.push(target);
    }
    /** Not used by the kit (one element per observer). */
    unobserve(): void {
      this.#entry.targets = [];
    }
    /** Stop observing. */
    disconnect(): void {
      observers.delete(this.#entry);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeObserver);
  return {
    resize(width) {
      for (const observer of [...observers]) {
        const entries = observer.targets.map(
          (target) => ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry
        );
        if (entries.length > 0) observer.callback(entries, observer.self as ResizeObserver);
      }
    },
    live: () => [...observers].filter((observer) => observer.targets.length > 0).length
  };
}
