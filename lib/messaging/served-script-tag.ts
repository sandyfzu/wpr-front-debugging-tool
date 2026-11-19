/**
 * The served opening tag of one captured script (`getServedScriptTag`): what
 * the page's markup said about a script — its `type`, `src`, `defer` and
 * WP Rocket's stamps — read on demand when the panel opens a script's
 * detail, never shipped with the page data (5,000 scripts × 2 KiB would
 * dwarf the payload for one view).
 *
 * Capture: the tags are rebuilt during the page's single processing pass,
 * from the parsed snapshot's script elements (the serialized document is
 * released right after that pass, and the live elements drift — Delay JS
 * restores types, scripts get inserted), so a tag always describes the same
 * snapshot `getScriptSourceChunk` reads, at the same document position. The
 * tag is a reconstruction from the parsed attributes (the source's quoting
 * and spacing are gone): `name="value"`, a valueless attribute bare.
 *
 * Bounds: each attribute name/value keeps its first
 * {@link SERVED_TAG_ATTRIBUTE_MAX_CHARS} chars plus `…`; a tag stops adding
 * attributes before {@link SERVED_TAG_MAX_CHARS} (ending ` …>`); the page's
 * tags share a {@link SERVED_TAGS_TOTAL_CHARS} keep budget, past which a
 * script's tag reads `not-kept`. Both ends validate with the same caps.
 */
import { cutToUnits } from '../../utils/cap-text';
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import type { Logger } from '../logger';
import { PAYLOAD_LIMITS } from './payload-bounds';
import { isScriptSnapshotId } from './script-source';

/** Longest attribute name or value kept whole (longer ones end in `…`). */
export const SERVED_TAG_ATTRIBUTE_MAX_CHARS = 256;

/** Longest served tag, `<script` to `>`. */
export const SERVED_TAG_MAX_CHARS = 2048;

/** The chars one page's kept tags may hold together (≈ 2 MiB of UTF-16). */
export const SERVED_TAGS_TOTAL_CHARS = 1024 * 1024;

/** The mark ending a cut name, value or attribute list. */
const CUT_MARK = '…';

/** The tail of a tag that ran out of room before its last attribute. */
const CUT_TAG_END = ` ${CUT_MARK}>`;

/** One ask: the snapshot the panel's data came from and the script's document position. */
export interface ServedScriptTagRequest {
  readonly snapshotId: string;
  readonly scriptIndex: number;
}

/** One kept tag: the rebuilt opening tag and its served `type` (bounded), `null` when absent. */
export interface ServedScriptTag {
  readonly tag: string;
  readonly type: string | null;
}

/** Why a tag could not be read (the script itself may still exist). */
export type ServedScriptTagError = 'invalid-request' | 'not-ready' | 'not-kept';

/**
 * The answer: the tag; `gone` when the snapshot was replaced (the page
 * reloaded, navigated or the content script restarted) or holds no such
 * script; or a typed error.
 */
export type ServedScriptTagReply =
  | ({ readonly status: 'ok' } & ServedScriptTag)
  | { readonly status: 'gone' }
  | { readonly status: 'error'; readonly reason: ServedScriptTagError };

/** Every error reason (the boundary check reads it). */
const SERVED_TAG_ERRORS: readonly ServedScriptTagError[] = [
  'invalid-request',
  'not-ready',
  'not-kept'
];

/**
 * Cut a name or value to the attribute cap, never splitting a surrogate pair.
 *
 * The cut is rebuilt as a fresh string: an engine may keep a prefix
 * (`slice`) as a view into its source, so a kept 257-char cut of a
 * multi-megabyte `data:` URL would pin the whole URL for the page's life
 * (Chromium keeps them: 40 cut 8 MB `src` values held the renderer at
 * ≈ 400 MB vs ≈ 84 MB with the copy). The copy walks at most 256 chars, and
 * only for cut attributes.
 *
 * @param text The attribute name or value.
 * @returns The text, or its first {@link SERVED_TAG_ATTRIBUTE_MAX_CHARS} chars + `…`.
 */
export function capAttributeText(text: string): string {
  if (text.length <= SERVED_TAG_ATTRIBUTE_MAX_CHARS) return text;
  // eslint-disable-next-line @typescript-eslint/no-misused-spread -- split and rejoined unchanged: only the copy matters
  return [...cutToUnits(text, SERVED_TAG_ATTRIBUTE_MAX_CHARS), CUT_MARK].join('');
}

/**
 * Escape an attribute value for a double-quoted attribute (the HTML
 * serializer's set, plus `<`/`>` so a value never reads as markup).
 *
 * @param value The raw value.
 */
function escapeAttributeValue(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * One attribute as markup: ` name` when valueless, else ` name="value"`.
 *
 * @param name The attribute's name.
 * @param value The attribute's value.
 */
function attributeMarkup(name: string, value: string): string {
  const shownName = capAttributeText(name);
  return value === ''
    ? ` ${shownName}`
    : ` ${shownName}="${escapeAttributeValue(capAttributeText(value))}"`;
}

/**
 * Rebuild a script's opening tag from its parsed attributes, in document
 * order, within {@link SERVED_TAG_MAX_CHARS}.
 *
 * @param attributes The element's attributes (`element.attributes`).
 * @returns The tag and its bounded `type` attribute (`null` when absent).
 */
export function servedScriptTag(
  attributes: Iterable<Pick<Attr, 'name' | 'value'>>
): ServedScriptTag {
  let tag = '<script';
  let type: string | null = null;
  let cut = false;
  for (const { name, value } of attributes) {
    if (name === 'type' && type === null) type = capAttributeText(value);
    if (cut) continue;
    const markup = attributeMarkup(name, value);
    // Leave room for the cut tail, so a cut tag still closes within the cap.
    if (tag.length + markup.length + CUT_TAG_END.length > SERVED_TAG_MAX_CHARS) {
      cut = true;
      continue;
    }
    tag += markup;
  }
  return { tag: tag + (cut ? CUT_TAG_END : '>'), type };
}

/**
 * The tags one processing pass keeps: one per script in document order, up
 * to the payload's script cap (the panel never asks past it), each until the
 * page's keep budget runs out (`null` from there on).
 *
 * @param scripts The parsed snapshot's script elements, in document order.
 * @param budget The chars the tags may hold together (default {@link SERVED_TAGS_TOTAL_CHARS}).
 * @returns The kept tags (`null` = not kept).
 */
export function keepServedScriptTags(
  scripts: readonly Pick<Element, 'attributes'>[],
  budget: number = SERVED_TAGS_TOTAL_CHARS
): (ServedScriptTag | null)[] {
  let left = budget;
  return scripts.slice(0, PAYLOAD_LIMITS.delayScripts.count).map((script) => {
    if (left <= 0) return null;
    const kept = servedScriptTag(script.attributes);
    left -= kept.tag.length + (kept.type?.length ?? 0);
    return left >= 0 ? kept : null;
  });
}

/**
 * Validate a request before it indexes the kept tags.
 *
 * @param value Untrusted request data.
 * @returns The request rebuilt from its two fields, or `null`.
 */
export function parseServedScriptTagRequest(value: unknown): ServedScriptTagRequest | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['snapshotId', 'scriptIndex'])) return null;
  const snapshotId = ownValue(value, 'snapshotId');
  const scriptIndex = ownValue(value, 'scriptIndex');
  if (
    !isScriptSnapshotId(snapshotId) ||
    typeof scriptIndex !== 'number' ||
    !Number.isSafeInteger(scriptIndex) ||
    scriptIndex < 0 ||
    scriptIndex >= PAYLOAD_LIMITS.delayScripts.count
  )
    return null;
  return { snapshotId, scriptIndex };
}

/**
 * Answer one ask from the kept tags (content side; no DOM access).
 *
 * @param tags The pass's kept tags, or `null` before/without a processed page.
 * @param snapshotId The live snapshot's identity.
 * @param input Untrusted request data.
 * @returns The reply.
 */
export function readServedScriptTag(
  tags: readonly (ServedScriptTag | null)[] | null,
  snapshotId: string,
  input: unknown
): ServedScriptTagReply {
  const request = parseServedScriptTagRequest(input);
  if (request === null) return { status: 'error', reason: 'invalid-request' };
  if (request.snapshotId !== snapshotId) return { status: 'gone' };
  if (tags === null) return { status: 'error', reason: 'not-ready' };
  if (request.scriptIndex >= tags.length) return { status: 'gone' };
  const kept = tags[request.scriptIndex];
  if (kept === null || kept === undefined) return { status: 'error', reason: 'not-kept' };
  return { status: 'ok', tag: kept.tag, type: kept.type };
}

/**
 * Whether a value is a bounded attribute text (a type) as the producer caps it.
 *
 * @param value The boundary value.
 */
function isCappedAttribute(value: unknown): value is string {
  return typeof value === 'string' && value.length <= SERVED_TAG_ATTRIBUTE_MAX_CHARS + 1;
}

/**
 * Validate a reply at the panel boundary, rebuilding it from known fields.
 *
 * @param value The untrusted transport answer.
 * @returns The reply, or `null` when it breaks the contract (oversize tag,
 *   a tag that is no script tag, wrong types, unknown status or reason).
 */
export function parseServedScriptTagReply(value: unknown): ServedScriptTagReply | null {
  if (!isRecord(value)) return null;
  const status = ownValue(value, 'status');
  if (status === 'gone') return hasOnlyKeys(value, ['status']) ? { status: 'gone' } : null;
  if (status === 'error') {
    const reason = ownValue(value, 'reason');
    return hasOnlyKeys(value, ['status', 'reason']) &&
      SERVED_TAG_ERRORS.includes(reason as ServedScriptTagError)
      ? { status: 'error', reason: reason as ServedScriptTagError }
      : null;
  }
  if (status !== 'ok' || !hasOnlyKeys(value, ['status', 'tag', 'type'])) return null;
  const tag = ownValue(value, 'tag');
  const type = ownValue(value, 'type');
  if (
    typeof tag !== 'string' ||
    tag.length > SERVED_TAG_MAX_CHARS ||
    !tag.startsWith('<script') ||
    !tag.endsWith('>') ||
    (type !== null && !isCappedAttribute(type))
  )
    return null;
  return { status: 'ok', tag, type };
}

/** Why the panel got no usable reply: the transport failed, or the answer broke the contract. */
export type ServedScriptTagReadFailure = 'unreachable' | 'unreadable';

/** What the panel's read yields: the content's reply, or its own read failure. */
export type ServedScriptTagResult =
  ServedScriptTagReply | { readonly status: 'error'; readonly reason: ServedScriptTagReadFailure };

/**
 * Ask for one served tag and validate the answer (panel side). Never throws:
 * a failed read is a result the detail words, logged here with its cause.
 *
 * @param request The snapshot and the script's document position.
 * @param send The bounded transport (rejects on no receiver / timeout).
 * @param log Where a failed read is reported.
 * @returns The validated reply, or `unreachable` / `unreadable`.
 */
export async function loadServedScriptTag(
  request: ServedScriptTagRequest,
  send: (request: ServedScriptTagRequest) => Promise<unknown>,
  log: Pick<Logger, 'warn'>
): Promise<ServedScriptTagResult> {
  let answer: unknown;
  try {
    answer = await send(request);
  } catch (error) {
    log.warn(
      'Reading the served script tag failed',
      error instanceof Error ? error.message : error
    );
    return { status: 'error', reason: 'unreachable' };
  }
  const reply = parseServedScriptTagReply(answer);
  if (reply !== null) return reply;
  log.warn('The served script tag reply broke its contract; it was ignored');
  return { status: 'error', reason: 'unreadable' };
}
