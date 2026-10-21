/**
 * The exclusion-engine worker: runs one document pipeline per request off
 * the background's thread, so the host can terminate a runaway row at its
 * budget. The whole protocol lives in the shared runner module.
 */
import {
  handleTransformWorkerMessage,
  type TransformWorkerMessage
} from '../../lib/exclusion-session/transform-worker';

/** The worker global, typed by what this entry uses. */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: TransformWorkerMessage) => void;
};

scope.onmessage = (event: MessageEvent): void => {
  // Malformed requests are dropped inside; the host's deadline answers them.
  handleTransformWorkerMessage(event.data, (message) => {
    scope.postMessage(message);
  });
};
