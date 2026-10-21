/**
 * The inspected page's URL for the support report, read through the
 * DevTools API every panel already holds — no new permission: one
 * `devtools.inspectedWindow.eval('location.href')` in the page's main frame.
 *
 * Two API shapes, feature-detected per call, one evaluation in each: the
 * call always carries a callback that reads `runtime.lastError` first (so
 * the callback form — Chrome — never leaves an unchecked error). An
 * implementation that answers through its return value instead (a
 * promise: the promise-only form) is read from that promise, no wait; one
 * that rejects the callback argument outright (a synchronous throw — a
 * strict promise-only schema) is asked once more without it and read from
 * the returned promise.
 *
 * Best-effort by design: the report is useful without the URL, so every
 * failure (no DevTools namespace — e.g. a panel opened outside DevTools —,
 * a DevTools-side error, a thrown page exception, a non-http(s) or
 * oversized answer, no answer within the timeout) resolves to null, never a
 * throw. The answer is page-derived, so it is validated as an absolute
 * http(s) URL before use.
 */
import { createLogger } from '../../../lib/logger';
import type { LastErrorValue } from '../../../utils/last-error';
import { isHttpUrl } from '../../../utils/urls';

const log = createLogger('panel');

/** How long the eval may take before the report goes out without a URL (ms). */
export const PAGE_URL_TIMEOUT_MS = 1000;

/** The longest URL the report carries (longer answers are dropped, not cut). */
export const PAGE_URL_MAX_LENGTH = 2048;

/** The expression evaluated in the inspected page (a string is valid JSON). */
const EXPRESSION = 'location.href';

/** The eval seam, either shape. */
export interface InspectedEvalApi {
  /**
   * Evaluate one expression in the inspected page's main frame.
   *
   * @param expression The expression.
   * @param callback Receives the result, or an exception description
   *   (callback form; omitted only to retry a promise-only form).
   * @returns A promise in the promise form (Firefox resolves
   *   `[result, exceptionInfo]`; a bare result is accepted too), anything
   *   else in the callback form.
   */
  eval(expression: string, callback?: (result: unknown, exceptionInfo?: unknown) => void): unknown;
}

/**
 * Whether a value is promise-like (the promise form's return).
 *
 * @param value The call's return value.
 * @returns True for a thenable.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Validate one answer as the report's page URL.
 *
 * @param result The eval's result.
 * @returns The URL, or null when it is not a bounded absolute http(s) string.
 */
function acceptUrl(result: unknown): string | null {
  return typeof result === 'string' && result.length <= PAGE_URL_MAX_LENGTH && isHttpUrl(result)
    ? result
    : null;
}

/**
 * Unpack the promise form's settled value: Firefox resolves a
 * `[result, exceptionInfo]` pair; a non-array value is the result itself.
 *
 * @param value The resolved value.
 * @returns The result and the exception description (undefined when none).
 */
function unpackPromiseAnswer(value: unknown): { result: unknown; exceptionInfo: unknown } {
  if (Array.isArray(value)) {
    const pair = value as readonly unknown[];
    return { result: pair[0], exceptionInfo: pair[1] ?? undefined };
  }
  return { result: value, exceptionInfo: undefined };
}

/** The runtime's `lastError` reader (read inside the callback, as the API requires). */
export type LastErrorReader = () => LastErrorValue;

/**
 * Read the inspected page's URL.
 *
 * @param api The eval seam, or null when this context has no DevTools API.
 * @param lastError Reads `runtime.lastError` inside the callback.
 * @param timeoutMs The answer deadline.
 * @returns The validated URL, or null on any failure (see the module doc).
 */
export function readInspectedPageUrl(
  api: InspectedEvalApi | null,
  lastError: LastErrorReader,
  timeoutMs = PAGE_URL_TIMEOUT_MS
): Promise<string | null> {
  if (api === null) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const settle = (url: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(url);
    };
    const timer = setTimeout(() => {
      log.warn('The inspected page URL did not arrive in time; the report omits it', {
        timeoutMs
      });
      settle(null);
    }, timeoutMs);
    /**
     * Settle from one answer, in either shape.
     *
     * @param result The eval's result.
     * @param failure A DevTools-side error or page exception, if any.
     */
    const answer = (result: unknown, failure: unknown): void => {
      if (failure !== undefined && failure !== null) {
        log.warn('Reading the inspected page URL failed; the report omits it', {
          cause: failure
        });
        settle(null);
        return;
      }
      settle(acceptUrl(result));
    };
    /**
     * Read the promise form's answer, when the call returned one.
     *
     * @param returned The call's return value.
     * @returns True when it was a promise (now being read).
     */
    const readPromise = (returned: unknown): boolean => {
      if (!isThenable(returned)) return false;
      returned.then(
        (value) => {
          const { result, exceptionInfo } = unpackPromiseAnswer(value);
          answer(result, exceptionInfo);
        },
        (cause: unknown) => {
          // A rejection is a failure whatever its reason (even an empty one).
          answer(undefined, cause ?? 'rejected');
        }
      );
      return true;
    };
    let returned: unknown;
    try {
      returned = api.eval(EXPRESSION, (result, exceptionInfo) => {
        // Read (and so clear) lastError first: unread, it logs as unchecked.
        const runtimeError = lastError();
        answer(result, runtimeError?.message ?? exceptionInfo);
      });
    } catch {
      // The callback argument itself was refused: ask the promise-only form.
      try {
        if (!readPromise(api.eval(EXPRESSION))) {
          log.warn('The inspected page URL eval answered in no known form; the report omits it');
          settle(null);
        }
      } catch (cause) {
        log.warn('The inspected page URL eval could not start; the report omits it', {
          cause: cause instanceof Error ? { message: cause.message } : cause
        });
        settle(null);
      }
      return;
    }
    // Callback accepted; a promise returned alongside is the answer too
    // (whichever settles first wins — later answers are ignored).
    readPromise(returned);
  });
}

/** The `browser.devtools` namespace as this context may or may not have it. */
interface DevtoolsEval {
  readonly devtools?: { readonly inspectedWindow?: Partial<InspectedEvalApi> };
}

/**
 * The real eval seam, feature-detected (never trusted from the types).
 *
 * @returns The seam, or null outside a DevTools window.
 */
export function realInspectedEvalApi(): InspectedEvalApi | null {
  const inspected = (browser as unknown as DevtoolsEval).devtools?.inspectedWindow;
  const evaluate = inspected?.eval;
  if (inspected === undefined || typeof evaluate !== 'function') return null;
  return {
    // Forward exactly the arguments given: the promise form must be called
    // without a callback to answer through its return value.
    eval: (expression, callback) =>
      callback === undefined
        ? evaluate.call(inspected, expression)
        : evaluate.call(inspected, expression, callback)
  };
}
