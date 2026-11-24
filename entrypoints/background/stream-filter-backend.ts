/**
 * The streaming-filter interception row: binds the streaming backend
 * (`lib/exclusion-session/stream-backend`) to `webRequest` — a blocking
 * top-level request hook that attaches the body filter, a blocking
 * response-headers hook for the response facts, completion and error hooks
 * telling whether a body is whole, the worker-hosted engine
 * runner that preempts a runaway row (the only engine this background
 * runs), and a blocking script-request hook
 * redirecting a simulated page's runtime URL to its packaged copy
 * (`lib/exclusion-session/runtime-redirect`) — held only on the tabs whose
 * live session simulates a runtime feature. Selected by feature detection of
 * `webRequest.filterResponseData` and `Worker`: without a worker the row is
 * unsupported, so Apply answers `unsupported-browser` and the page stays
 * unmodified — the engine never runs on this thread.
 */
import { createLogger, type Logger } from '../../lib/logger';
import type { InterceptionBackendRow } from '../../lib/exclusion-session/backend';
import {
  createStreamInterceptionBackend,
  type ResponseStreamFilter,
  type StreamInterceptionBackend
} from '../../lib/exclusion-session/stream-backend';
import {
  createWorkerTransformRunner,
  type TransformWorkerPort
} from '../../lib/exclusion-session/transform-worker';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';
import type { InterceptionHost } from '../../lib/exclusion-session/backend';
import {
  createRuntimeHooks,
  createRuntimeRedirect,
  runtimeRequestPatterns,
  withRuntimeHooks,
  type RuntimeHookEvent,
  type RuntimeHooks
} from '../../lib/exclusion-session/runtime-redirect';

/** The `webRequest` member this row needs (absent from the shared typings). */
interface FilteringWebRequest {
  filterResponseData(requestId: string): ResponseStreamFilter;
}

/**
 * The request filter both hooks use: top-level documents of every web host
 * (a function: nothing of this module runs at load — the Chromium build
 * drops it whole).
 */
function topLevelDocuments(): Parameters<typeof browser.webRequest.onBeforeRequest.addListener>[1] {
  return { urls: [...URL_PATTERNS], types: ['main_frame' as const] };
}

/**
 * Whether this background can run the row: response-body filtering, and a
 * `Worker` to run the engine in (there is no in-thread engine to fall back
 * to).
 */
function supportsStreamFilters(): boolean {
  return 'filterResponseData' in browser.webRequest && typeof Worker === 'function';
}

/**
 * The engine worker's packaged path (the Firefox-only unlisted script
 * `entrypoints/exclusion-transform-worker.ts`).
 */
const TRANSFORM_WORKER_PATH = '/exclusion-transform-worker.js';

/**
 * Spawn the engine worker (a classic worker from the extension's own
 * origin).
 *
 * @throws {@link Error} when the platform has no `Worker`.
 */
function spawnTransformWorker(): TransformWorkerPort {
  if (typeof Worker !== 'function') throw new Error('Worker is not available here.');
  return new Worker(
    browser.runtime.getURL(TRANSFORM_WORKER_PATH)
  ) as unknown as TransformWorkerPort;
}

/**
 * Register the two hooks (synchronously, at background start), each
 * isolated so a failure never breaks the request or a sibling listener.
 *
 * @param backend The backend the hooks feed.
 * @param log The row's logger.
 */
function registerHooks(backend: StreamInterceptionBackend, log: Logger): void {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        backend.requestStarted(details);
      } catch (cause) {
        log.error('Stream request hook failed — document served unmodified', cause);
      }
      return undefined;
    },
    topLevelDocuments(),
    // Blocking: a body filter can only be attached from a blocking hook.
    ['blocking']
  );
  browser.webRequest.onHeadersReceived.addListener(
    (details) => {
      try {
        backend.responseStarted(details);
      } catch (cause) {
        log.error('Stream headers hook failed', cause);
      }
      return undefined;
    },
    topLevelDocuments(),
    // Blocking so the facts are handled before the body reaches the filter
    // (a non-blocking hook was observed to fire after the body ended).
    ['blocking', 'responseHeaders']
  );
  // Non-blocking: a truncated or aborted transfer still ends its filter
  // normally — these tell the stream whether its body is whole.
  browser.webRequest.onErrorOccurred.addListener((details) => {
    try {
      backend.requestFailed(details);
    } catch (cause) {
      log.error('Stream error hook failed', cause);
    }
  }, topLevelDocuments());
  browser.webRequest.onCompleted.addListener((details) => {
    try {
      backend.requestCompleted(details);
    } catch (cause) {
      log.error('Stream completion hook failed', cause);
    }
  }, topLevelDocuments());
}

/**
 * The per-tab simulated-runtime hooks (none held until a session needs
 * one). Blocking, so the redirect lands before the request leaves; the
 * event is `webRequest.onBeforeRequest` as Firefox implements it — a
 * blocking listener may answer with a promise (absent from the shared
 * typings, which describe Chrome's synchronous form).
 *
 * @param host The host naming the packaged file for a request.
 * @param log The row's logger.
 */
function runtimeHooks(host: Pick<InterceptionHost, 'simulatedRuntime'>, log: Logger): RuntimeHooks {
  return createRuntimeHooks({
    event: browser.webRequest.onBeforeRequest as unknown as RuntimeHookEvent,
    urls: runtimeRequestPatterns(URL_PATTERNS),
    hook: createRuntimeRedirect({ host, log }),
    log
  });
}

/** The registry row. */
export const STREAM_FILTER_BACKEND: InterceptionBackendRow = {
  id: 'stream-filter',
  isSupported: supportsStreamFilters,
  create(host) {
    const log = createLogger('exclusion-stream');
    const webRequest = browser.webRequest as unknown as FilteringWebRequest;
    const backend = createStreamInterceptionBackend({
      host,
      openFilter: (requestId) => webRequest.filterResponseData(requestId),
      log,
      runner: createWorkerTransformRunner({ spawn: spawnTransformWorker }).run
    });
    registerHooks(backend, log);
    return withRuntimeHooks(backend, runtimeHooks(host, log));
  }
};
