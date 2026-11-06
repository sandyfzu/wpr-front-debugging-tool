/**
 * A settings form's debounced, failure-visible persistence (every tool page
 * binds its own store and check). Edits queue a write that runs once typing
 * pauses; a run can flush it first, so the run reads exactly what the form
 * shows. A value the store would refuse (the tool's check names why) is
 * never sent and reads `refused`; a write the storage rejects (quota, a dead
 * extension context) reads `failed` — both with their message, never
 * swallowed.
 *
 * States: `saved` → (edit) `pending` → (pause/flush) `saving` → `saved` |
 * `failed` | `refused`; an edit during `saving` queues the next write.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { ScheduleTimer } from '../../../../lib/messaging/bounded-ask';

/** Where the form's settings stand against the store. */
export type ConfigSaveState =
  | { readonly status: 'saved' }
  | { readonly status: 'pending' }
  | { readonly status: 'saving' }
  /** Not sent: the store would refuse this configuration. */
  | { readonly status: 'refused'; readonly message: string }
  /** Sent and rejected by the storage. */
  | { readonly status: 'failed'; readonly message: string };

/** What the writer needs (tests inject doubles). */
export interface ConfigWriterDeps<T> {
  /** Store one value (rejects as the storage does). */
  readonly write: (config: T) => Promise<void>;
  /** Why the store would refuse a value (user words), or null — a refused value is never sent. */
  readonly check: (config: T) => string | null;
  /** Timer seam. */
  readonly schedule: ScheduleTimer;
  /** Quiet time (ms) after the last edit before writing. */
  readonly delayMs: number;
}

/** The writer. */
export interface ConfigWriter<T> {
  readonly state: Accessor<ConfigSaveState>;
  /** Queue the latest configuration (replaces any queued one). */
  readonly queue: (config: T) => void;
  /**
   * Write the edit current at the call now (an edit made meanwhile keeps its
   * own debounce).
   *
   * @returns Whether the store now holds the settings the form showed at the call.
   */
  readonly flush: () => Promise<boolean>;
  /** Drop a queued write (teardown). */
  readonly cancel: () => void;
}

/** One edit waiting to be written, numbered in edit order. */
interface QueuedEdit<T> {
  readonly config: T;
  readonly number: number;
}

/** How one write pass ended. */
type WritePass = 'idle' | 'stored' | 'refused' | 'failed';

/** The user words for a rejected write. */
function writeFailureMessage(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Couldn't save the settings (${detail}). Your edits stay here; the next change or run tries again.`;
}

/**
 * Create the writer.
 *
 * @param deps See {@link ConfigWriterDeps}.
 */
export function createConfigWriter<T>(deps: ConfigWriterDeps<T>): ConfigWriter<T> {
  const [state, setState] = createSignal<ConfigSaveState>({ status: 'saved' });
  let queued: QueuedEdit<T> | null = null;
  let cancelTimer: (() => void) | null = null;
  let inFlight: Promise<void> | null = null;
  // Edits are numbered: a flush waits for the edit current at its call, never a later one.
  let lastEdit = 0;
  let lastStored = 0;

  /**
   * Write the queued configuration (one at a time; a newer one waits its turn).
   *
   * @returns How this pass ended: `idle` when nothing was queued.
   */
  const writeQueued = async (): Promise<WritePass> => {
    cancelTimer?.();
    cancelTimer = null;
    while (inFlight !== null) await inFlight;
    const edit = queued;
    if (edit === null) return 'idle';
    queued = null;
    const problem = deps.check(edit.config);
    if (problem !== null) {
      setState({ status: 'refused', message: problem });
      return 'refused';
    }
    setState({ status: 'saving' });
    let pass: WritePass = 'stored';
    inFlight = deps.write(edit.config).then(
      () => {
        lastStored = Math.max(lastStored, edit.number);
        // A newer edit queued meanwhile keeps the form `pending`.
        setState(queued === null ? { status: 'saved' } : { status: 'pending' });
      },
      (cause: unknown) => {
        pass = 'failed';
        // Kept for the next flush (a run retries it), unless a newer edit replaced it.
        queued ??= edit;
        setState({ status: 'failed', message: writeFailureMessage(cause) });
      }
    );
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
    return pass;
  };

  /** Hold `config` as the newest edit and (re)start the debounce. */
  const queue = (config: T): void => {
    lastEdit += 1;
    queued = { config, number: lastEdit };
    setState({ status: 'pending' });
    cancelTimer?.();
    cancelTimer = deps.schedule(() => {
      void writeQueued();
    }, deps.delayMs);
  };

  /**
   * Write the edit current at the call (and any older one) now. Bounded: an
   * edit made meanwhile stays queued for its own debounce instead of
   * extending the wait — so typing during the save never holds a run.
   *
   * @returns Whether the store holds that edit (`false` once a write is
   *   refused or rejected, or the edit was dropped by `cancel`).
   */
  const flush = async (): Promise<boolean> => {
    const target = lastEdit;
    // Each pass writes the newest queued edit (numbered at or past `target`
    // once the write in flight at the call is out), so this ends in two passes.
    while (lastStored < target) {
      const pass = await writeQueued();
      if (pass === 'refused' || pass === 'failed') return false;
      if (pass === 'idle' && inFlight === null && queued === null) return lastStored >= target;
    }
    return true;
  };

  /** Drop the held edit and its timer (teardown; a write in flight still lands). */
  const cancel = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    queued = null;
  };

  return { state, queue, flush, cancel };
}
