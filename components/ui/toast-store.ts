/**
 * The panel's toast queue — the "lib-free" store the checklist's facade rides
 * on: no toast library, just a Solid store with a tiny accessor surface.
 *
 * Notifications are Fire-and-forget confirmations for side effects (a copied
 * report, a failed clipboard write — UX-D9's feedback pattern). The queue is
 * capped so a burst of activity cannot flood a small devtools pane; old
 * toasts drop first.
 */
import { createStore } from 'solid-js/store';
import type { StatusKind } from './status-badge';

/** The tones side-effect confirmations come in. */
export type ToastTone = 'success' | 'error' | 'info';

/** Extra shaping of one notification. */
export interface ToastOptions {
  /** Secondary line under the title. */
  description?: string;
  /** Ms before auto-dismissing (defaults are per tone). */
  duration?: number;
}

/** One queued notification. */
export interface ToastItem {
  id: ToastId;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Ms of display before auto-dismissal — the value the item was enqueued with. */
  duration: number;
}

/** Stable id of a queued toast (from `toast.*` returns, for `dismiss`). */
export type ToastId = number;

/** The queue cap: beyond this the oldest toast is dropped when a new one arrives. */
const MAX_TOASTS = 6;

/** Default display time per tone: errors outlive confirmations on purpose. */
const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  error: 8000
};

/**
 * The vocabulary kind each tone paints with — the toast's colors come from the
 * status tables (UX-D7), never re-declared here.
 */
export const TONE_STATUS_KIND: Record<ToastTone, StatusKind> = {
  success: 'ok',
  error: 'error',
  info: 'info'
};

interface ToastState {
  items: ToastItem[];
}

const [state, setState] = createStore<ToastState>({
  items: []
});

/** Read the queue for rendering (`<For each={toastItems()}>`). */
export function toastItems(): ToastItem[] {
  return state.items;
}

let nextId: ToastId = 1;

/**
 * Enqueue one toast, capped to {@link MAX_TOASTS} (oldest dropped).
 *
 * @param tone The tone (`success`/`error`/`info`).
 * @param title The headline — what happened.
 * @param options Secondary line and/or duration.
 * @returns The id to pass to `toast.dismiss` if the caller needs it.
 */
function enqueue(tone: ToastTone, title: string, options?: ToastOptions): ToastId {
  const item: ToastItem = {
    id: nextId++,
    tone,
    title,
    description: options?.description,
    duration: options?.duration ?? DEFAULT_DURATIONS[tone]
  };
  setState('items', (items) => {
    const overflow = Math.max(0, items.length + 1 - MAX_TOASTS);
    return [...items.slice(overflow), item];
  });
  return item.id;
}

/** The toast facade every surface calls: `toast.success('Report copied')`, … */
export const toast = {
  /**
   * Confirm a completed side effect.
   *
   * @param title What happened.
   * @param options Optional description/duration.
   * @returns The queue id.
   */
  success: (title: string, options?: ToastOptions): ToastId => enqueue('success', title, options),
  /**
   * Report a side effect failure the user can act on.
   *
   * @param title What failed.
   * @param options Optional description/duration (errors dwell longer by default).
   * @returns The queue id.
   */
  error: (title: string, options?: ToastOptions): ToastId => enqueue('error', title, options),
  /**
   * Give quiet context that needs no action.
   *
   * @param title The headline.
   * @param options Optional description/duration.
   * @returns The queue id.
   */
  info: (title: string, options?: ToastOptions): ToastId => enqueue('info', title, options),
  /**
   * Remove one toast by id (its close button and timer call this).
   *
   * @param id The id from a `toast.*` call.
   */
  dismiss: (id: ToastId): void => {
    setState('items', (items) => items.filter((item) => item.id !== id));
  },
  /** Empty the queue (used by tests and route teardowns). */
  clear: (): void => {
    setState('items', []);
  }
};
