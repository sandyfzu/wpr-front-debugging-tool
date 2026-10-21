/**
 * The exclusion-engine worker (Firefox build only): a classic worker the
 * background page spawns to run one document pipeline per request off its
 * thread, so the host can terminate a runaway row at its budget. Built as
 * an unlisted script so the Chromium package (whose service worker cannot
 * host a `Worker`) never carries it; the whole protocol lives in the
 * shared runner module.
 */
import {
  handleTransformWorkerMessage,
  type TransformWorkerMessage
} from '../lib/exclusion-session/transform-worker';

export default defineUnlistedScript({
  include: ['firefox'],
  main() {
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
  }
});
