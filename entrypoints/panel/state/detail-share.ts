/**
 * The detail pane's width share at runtime — a shell-session value every
 * master–detail list reads (one share for every list page, so a pane opened
 * on Stylesheets matches the one dragged on JavaScript): the boot read, the
 * live value a splitter drag previews, and the commit that persists it.
 *
 * A commit applies at once and then persists through a latest-wins writer
 * (a key held down writes once per storage round trip, the last value always
 * lands). A failed write logs and the panel keeps the width for the session:
 * a width that did not save is no reason to interrupt with a toast.
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import { createLogger, type Logger } from '../../../lib/logger';
import { DETAIL_PANE_DEFAULT_SHARE, isPaneShare } from '../../../lib/panel/detail-layout';
import { readDetailShare, writeDetailShare } from '../../../lib/storage/panel-detail-share';
import { createLatestWriter } from '../../../utils/latest-writer';

const log = createLogger('panel');

/**
 * Summarize a cause for the log: an `Error`'s message, anything else as is.
 *
 * @param cause The caught value.
 */
function logCause(cause: unknown): unknown {
  return cause instanceof Error ? { message: cause.message } : cause;
}

/**
 * Read the stored share for the boot. Never rejects: a failed read logs and
 * degrades to `null` (the default share), so the boot always renders.
 *
 * @param bootLog The panel boot's diagnostics sink.
 * @param read The share read (tests inject doubles); absent, the storage item.
 * @returns The stored share, or `null` (none, or the read failed).
 */
export async function bootDetailShare(
  bootLog: Logger,
  read: () => Promise<number | null> = readDetailShare
): Promise<number | null> {
  try {
    return await read();
  } catch (cause) {
    bootLog.warn('Detail pane width could not be read — the pane takes its default width', {
      cause: logCause(cause)
    });
    return null;
  }
}

/** The session's pane share: what every pane renders from, and its writers. */
export interface DetailShareStore {
  /** The share in effect: the stored one, else {@link DETAIL_PANE_DEFAULT_SHARE}. */
  readonly share: Accessor<number>;
  /** Show a share now without persisting it (a drag in progress). */
  preview(share: number): void;
  /** Apply a share now and persist it (failures are logged, never thrown). */
  commit(share: number): void;
  /** Back to the default share, and forget the stored one. */
  reset(): void;
}

/**
 * Throw on a share outside (0, 1): the splitter only hands over clamped
 * widths, so such a share is a caller bug.
 *
 * @param caller The method's name.
 * @param share The share.
 * @throws {@link RangeError} Naming the method and the value.
 */
function assertShare(caller: string, share: number): void {
  if (!isPaneShare(share)) {
    throw new RangeError(
      `DetailShareStore.${caller}: share must be in (0, 1), got ${String(share)}`
    );
  }
}

/**
 * Create the session share. Call inside the shell (it owns a signal).
 *
 * @param initial The boot's share (`null`: the default).
 * @param write The persistence (`null` removes the stored share); absent, the storage item.
 * @returns The share store.
 * @throws {@link RangeError} For an initial share outside (0, 1).
 */
export function createDetailShare(
  initial: number | null,
  write: (share: number | null) => Promise<void> = writeDetailShare
): DetailShareStore {
  if (initial !== null) assertShare('initial', initial);
  const [share, setShare] = createSignal(initial ?? DETAIL_PANE_DEFAULT_SHARE);
  const persist = createLatestWriter<number | null>(write, (cause, value) => {
    log.warn('The detail pane width could not be persisted', {
      share: value,
      cause: logCause(cause)
    });
  });
  return {
    share,
    preview(next) {
      assertShare('preview', next);
      setShare(next);
    },
    commit(next) {
      assertShare('commit', next);
      setShare(next);
      persist(next);
    },
    reset() {
      setShare(DETAIL_PANE_DEFAULT_SHARE);
      persist(null);
    }
  };
}

/** The shell's share store (provided by the panel shell). */
export const DetailShareContext = createContext<DetailShareStore>();

/**
 * The provisioned share store inside the shell's component tree.
 *
 * @returns The store the shell created.
 * @throws {@link Error} Outside the panel shell (a wiring bug: a dragged
 *   width would neither persist nor reach the other lists).
 */
export function useDetailShare(): DetailShareStore {
  const store = useContext(DetailShareContext);
  if (store === undefined) {
    throw new Error('useDetailShare() ran outside the panel shell.');
  }
  return store;
}
