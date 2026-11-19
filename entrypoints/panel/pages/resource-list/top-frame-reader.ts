/**
 * A bounded read of the inspected tab's main frame over the panel's tab
 * transport — the detail views' on-demand reads (a script's source or
 * served tag, a style's CSS). The wait is finite: a read that never settles
 * would strand a copy action or a detail.
 */
import type { TabAsks } from '../../../../lib/messaging/tab-asks';

/** A detail read's transport failures, one muted line each (the script and style details share them). */
export const READ_FAILURE_NOTES = {
  'invalid-request': 'The page refused the request — refresh to try again.',
  unreachable: 'The page did not answer — refresh to try again.',
  unreadable: 'The page answered something unreadable — refresh to try again.'
} as const;

/** How long one read may take before it fails. */
export const SOURCE_CHUNK_TIMEOUT_MS = 5000;

/** What a reader runs against (production: the selected asks and the inspected tab). */
export interface SourceChunkReaderDeps {
  /** The tab transport, or null when this panel can reach no tab. */
  asks: () => TabAsks | null;
  /** The inspected tab, or null outside a DevTools window. */
  inspectedTabId: () => number | null;
  /** The wait bound; defaults to {@link SOURCE_CHUNK_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** The words one kind of read fails with (they name the action it serves). */
export interface ReadWords {
  readonly noTransport: string;
  readonly noTab: string;
  readonly timedOut: string;
}

/**
 * Build a bounded top-frame reader over one tab ask.
 *
 * @param deps See {@link SourceChunkReaderDeps}.
 * @param ask The ask to send.
 * @param words The failures' messages.
 * @returns A reader resolving with the untrusted reply (the caller validates
 *   it); it rejects with an {@link Error} when there is no transport or
 *   inspected tab, the read fails, or the wait runs out.
 */
export function createTopFrameReader<Request>(
  deps: SourceChunkReaderDeps,
  ask: (asks: TabAsks, tabId: number, request: Request) => Promise<unknown>,
  words: ReadWords
): (request: Request) => Promise<unknown> {
  return async (request) => {
    const asks = deps.asks();
    if (asks === null) throw new Error(words.noTransport);
    const tabId = deps.inspectedTabId();
    if (tabId === null) throw new Error(words.noTab);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        ask(asks, tabId, request),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(words.timedOut));
          }, deps.timeoutMs ?? SOURCE_CHUNK_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
}
