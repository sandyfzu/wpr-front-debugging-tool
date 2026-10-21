/**
 * The streaming interception backend: rewrites a tab's top-level documents
 * through a per-response body filter (the browser streams the decoded body
 * to the extension, which must write it back and end the filter). Browser-
 * agnostic over injected ports — the background binds `openFilter` and the
 * two request hooks to the real `webRequest` API.
 *
 * - **Synchronous gate.** Whether a request gets a filter is decided from
 *   an in-memory armed-tab table, synchronously in the request hook: no
 *   navigation of an unarmed tab ever waits on storage. Arming, resuming
 *   and disarming only edit that table (so the latest call always wins),
 *   and every armed tab's document is checked by the host anyway (origin,
 *   eligibility, live session) — an unwanted document is written through.
 * - **One machine per response** (`./stream-machine`): this module only
 *   performs its effects; every filter is ended exactly once on every path.
 * - **Response facts** (status, method, content type) come from the
 *   response-headers hook, correlated by request id; a redirect re-enters
 *   the request hook with the same id, superseding the earlier filter.
 * - **No browser-initiated end.** A table entry lives as long as the
 *   background that holds it; a restarted background has an empty table,
 *   so `resume` reports every stored session stale (served unmodified).
 */
import type { Logger } from '../logger';
import { scheduleWithTimeout, type ScheduleTimer } from '../messaging/bounded-ask';
import type { ArmResult, InterceptionBackend, InterceptionHost } from './backend';
import type { DocumentTransformRunner, InterceptedResponseFacts } from './document-transform';
import {
  OPENING_STREAM,
  streamTransition,
  type StreamDeadline,
  type StreamEffect,
  type StreamEvent,
  type StreamState
} from './stream-machine';
import { INTERCEPTION_HOST_BOUNDS_MS } from './timeouts';

/**
 * How long a stream waits past its body's end for the response facts (ms)
 * before writing it through — the facts hook normally runs before the body
 * starts (verified in Firefox with a blocking headers listener).
 */
export const STREAM_FACTS_WAIT_MS = 1_000;

/** How far the stream's own release deadline sits past the host's rewrite bound (ms). */
export const STREAM_RELEASE_MARGIN_MS = 500;

/**
 * The deadline of a stream's wait (ms). `release` — the stream's own
 * release deadline: past the host's rewrite bound (plus a margin), the
 * original bytes are written through whatever the host still does.
 * (A function, not a constant: nothing of this module runs at load.)
 *
 * @param wait Which wait.
 */
export function streamDeadlineMs(wait: StreamDeadline): number {
  return wait === 'facts'
    ? STREAM_FACTS_WAIT_MS
    : INTERCEPTION_HOST_BOUNDS_MS.rewriteDocument + STREAM_RELEASE_MARGIN_MS;
}

/** The filter surface the backend drives (a `StreamFilter`, or a test shim). */
export interface ResponseStreamFilter {
  onstart: ((event: unknown) => void) | null;
  ondata: ((event: { readonly data: ArrayBuffer }) => void) | null;
  onstop: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  /** The failure description once `onerror` fired. */
  readonly error: string;
  write(data: Uint8Array): void;
  close(): void;
  disconnect(): void;
}

/** A top-level request about to start (the request hook's details). */
export interface StreamRequestDetails {
  readonly requestId: string;
  readonly tabId: number;
  readonly url: string;
}

/** One response header. */
export interface StreamResponseHeader {
  readonly name: string;
  readonly value?: string | undefined;
}

/** A top-level response's headers (the response-headers hook's details). */
export interface StreamResponseDetails {
  readonly requestId: string;
  readonly tabId: number;
  readonly statusCode: number;
  readonly method: string;
  readonly responseHeaders?: readonly StreamResponseHeader[] | undefined;
}

/** What the streaming backend is built from. */
export interface StreamBackendDeps {
  readonly host: InterceptionHost;
  /** Attach a filter to a request (throws when it cannot). */
  readonly openFilter: (requestId: string) => ResponseStreamFilter;
  readonly log: Logger;
  /** A preempting engine runner; absent → the controller's in-process one. */
  readonly runner?: DocumentTransformRunner | undefined;
  /** Timer seam; defaults to `setTimeout`. */
  readonly schedule?: ScheduleTimer;
}

/** The backend plus the two request hooks the background registers. */
export interface StreamInterceptionBackend extends InterceptionBackend {
  /** A top-level request starts (call synchronously from the blocking request hook). */
  requestStarted(details: StreamRequestDetails): void;
  /** A top-level response's headers arrived. */
  responseStarted(details: StreamResponseDetails): void;
}

/** One filtered response in flight. */
interface LiveStream {
  readonly requestId: string;
  readonly tabId: number;
  readonly url: string;
  readonly filter: ResponseStreamFilter;
  state: StreamState;
  cancelDeadline: (() => void) | null;
}

/**
 * The response's `Content-Type` (several headers joined with `, `), or null.
 *
 * @param headers The response headers, when listed.
 */
export function responseContentType(
  headers: readonly StreamResponseHeader[] | undefined
): string | null {
  const values = (headers ?? [])
    .filter((header) => header.name.toLowerCase() === 'content-type')
    .map((header) => header.value)
    .filter((value): value is string => value !== undefined);
  return values.length === 0 ? null : values.join(', ');
}

/**
 * The facts a response-headers hook carries.
 *
 * @param details The hook's details.
 */
export function responseFacts(details: StreamResponseDetails): InterceptedResponseFacts {
  return {
    status: details.statusCode,
    method: details.method,
    contentType: responseContentType(details.responseHeaders)
  };
}

/**
 * Create the streaming backend.
 *
 * @param deps The host, the filter port, the log, the runner and timers.
 */
export function createStreamInterceptionBackend(
  deps: StreamBackendDeps
): StreamInterceptionBackend {
  const { host, log } = deps;
  const schedule = deps.schedule ?? scheduleWithTimeout;
  /** Armed tabs → the generation they were armed or resumed with. */
  const armed = new Map<number, number>();
  /** Filtered responses in flight, by request id. */
  const streams = new Map<string, LiveStream>();

  /** Write chunks in order; stop at the first failure (the filter is gone). */
  const write = (stream: LiveStream, chunks: readonly Uint8Array[]): void => {
    for (const chunk of chunks) {
      try {
        stream.filter.write(chunk);
      } catch (cause) {
        log.warn('Stream write failed', { requestId: stream.requestId, cause });
        return;
      }
    }
  };

  /** End the filter (the machine emits this once per stream). */
  const end = (stream: LiveStream, how: 'close' | 'disconnect'): void => {
    try {
      if (how === 'close') stream.filter.close();
      else stream.filter.disconnect();
    } catch (cause) {
      log.warn('Stream end failed', { requestId: stream.requestId, how, cause });
    }
  };

  /** Ask the host whether the session wants the document. */
  const askGate = (stream: LiveStream): void => {
    host.shouldIntercept(stream.tabId, stream.url).then(
      (allowed) => {
        dispatch(stream, { type: 'gate', allowed });
      },
      (cause: unknown) => {
        // The host never rejects; a rejection keeps buffering (the rewrite re-gates).
        log.error('Stream gate failed', { requestId: stream.requestId, cause });
      }
    );
  };

  /** Hand the complete body to the host. */
  const askRewrite = (
    stream: LiveStream,
    body: Uint8Array,
    facts: InterceptedResponseFacts
  ): void => {
    host.rewriteDocument({ tabId: stream.tabId, documentUrl: stream.url, body, ...facts }).then(
      (rewritten) => {
        dispatch(stream, { type: 'rewritten', body: rewritten });
      },
      (cause: unknown) => {
        log.error('Stream rewrite failed — document served unmodified', {
          requestId: stream.requestId,
          cause
        });
        dispatch(stream, { type: 'rewritten', body: null });
      }
    );
  };

  /** (Re)arm the stream's deadline. */
  const armDeadline = (stream: LiveStream, wait: StreamDeadline): void => {
    stream.cancelDeadline?.();
    stream.cancelDeadline = schedule(() => {
      stream.cancelDeadline = null;
      if (wait === 'release') {
        log.warn('Stream rewrite missed its deadline — document served unmodified', {
          requestId: stream.requestId
        });
      }
      dispatch(stream, { type: 'deadline' });
    }, streamDeadlineMs(wait));
  };

  /** Perform one machine effect. */
  const perform = (stream: LiveStream, effect: StreamEffect): void => {
    switch (effect.type) {
      case 'write':
        write(stream, effect.chunks);
        return;
      case 'end':
        end(stream, effect.how);
        return;
      case 'ask-gate':
        askGate(stream);
        return;
      case 'ask-rewrite':
        askRewrite(stream, effect.body, effect.facts);
        return;
      case 'report-unavailable':
        void host.documentBodyUnavailable(stream.tabId, stream.url).catch((cause: unknown) => {
          log.error('Stream unavailable report failed', { requestId: stream.requestId, cause });
        });
        return;
      case 'arm-deadline':
        armDeadline(stream, effect.wait);
        return;
    }
  };

  /** Feed one event through the stream's machine and perform its effects. */
  function dispatch(stream: LiveStream, event: StreamEvent): void {
    const next = streamTransition(stream.state, event);
    stream.state = next.state;
    for (const effect of next.effects) {
      // Each effect isolated: a fault in one never skips the next (e.g. the
      // deadline that still releases the body).
      try {
        perform(stream, effect);
      } catch (cause) {
        log.error('Stream effect failed', {
          requestId: stream.requestId,
          effect: effect.type,
          cause
        });
      }
    }
    // A withdrawn stream leaves the table at once (one not started yet ends
    // at its start — its callbacks hold it; no facts are needed any more).
    const finished = next.state.phase === 'done';
    if ((finished || event.type === 'abort') && streams.get(stream.requestId) === stream) {
      streams.delete(stream.requestId);
    }
    if (!finished) return;
    stream.cancelDeadline?.();
    stream.cancelDeadline = null;
  }

  /** Run a filter callback isolated: one failing handler never breaks the stream's others. */
  const guarded =
    (stream: LiveStream, toEvent: (event: unknown) => StreamEvent) =>
    (event: unknown): void => {
      try {
        dispatch(stream, toEvent(event));
      } catch (cause) {
        log.error('Stream event handling failed', { requestId: stream.requestId, cause });
      }
    };

  /** Wire a fresh filter's callbacks to its stream. */
  const wire = (stream: LiveStream): void => {
    const { filter } = stream;
    filter.onstart = guarded(stream, () => ({ type: 'start' }));
    filter.ondata = guarded(stream, (event) => ({
      type: 'data',
      chunk: new Uint8Array((event as { data: ArrayBuffer }).data)
    }));
    filter.onstop = guarded(stream, () => ({ type: 'stop' }));
    filter.onerror = guarded(stream, () => {
      // Expected for a redirected response (its filter is invalidated);
      // an eligible document's failure is recorded by the machine's report.
      log.debug('Stream filter failed', { requestId: stream.requestId, error: filter.error });
      return { type: 'error' };
    });
  };

  /** Withdraw every in-flight stream of a tab (each writes its bytes through). */
  const abortTab = (tabId: number): void => {
    for (const stream of [...streams.values()]) {
      if (stream.tabId === tabId) dispatch(stream, { type: 'abort' });
    }
  };

  /** Tag the tab with `generation`; a different earlier one's streams are withdrawn. */
  const tag = (tabId: number, generation: number): void => {
    const previous = armed.get(tabId);
    armed.set(tabId, generation);
    if (previous !== undefined && previous !== generation) abortTab(tabId);
  };

  return {
    runner: deps.runner,

    arm(tabId, generation): Promise<ArmResult> {
      tag(tabId, generation);
      return Promise.resolve({ armed: true });
    },

    disarm(tabId): Promise<void> {
      armed.delete(tabId);
      abortTab(tabId);
      return Promise.resolve();
    },

    resume(tabId, generation): Promise<boolean> {
      if (!armed.has(tabId)) return Promise.resolve(false);
      tag(tabId, generation);
      return Promise.resolve(true);
    },

    requestStarted(details) {
      if (!armed.has(details.tabId)) return;
      const superseded = streams.get(details.requestId);
      // A redirect re-enters with the same id: the earlier filter is withdrawn.
      if (superseded !== undefined) dispatch(superseded, { type: 'abort' });
      let filter: ResponseStreamFilter;
      try {
        filter = deps.openFilter(details.requestId);
      } catch (cause) {
        log.error('Stream filter unavailable — document served unmodified', {
          tabId: details.tabId,
          cause
        });
        return;
      }
      const stream: LiveStream = {
        requestId: details.requestId,
        tabId: details.tabId,
        url: details.url,
        filter,
        state: OPENING_STREAM,
        cancelDeadline: null
      };
      streams.set(details.requestId, stream);
      wire(stream);
    },

    responseStarted(details) {
      const stream = streams.get(details.requestId);
      if (stream === undefined || stream.tabId !== details.tabId) return;
      dispatch(stream, { type: 'facts', facts: responseFacts(details) });
    }
  };
}
