/**
 * The JavaScript page's reads from the captured script inventory — one
 * complete-source segment, or one script's served tag — each from the
 * inspected tab's main frame over the panel's tab transport, with a finite
 * wait: a read that never settles would strand a copy action or a detail.
 */
import type { ScriptSourceRequest } from '../../../../lib/messaging/script-source';
import type { ServedScriptTagRequest } from '../../../../lib/messaging/served-script-tag';
import {
  createTopFrameReader,
  type SourceChunkReaderDeps
} from '../resource-list/top-frame-reader';

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
