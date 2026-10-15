/**
 * The message contract between `CodeBlock`'s main-thread client and the
 * highlight worker — shiki-free, shared by both ends, plus the worker's
 * request handler as a pure function of an injected highlighter (the worker
 * entry only wires it to `self`; tests run it against the real highlighter).
 */
import { CODE_BLOCK_LANGS, type CodeLanguage } from './code-block-langs';
import { isTokenStyle, type TokenStyle } from './code-block-token-styles';

/** Highlight one block. `id` matches the answer to its request. */
export interface HighlightRequest {
  readonly id: number;
  readonly code: string;
  readonly lang: CodeLanguage;
}

/** A highlighted block: class-tagged markup plus its token classes. */
export interface HighlightedBlock {
  readonly html: string;
  readonly styles: readonly TokenStyle[];
}

/** The worker's answer: the highlighted block, or why there is none. */
export type HighlightResponse =
  ({ readonly id: number } & HighlightedBlock) | { readonly id: number; readonly error: string };

/** The highlighting surface the handler needs (the shiki loader's shape). */
export interface WorkerHighlighter {
  highlight: (code: string, options: { lang: CodeLanguage }) => HighlightedBlock;
}

/** Whether a value is a request/response id (a positive safe integer). */
function isId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * Whether a message is a well-formed request (messages cross a thread
 * boundary; anything else is dropped).
 *
 * @param data The received message data.
 */
export function isHighlightRequest(data: unknown): data is HighlightRequest {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return (
    isId(record['id']) &&
    typeof record['code'] === 'string' &&
    (CODE_BLOCK_LANGS as readonly unknown[]).includes(record['lang'])
  );
}

/**
 * Whether a message is a well-formed response.
 *
 * @param data The received message data.
 */
export function isHighlightResponse(data: unknown): data is HighlightResponse {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  if (!isId(record['id'])) return false;
  if (typeof record['error'] === 'string') return record['html'] === undefined;
  return (
    typeof record['html'] === 'string' &&
    Array.isArray(record['styles']) &&
    record['styles'].every(isTokenStyle)
  );
}

/**
 * Answer one request: highlight the whole block, or report the failure (the
 * client renders plain text either way it fails).
 *
 * @param load Resolves the highlighter (loaded once, on the first request).
 * @param request The request.
 * @returns The response to post back.
 */
export async function answerHighlight(
  load: () => Promise<WorkerHighlighter>,
  request: HighlightRequest
): Promise<HighlightResponse> {
  try {
    const highlighter = await load();
    const block = highlighter.highlight(request.code, { lang: request.lang });
    return { id: request.id, html: block.html, styles: block.styles };
  } catch (error: unknown) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}
