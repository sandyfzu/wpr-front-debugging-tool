/**
 * Transport guard for tab-targeted sends.
 *
 * The messaging library's tab branch resolves its promise through the
 * `chrome.tabs.sendMessage` callback directly, and that callback never reads
 * `chrome.runtime.lastError`. Chromium's binding contract then reports every
 * failed tab send as an "Unchecked runtime.lastError" console error in the
 * calling context — the routine cases being the *expected* ones (a content
 * script not injected yet, a reload mid-send). The guard wraps the send so
 * `lastError` is always read inside the callback while the transport
 * semantics stay untouched: the response (including the empty one) still
 * reaches the original callback, so the library's own no-response rejection
 * keeps working exactly as the protocol doc describes.
 */

import { readLastError } from '../../utils/last-error';
import { createLogger } from '../logger';

const log = createLogger('messaging');

/**
 * Chromium's tab send as this code touches it — structurally, covering both
 * call arities the platform defines (`(tabId, message, callback)` and
 * `(tabId, message, options, callback)`).
 */
export type TabSendMessage = typeof chrome.tabs.sendMessage;

/**
 * The completion callback as the guard forwards it — its one argument is the
 * transport's response, which stays transparent.
 */
type ForwardedCallback = (response: unknown) => void;

/**
 * A narrow predicate over `unknown` arguments: true for the completion
 * callback by arity shape. Declaring the outcome type keeps the invocation
 * below off the bare `Function` type.
 */
function isTransportCallback(value: unknown): value is ForwardedCallback {
  return typeof value === 'function';
}

/**
 * Build the acknowledged-completion wrapper for one callback: reads
 * `runtime.lastError` first (the mechanism), then hands the response through.
 *
 * @param callback The original completion callback.
 */
function acknowledgeAndForward(callback: ForwardedCallback): ForwardedCallback {
  return (response: unknown): void => {
    // The read itself is the guard: evaluating the `lastError` getter marks
    // the send's error acknowledged for the binding. Nothing about the
    // send's resolution may change here — callers branch on the transport's
    // failure surface (see `no-receiver.ts`), and any handling beyond "not
    // noise" belongs there.
    // `readLastError` also folds Firefox's `null` success value: a throw
    // here would strand the send before `callback` ever runs.
    const failure = readLastError(chrome.runtime);
    if (failure !== null) {
      log.debug('Tab send failure acknowledged', { message: failure });
    }
    callback(response);
  };
}

/**
 * Wrap one tab send so its completion callback always reads
 * `runtime.lastError`.
 *
 * @param send The tab send to guard (original, un-wrapped).
 * @returns A drop-in replacement forwarding the same call and response, with
 *   the error read (and debug-logged) inside the callback.
 */
export function preventUncheckedLastError(send: TabSendMessage): TabSendMessage {
  // The delegate signature mirrors both call arities with explicit unknowns —
  // no `Function`-typed value and no parameter guessing on the way through.
  const loose = send as unknown as (
    tabId: number,
    message: unknown,
    third?: unknown,
    fourth?: unknown
  ) => unknown;
  const wrapped = ((tabId: number, message: unknown, third?: unknown, fourth?: unknown) => {
    // Which argument carries the completion callback depends on the arity —
    // the 3-argument call has it in the options slot.
    if (isTransportCallback(third)) {
      return loose(tabId, message, acknowledgeAndForward(third));
    }
    if (isTransportCallback(fourth)) {
      return loose(tabId, message, third, acknowledgeAndForward(fourth));
    }
    // Callback-style only, as the transport defines this path; forward
    // anything unexpected untouched rather than guess its contract.
    return loose(tabId, message, third, fourth);
  }) as TabSendMessage;
  return wrapped;
}
