/** Bounded, snapshot-scoped reads of complete script sources for clipboard actions. */
import type { DelayedScriptRecord } from '../wp-rocket/types';
import { PAYLOAD_LIMITS } from './payload-bounds';

/** Each reply stays far below the transport ceiling, including escaped text. */
export const SCRIPT_SOURCE_CHUNK_CHARS = 64 * 1024;

/** One read against an immutable captured script inventory. */
export interface ScriptSourceRequest {
  snapshotId: string;
  scriptIndex: number;
  offset: number;
}

/** A bounded source segment, or an explicit stale/invalid request result. */
export type ScriptSourceReply =
  { status: 'ok'; text: string; total: number } | { status: 'unavailable' };

/**
 * Create an opaque 128-bit capture identity on HTTPS and ordinary HTTP pages.
 * `getRandomValues` is available in insecure contexts; `randomUUID` is not.
 * @returns A fixed-width hexadecimal identity with no page-derived data.
 */
export function createScriptSnapshotId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (part) =>
    part.toString(16).padStart(8, '0')
  ).join('');
}

/**
 * Whether an untrusted value is one generated snapshot identifier.
 * @param value The boundary value.
 * @returns Whether the value has the capture identifier's fixed shape.
 */
export function isScriptSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && /^[\da-f]{32}$/i.test(value);
}

/**
 * Validate a request before indexing or slicing page-derived data.
 * @param value Untrusted request data.
 * @returns The validated fields, or null for malformed/oversized positions.
 */
export function parseScriptSourceRequest(value: unknown): ScriptSourceRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Partial<ScriptSourceRequest>;
  if (
    !isScriptSnapshotId(row.snapshotId) ||
    !Number.isSafeInteger(row.scriptIndex) ||
    typeof row.scriptIndex !== 'number' ||
    row.scriptIndex < 0 ||
    row.scriptIndex >= PAYLOAD_LIMITS.delayScripts.count ||
    !Number.isSafeInteger(row.offset) ||
    typeof row.offset !== 'number' ||
    row.offset < 0
  )
    return null;
  return row as ScriptSourceRequest;
}

/**
 * Read only the requested captured script; no DOM access or network fetch occurs.
 * @param scripts The full immutable inventory retained by the page hub.
 * @param snapshotId The hub's identity, replaced on navigation/reinjection.
 * @param input Untrusted request data.
 * @returns One bounded chunk, or unavailable for stale/malformed requests.
 */
export function readScriptSourceChunk(
  scripts: readonly DelayedScriptRecord[],
  snapshotId: string,
  input: unknown
): ScriptSourceReply {
  const request = parseScriptSourceRequest(input);
  if (request === null || request.snapshotId !== snapshotId) return { status: 'unavailable' };
  const script = scripts[request.scriptIndex];
  if (script === undefined) return { status: 'unavailable' };
  const source = (script.inline ? script.content : script.src) ?? '';
  if (request.offset > source.length) return { status: 'unavailable' };
  return {
    status: 'ok',
    text: source.slice(request.offset, request.offset + SCRIPT_SOURCE_CHUNK_CHARS),
    total: source.length
  };
}

/**
 * Assemble a full source only for an explicit copy; reject incomplete, changing or malformed replies.
 * UTF-16 chunks join exactly, including surrogate pairs split between chunks.
 * @param request The exact snapshot and document-order script to read.
 * @param send The bounded transport, rejecting on unavailable receivers/timeouts.
 * @param signal Optional cancellation when the copy control unmounts.
 * @returns The complete source with no display ellipsis or trimming.
 * @throws {@link Error} when the snapshot or any source segment is unavailable.
 */
export async function loadScriptSource(
  request: Omit<ScriptSourceRequest, 'offset'>,
  send: (request: ScriptSourceRequest) => Promise<unknown>,
  signal?: AbortSignal
): Promise<string> {
  const parts: string[] = [];
  let offset = 0;
  let total: number | undefined;
  do {
    if (signal?.aborted) throw new Error('Script copy cancelled.');
    const value = await send({ ...request, offset });
    const reply = value as Partial<{ status: unknown; text: unknown; total: unknown }> | null;
    if (
      typeof reply !== 'object' ||
      reply === null ||
      reply.status !== 'ok' ||
      typeof reply.text !== 'string' ||
      typeof reply.total !== 'number' ||
      !Number.isSafeInteger(reply.total) ||
      reply.total < offset ||
      (total !== undefined && total !== reply.total) ||
      reply.text.length !== Math.min(SCRIPT_SOURCE_CHUNK_CHARS, reply.total - offset)
    ) {
      throw new Error(
        'The captured script is unavailable. Refresh the panel and try copying again.'
      );
    }
    total = reply.total;
    parts.push(reply.text);
    offset += reply.text.length;
  } while (offset < total);
  return parts.join('');
}
