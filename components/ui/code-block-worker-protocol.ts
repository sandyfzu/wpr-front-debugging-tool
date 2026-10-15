/**
 * The message contract between `CodeBlock`'s main-thread client and the
 * highlight worker — shiki-free, shared by both ends, plus the worker's
 * request handler as a pure function of an injected highlighter (the worker
 * entry only wires it to `self`; tests run it against the real highlighter).
 */
import type { CodeLanguage } from './code-block-langs';

/** Highlight one block. `id` matches the answer to its request. */
export interface HighlightRequest {
  readonly id: number;
  readonly code: string;
  readonly lang: CodeLanguage;
}

/** The worker's answer: the highlighted `<pre>` HTML, or why there is none. */
export type HighlightResponse =
  { readonly id: number; readonly html: string } | { readonly id: number; readonly error: string };

/** The highlighting surface the handler needs (the shiki loader's shape). */
export interface WorkerHighlighter {
  highlight: (code: string, options: { lang: CodeLanguage }) => string;
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
    typeof record['id'] === 'number' &&
    typeof record['code'] === 'string' &&
    (record['lang'] === 'javascript' || record['lang'] === 'json')
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
  return (
    typeof record['id'] === 'number' &&
    (typeof record['html'] === 'string' || typeof record['error'] === 'string')
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
    return { id: request.id, html: highlighter.highlight(request.code, { lang: request.lang }) };
  } catch (error: unknown) {
    return { id: request.id, error: error instanceof Error ? error.message : String(error) };
  }
}
