/**
 * The machine behind an options row that applies the moment it changes (the
 * on-page UI gate, the palette shortcut): it owns its own storage item, so it
 * never enters the page's draft — a pending edit elsewhere on the page
 * survives every write here untouched.
 *
 * States: `loading` (the boot read is in flight) → `ready` (value known) or
 * `failed` (the read rejected); `load` from `failed` is the retry, shown as
 * `retrying` (so a retry that fails again is visibly a new attempt) → `ready`
 * or `failed`. While ready:
 *
 * - **Optimistic write:** `set` shows the new value at once and awaits the
 *   write; a rejection restores the last confirmed value and reports
 *   `'failed'` (the caller toasts the remedy). Overlapping writes: the
 *   latest request decides the shown value — an earlier one resolves
 *   `'superseded'`, though its success still confirms its value unless a
 *   later write already settled — and `writing` clears only once the last
 *   in-flight write settles, in whatever order they settle.
 * - **Live follow:** the item's watch is armed before the boot read, so a
 *   write from another surface (the context menu, another options tab) lands
 *   live; while a write of ours is in flight the watched value only moves
 *   the confirmed baseline, never the shown value.
 */
import type { Logger } from '../logger';

/** The browser seams of one instant setting. */
export interface InstantSettingIO<T> {
  /** Validated read of the stored value; rejects as the platform does. */
  read(): Promise<T>;
  /** Persist a value; rejects as the platform does. */
  write(value: T): Promise<void>;
  /**
   * Follow the stored value (validated by the item's own watch helper).
   *
   * @returns The unsubscribe handle.
   */
  watch(onChange: (value: T) => void): () => void;
  /** Degradation diagnostics. */
  log: Logger;
}

/** What the row can render next. */
export type InstantSettingSnapshot<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  /** A retry of the failed read is in flight (the failure stays explained). */
  | { readonly status: 'retrying' }
  | {
      readonly status: 'ready';
      /** The value the control shows (an in-flight write's target included). */
      readonly value: T;
      /** A write of ours is in flight. */
      readonly writing: boolean;
    };

/** How a `set` call ended. */
export type InstantWriteOutcome =
  /** Persisted (and still the latest request). */
  | 'written'
  /** The value already was the shown one — no write happened. */
  | 'unchanged'
  /** The write rejected; the confirmed value is shown again. */
  | 'failed'
  /** A later `set` took over before this one settled; its outcome is the one that counts. */
  | 'superseded';

/** One instant setting's machine (one per mounted page). */
export interface InstantSettingModel<T> {
  /** The current snapshot (frozen; also every `onChange` payload). */
  snapshot(): InstantSettingSnapshot<T>;
  /**
   * The boot read — and the failed state's retry. A no-op while ready or
   * while a read is in flight.
   */
  load(): Promise<void>;
  /**
   * Apply a value now.
   *
   * @throws {@link Error} When the setting is not ready — the control does
   *   not exist yet, so a call is a wiring bug.
   */
  set(next: T): Promise<InstantWriteOutcome>;
  /** Stop following the item (idempotent). */
  dispose(): void;
}

/** The initial snapshot (also what a fresh model reports before `load`). */
const LOADING: InstantSettingSnapshot<never> = Object.freeze({ status: 'loading' });

/** The failed snapshot (one shape, shared). */
const FAILED: InstantSettingSnapshot<never> = Object.freeze({ status: 'failed' });

/** The retrying snapshot (one shape, shared). */
const RETRYING: InstantSettingSnapshot<never> = Object.freeze({ status: 'retrying' });

/**
 * Create an instant setting's machine. The watch is armed at creation, so
 * nothing written between creation and the boot read is lost.
 *
 * @param io The item's seams.
 * @param equals Value equality (chords are objects; booleans use `Object.is`).
 * @param onChange Receives every state movement.
 */
export function createInstantSettingModel<T>(
  io: InstantSettingIO<T>,
  equals: (a: T, b: T) => boolean,
  onChange: (snapshot: InstantSettingSnapshot<T>) => void = () => {}
): InstantSettingModel<T> {
  let current: InstantSettingSnapshot<T> = LOADING;
  /** The last value storage confirmed (read, watch or our settled write). */
  let confirmed: { value: T } | null = null;
  let reading = false;
  /** Increments per `set`; the latest request decides the shown value. */
  let latestWrite = 0;
  /** The newest request whose write succeeded (an older success never re-confirms). */
  let newestWritten = 0;
  let inFlight = 0;

  /** Publish a new snapshot. */
  function publish(next: InstantSettingSnapshot<T>): void {
    current = next;
    onChange(next);
  }

  /** The ready snapshot for a shown value. */
  function ready(value: T): InstantSettingSnapshot<T> {
    return Object.freeze({ status: 'ready', value, writing: inFlight > 0 });
  }

  const unwatch = io.watch((value) => {
    confirmed = { value };
    // Mid-write the shown value is our request's; the write's settle decides.
    if (current.status === 'ready' && inFlight === 0) publish(ready(value));
  });
  let watching = true;

  return {
    snapshot: () => current,

    async load(): Promise<void> {
      if (reading || current.status === 'ready') return;
      reading = true;
      if (current.status === 'failed') publish(RETRYING);
      try {
        const value = await io.read();
        // A watched write that landed while the read was in flight is newer.
        confirmed ??= { value };
        publish(ready(confirmed.value));
      } catch (cause) {
        io.log.error('Reading the setting failed — the row offers a retry', cause);
        publish(FAILED);
      } finally {
        reading = false;
      }
    },

    async set(next: T): Promise<InstantWriteOutcome> {
      if (current.status !== 'ready') {
        throw new Error(
          `set: the setting is not ready (status '${current.status}') — no control may write yet.`
        );
      }
      if (inFlight === 0 && equals(current.value, next)) return 'unchanged';
      const request = ++latestWrite;
      inFlight += 1;
      publish(ready(next));
      let outcome: InstantWriteOutcome;
      try {
        await io.write(next);
        if (request > newestWritten) {
          newestWritten = request;
          confirmed = { value: next };
        }
        outcome = request === latestWrite ? 'written' : 'superseded';
      } catch (cause) {
        io.log.error('Writing the setting failed — the stored value is shown again', cause);
        outcome = request === latestWrite ? 'failed' : 'superseded';
      }
      inFlight -= 1;
      // The latest request decides; the last settle (any order) clears `writing`.
      // Ready implies a confirmed value (the boot read set it); the fallback
      // keeps the type total.
      if (request === latestWrite || inFlight === 0) {
        publish(ready(confirmed === null ? next : confirmed.value));
      }
      return outcome;
    },

    dispose(): void {
      if (!watching) return;
      watching = false;
      unwatch();
    }
  };
}
