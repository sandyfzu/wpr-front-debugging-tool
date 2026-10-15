/**
 * The highlight worker: shiki runs here, off the main thread, so no code
 * shape can freeze the panel — the client times each block out and
 * terminates this worker when one runs too long. Requests are answered in
 * arrival order (the client sends one at a time).
 */
import { getHighlighter } from './code-block-highlighter';
import { answerHighlight, isHighlightRequest } from './code-block-worker-protocol';

/** The worker global, typed by what this entry uses. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = (event: MessageEvent): void => {
  const data: unknown = event.data;
  // Malformed messages have no id to answer; the client times them out.
  if (!isHighlightRequest(data)) return;
  void answerHighlight(getHighlighter, data).then((response) => {
    scope.postMessage(response);
  });
};
