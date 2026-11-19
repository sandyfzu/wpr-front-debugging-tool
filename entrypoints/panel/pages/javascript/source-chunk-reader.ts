/**
 * The JavaScript page's reads from the captured script inventory — one
 * complete-source segment, or one script's served tag — each from the
 * inspected tab's main frame over the panel's tab transport, with a finite
 * wait: a read that never settles would strand a copy action or a detail.
 */
import type { ScriptSourceRequest } from '../../../../lib/messaging/script-source';
import type { ServedScriptTagRequest } from '../../../../lib/messaging/served-script-tag';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';

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
interface ReadWords {
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
function createTopFrameReader<Request>(
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

/**
 * Build the segment reader the source assembler drives.
 *
 * @param deps See {@link SourceChunkReaderDeps}.
 * @returns The bounded reader (see {@link createTopFrameReader}).
 */
export function createSourceChunkReader(
  deps: SourceChunkReaderDeps
): (request: ScriptSourceRequest) => Promise<unknown> {
  return createTopFrameReader(
    deps,
    (asks, tabId, request: ScriptSourceRequest) => asks.getScriptSourceChunk(tabId, request),
    {
      noTransport: 'This panel cannot reach the page for script copy.',
      noTab: 'No inspected tab for script copy.',
      timedOut: 'Script source read timed out.'
    }
  );
}

/**
 * Build the served-tag reader a script detail asks once on open.
 *
 * @param deps See {@link SourceChunkReaderDeps}.
 * @returns The bounded reader (see {@link createTopFrameReader}).
 */
export function createServedTagReader(
  deps: SourceChunkReaderDeps
): (request: ServedScriptTagRequest) => Promise<unknown> {
  return createTopFrameReader(
    deps,
    (asks, tabId, request: ServedScriptTagRequest) => asks.getServedScriptTag(tabId, request),
    {
      noTransport: 'This panel cannot reach the page for the served tag.',
      noTab: 'No inspected tab for the served tag.',
      timedOut: 'Served tag read timed out.'
    }
  );
}
