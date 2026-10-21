/**
 * The streaming-filter interception row: binds the streaming backend
 * (`lib/exclusion-session/stream-backend`) to `webRequest` — a blocking
 * top-level request hook that attaches the body filter, a blocking
 * response-headers hook for the response facts, and a worker-hosted engine
 * runner that preempts a runaway row. Selected by feature detection of
 * `webRequest.filterResponseData`.
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
import type { DocumentTransformRunner } from '../../lib/exclusion-session/document-transform';
import { URL_PATTERNS } from '../../lib/wp-rocket/constants';

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

/** Whether this browser exposes response-body filtering. */
function supportsStreamFilters(): boolean {
  return 'filterResponseData' in browser.webRequest;
}

/**
 * Spawn the engine worker (bundled as its own file from this exact
 * `new Worker(new URL(…, import.meta.url))` form).
 *
 * @throws {@link Error} when the platform has no `Worker`.
 */
function spawnTransformWorker(): TransformWorkerPort {
  if (typeof Worker !== 'function') throw new Error('Worker is not available here.');
  return new Worker(new URL('./exclusion-transform.worker.ts', import.meta.url), {
    type: 'module'
  }) as unknown as TransformWorkerPort;
}

/**
 * The preempting runner, or undefined (logged) when this background cannot
 * host a worker — the controller then runs the engine in-process.
 *
 * @param log The row's logger.
 */
function workerRunner(log: Logger): DocumentTransformRunner | undefined {
  if (typeof Worker !== 'function') {
    log.warn('No Worker in this background — the engine budget is checked between steps');
    return undefined;
  }
  return createWorkerTransformRunner({ spawn: spawnTransformWorker }).run;
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
      runner: workerRunner(log)
    });
    registerHooks(backend, log);
    return backend;
  }
};
