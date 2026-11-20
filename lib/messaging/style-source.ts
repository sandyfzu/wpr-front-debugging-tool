/**
 * One inline style's full CSS (`getStyleSourceChunk`, DevTools panel → the
 * tab's top frame), read on demand when the Stylesheets page opens a style's
 * detail or copies it — the list itself carries only a short preview.
 *
 * Addressing: the inventory is read live per ask, so a list position alone
 * could name another element by the time the detail asks. Each stylesheet
 * list therefore answers with a `snapshotId`, and the page keeps that one
 * list's elements; a read names the snapshot and the position in it. A read
 * of another (older) snapshot, a position past the list, or an element no
 * longer in the document is `gone`.
 *
 * Bounds: a style's CSS is kept up to {@link STYLE_SOURCE_MAX_CHARS} (past
 * it the reply says `truncated`), read in chunks of
 * {@link STYLE_SOURCE_CHUNK_CHARS}. Both ends validate with the same caps.
 */
import { cutToUnits } from '../../utils/cap-text';
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { isRandomId } from '../../utils/random-id';
import type { Logger } from '../logger';
import { PAGE_STYLE_LIMITS } from './page-styles';

/** One reply's text at most, far below the transport ceiling even escaped. */
export const STYLE_SOURCE_CHUNK_CHARS = 64 * 1024;

/** The CSS one style read keeps (UTF-16 units; ≈ 2 MiB). */
export const STYLE_SOURCE_MAX_CHARS = 1024 * 1024;

/** One chunk read. */
export interface StyleSourceRequest {
  /** The stylesheet list the position belongs to (its reply's `snapshotId`). */
  readonly snapshotId: string;
  /** The style's position in that list (document order). */
  readonly styleIndex: number;
  /** The first UTF-16 unit to read. */
  readonly offset: number;
}

/**
 * Why a read was refused: the request broke the contract, or the position
 * names a stylesheet link (it has no CSS of its own here; the panel never
 * asks for one).
 */
export type StyleSourceError = 'invalid-request' | 'not-inline';

/** The page's answer. */
export type StyleSourceReply =
  | {
      readonly status: 'ok';
      /** The chunk starting at the request's offset. */
      readonly text: string;
      /** The kept CSS's length (≤ {@link STYLE_SOURCE_MAX_CHARS}). */
      readonly total: number;
      /** The style's CSS is longer than what is kept. */
      readonly truncated: boolean;
    }
  | { readonly status: 'gone' }
  | { readonly status: 'error'; readonly reason: StyleSourceError };

/** Every refusal reason (the reply guard's closed list). */
const STYLE_SOURCE_ERRORS: readonly StyleSourceError[] = ['invalid-request', 'not-inline'];

/**
 * Whether a value is a non-negative safe integer below a bound.
 *
 * @param value The boundary value.
 * @param below The exclusive upper bound.
 */
function isIndexBelow(value: unknown, below: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < below;
}

/**
 * Guard a request before it indexes anything (exact keys, bounded numbers).
 *
 * @param value The boundary value.
 * @returns The rebuilt request, or null on any violation.
 */
export function parseStyleSourceRequest(value: unknown): StyleSourceRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['snapshotId', 'styleIndex', 'offset'])) return null;
  const snapshotId = ownValue(value, 'snapshotId');
  const styleIndex = ownValue(value, 'styleIndex');
  const offset = ownValue(value, 'offset');
  if (
    !isRandomId(snapshotId) ||
    !isIndexBelow(styleIndex, PAGE_STYLE_LIMITS.count) ||
    !isIndexBelow(offset, STYLE_SOURCE_MAX_CHARS + 1)
  )
    return null;
  return { snapshotId, styleIndex, offset };
}

/** A style's kept CSS. */
export interface KeptStyleSource {
  /** The CSS, cut to {@link STYLE_SOURCE_MAX_CHARS} (never inside a surrogate pair). */
  readonly text: string;
  /** The style's CSS was longer. */
  readonly truncated: boolean;
}

/**
 * Keep a style's CSS within the read cap.
 *
 * @param css The element's full text.
 * @returns The kept text and whether it was cut.
 */
export function keepStyleSource(css: string): KeptStyleSource {
  if (css.length <= STYLE_SOURCE_MAX_CHARS) return { text: css, truncated: false };
  return { text: cutToUnits(css, STYLE_SOURCE_MAX_CHARS), truncated: true };
}

/**
 * The chunk of a kept source at an offset.
 *
 * @param source The kept CSS.
 * @param offset A validated offset.
 * @returns The `ok` reply, or `invalid-request` past the end.
 */
export function styleSourceChunk(source: KeptStyleSource, offset: number): StyleSourceReply {
  if (offset > source.text.length) return { status: 'error', reason: 'invalid-request' };
  return {
    status: 'ok',
    text: source.text.slice(offset, offset + STYLE_SOURCE_CHUNK_CHARS),
    total: source.text.length,
    truncated: source.truncated
  };
}

/**
 * Guard the page's reply (exact keys per status, bounded text).
 *
 * @param value The boundary value.
 * @returns The rebuilt reply, or null on any violation.
 */
export function parseStyleSourceReply(value: unknown): StyleSourceReply | null {
  if (!isRecord(value)) return null;
  const status = ownValue(value, 'status');
  if (status === 'gone') return hasOnlyKeys(value, ['status']) ? { status: 'gone' } : null;
  if (status === 'error') {
    const reason = ownValue(value, 'reason');
    return hasOnlyKeys(value, ['status', 'reason']) &&
      STYLE_SOURCE_ERRORS.includes(reason as StyleSourceError)
      ? { status: 'error', reason: reason as StyleSourceError }
      : null;
  }
  if (status !== 'ok' || !hasOnlyKeys(value, ['status', 'text', 'total', 'truncated'])) return null;
  const text = ownValue(value, 'text');
  const total = ownValue(value, 'total');
  const truncated = ownValue(value, 'truncated');
  if (
    typeof text !== 'string' ||
    text.length > STYLE_SOURCE_CHUNK_CHARS ||
    !isIndexBelow(total, STYLE_SOURCE_MAX_CHARS + 1) ||
    typeof truncated !== 'boolean'
  )
    return null;
  return { status: 'ok', text, total, truncated };
}

/** Why the panel has no CSS beyond the page's own answers. */
export type StyleSourceReadFailure = 'unreachable' | 'unreadable';

/** The panel's outcome of one full read. */
export type StyleSourceResult =
  | { readonly status: 'ok'; readonly text: string; readonly truncated: boolean }
  | { readonly status: 'gone' }
  | { readonly status: 'error'; readonly reason: StyleSourceError | StyleSourceReadFailure };

/**
 * Whether a chunk continues the read consistently: same total, exactly the
 * expected length (a full chunk, or the rest).
 *
 * @param reply The chunk.
 * @param offset Where it was asked.
 * @param total The first chunk's total (undefined for the first).
 */
function continuesRead(
  reply: { readonly text: string; readonly total: number },
  offset: number,
  total: number | undefined
): boolean {
  return (
    reply.total >= offset &&
    (total === undefined || total === reply.total) &&
    reply.text.length === Math.min(STYLE_SOURCE_CHUNK_CHARS, reply.total - offset)
  );
}

/**
 * Read one style's whole kept CSS, chunk by chunk. Never throws: a send
 * failure is `unreachable`, a broken or inconsistent reply `unreadable`
 * (both logged), the page's own `gone`/refusals pass through. UTF-16 chunks
 * join exactly (a surrogate pair split between chunks included).
 *
 * @param request The snapshot and position to read.
 * @param send The bounded transport (rejects on no receiver / timeout).
 * @param log Where failures are reported.
 * @param signal Cancels between chunks (the result is then `unreachable`, unlogged).
 * @returns The outcome.
 */
export async function loadStyleSource(
  request: Omit<StyleSourceRequest, 'offset'>,
  send: (request: StyleSourceRequest) => Promise<unknown>,
  log: Pick<Logger, 'warn'>,
  signal?: AbortSignal
): Promise<StyleSourceResult> {
  const parts: string[] = [];
  let offset = 0;
  let total: number | undefined;
  let truncated = false;
  do {
    if (signal?.aborted === true) return { status: 'error', reason: 'unreachable' };
    let answer: unknown;
    try {
      answer = await send({ ...request, offset });
    } catch (error) {
      log.warn('Reading the style source failed', error instanceof Error ? error.message : error);
      return { status: 'error', reason: 'unreachable' };
    }
    const reply = parseStyleSourceReply(answer);
    if (reply === null || (reply.status === 'ok' && !continuesRead(reply, offset, total))) {
      log.warn('The style source reply broke its contract; it was ignored');
      return { status: 'error', reason: 'unreadable' };
    }
    if (reply.status !== 'ok') return reply;
    total = reply.total;
    truncated = reply.truncated;
    parts.push(reply.text);
    offset += reply.text.length;
  } while (offset < total);
  return { status: 'ok', text: parts.join(''), truncated };
}
