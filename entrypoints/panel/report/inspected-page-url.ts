/**
 * The inspected page's URL for the support report, read through the
 * DevTools API every panel already holds — no new permission: one
 * `devtools.inspectedWindow.eval('location.href')` in the page's main frame.
 *
 * Best-effort by design: the report is useful without the URL, so every
 * failure (no DevTools namespace — e.g. a panel opened outside DevTools —,
 * a DevTools-side error, a thrown page exception, a non-http(s) or
 * oversized answer, no answer within the timeout) resolves to null, never a
 * throw. The answer is page-derived, so it is validated as an absolute
 * http(s) URL before use.
 */
import { createLogger } from '../../../lib/logger';
import { isHttpUrl } from '../../../utils/urls';

const log = createLogger('panel');

/** How long the eval may take before the report goes out without a URL (ms). */
export const PAGE_URL_TIMEOUT_MS = 1000;

/** The longest URL the report carries (longer answers are dropped, not cut). */
export const PAGE_URL_MAX_LENGTH = 2048;

/** The expression evaluated in the inspected page (a string is valid JSON). */
const EXPRESSION = 'location.href';

/** The eval seam: the callback form (the promise form needs Chrome 151+). */
export interface InspectedEvalApi {
  /**
   * Evaluate one expression in the inspected page's main frame.
   *
   * @param expression The expression.
   * @param callback Receives the result, or an exception description.
   */
  eval(expression: string, callback: (result: unknown, exceptionInfo?: unknown) => void): void;
}

/** The runtime's `lastError` reader (read inside the callback, as the API requires). */
export type LastErrorReader = () => { readonly message?: string } | undefined;

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
    try {
      api.eval(EXPRESSION, (result, exceptionInfo) => {
        // Read (and so clear) lastError first: unread, it logs as unchecked.
        const runtimeError = lastError();
        if (runtimeError !== undefined || exceptionInfo !== undefined) {
          log.warn('Reading the inspected page URL failed; the report omits it', {
            cause: runtimeError?.message ?? exceptionInfo
          });
          settle(null);
          return;
        }
        settle(
          typeof result === 'string' && result.length <= PAGE_URL_MAX_LENGTH && isHttpUrl(result)
            ? result
            : null
        );
      });
    } catch (cause) {
      log.warn('The inspected page URL eval could not start; the report omits it', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
      settle(null);
    }
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
    eval: (expression, callback) => {
      evaluate.call(inspected, expression, callback);
    }
  };
}
