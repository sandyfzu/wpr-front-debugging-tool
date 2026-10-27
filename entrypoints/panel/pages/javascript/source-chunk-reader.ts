/**
 * The JavaScript page's complete-source reads: one bounded segment from the
 * inspected tab's main frame per call, over the panel's tab transport, with
 * a finite wait — a read that never settles would strand the copy action.
 */
import type { ScriptSourceRequest } from '../../../../lib/messaging/script-source';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';

/** How long one segment read may take before it fails. */
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

/**
 * Build the segment reader the source assembler drives.
 *
 * @param deps See {@link SourceChunkReaderDeps}.
 * @returns A reader resolving with the untrusted transport reply (the
 *   assembler validates it); it rejects with an {@link Error} when there is
 *   no transport or inspected tab, the read fails, or the wait runs out.
 */
export function createSourceChunkReader(
  deps: SourceChunkReaderDeps
): (request: ScriptSourceRequest) => Promise<unknown> {
  return async (request) => {
    const asks = deps.asks();
    if (asks === null) throw new Error('This panel cannot reach the page for script copy.');
    const tabId = deps.inspectedTabId();
    if (tabId === null) throw new Error('No inspected tab for script copy.');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        asks.getScriptSourceChunk(tabId, request),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            reject(new Error('Script source read timed out.'));
          }, deps.timeoutMs ?? SOURCE_CHUNK_TIMEOUT_MS);
        })
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };
}
