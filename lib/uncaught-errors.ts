/**
 * Shared last-line reporting for uncaught `error` and `unhandledrejection`
 * events: the renderer gets real details (message, source location, the
 * error itself, the throw site's frames) instead of an event wrapper, and
 * host-page errors are never claimed.
 *
 * Why attribution matters: a content script's `window` is shared with the
 * host page, so every uncaught page-script error also fires there. Those are
 * the page's business — its own console reports them natively, and claiming
 * them under our prefix would pollute the extension's error page with spam
 * that reads as ours. Extension-source errors are told apart by URL: our
 * bundles live under the runtime URL, so an event `filename` starting with
 * it (or a rejection stack naming it) means ours. Events that cannot be
 * attributed to us are skipped, not guessed.
 *
 * Why a claimed event is cancelled (`preventDefault`): the extensions error
 * page files our console.error lines as entries, and the browser ALSO files
 * its native "Uncaught …"/"Uncaught (in promise)" record for the same
 * failure — one error read as two entries and doubled the card's error
 * count. Claiming an event takes over its reporting, so the native record
 * is cancelled and the throw site's frames ride along as a text detail
 * (flat surfaces render strings, never objects).
 *
 * Why both listener bodies are guarded: the event payloads are cross-world
 * readable DOM data, so a hostile host page can attach values whose getters
 * throw (`stack`, `message`, string coercion). The last line must never
 * throw out or claim-without-reporting — a failing report degrades to one
 * plain line about the report itself.
 *
 * Why a dead-context error is claimed but not an error line: after an
 * extension reload the old world's teardown can still touch `browser.*` and
 * throw "Extension context invalidated" (see `dead-context`). That is the
 * expected end of the world, not a failure, and an error line would be red
 * noise on the site being debugged — so it is cancelled and logged at debug
 * (silent in production). Backstop only: teardown itself is guarded.
 *
 * Why the resize-observer loop notice is not an error: browsers fire it as a
 * script-less `error` event (no `error` object, no source) whenever an
 * observer's callback changes an observed size within the same frame; the
 * pending notifications simply arrive one frame later. Claiming it filled
 * consoles with "Uncaught error" lines for nothing that failed.
 */

import { isDeadContextError } from './dead-context';
import type { Logger } from './logger';

/** Options for the two listener factories below. */
export interface UncaughtErrorListenerOptions {
  /** The surface's logger; its tag renders on every reported line. */
  log: Logger;
  /**
   * The extension's runtime URL prefix (`browser.runtime.getURL('')`).
   * Errors sourced outside it are skipped as host-page noise. Omit in
   * exclusive contexts (the service worker): every error there is ours.
   */
  ownPrefix?: string;
}

/**
 * Whether a script URL belongs to our extension: the runtime URL prefix
 * (trailing slash included) is the only marker the browser reliably puts on
 * an error event's `filename`.
 *
 * @param prefix The runtime URL prefix, e.g. `chrome-extension://<id>/`.
 * @param url The event's `filename`; empty/undefined for inline scripts.
 * @returns True only when the error was raised by one of our script files.
 */
export function isOwnScriptSource(prefix: string, url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith(prefix);
}

/**
 * The message browsers (Gecko and Blink alike) give the `error` event they
 * fire when resize-observer notifications are deferred to the next frame.
 */
export const RESIZE_OBSERVER_LOOP_MESSAGE =
  'ResizeObserver loop completed with undelivered notifications.';

/**
 * Whether an `error` event is the browser's benign resize-observer loop
 * notice: exactly its message and no thrown value (a script throwing that
 * text still carries one and stays reportable).
 *
 * @param event The `error` event, or any object carrying its two fields.
 * @returns True only for the notice itself.
 */
export function isResizeObserverLoopNotice(event: Pick<ErrorEvent, 'message' | 'error'>): boolean {
  return event.message === RESIZE_OBSERVER_LOOP_MESSAGE && (event.error as unknown) == null;
}

/**
 * The error's stack, hostile-getter safe: cross-world payloads can carry a
 * throwing `stack` getter, and one read feeds both rejection attribution
 * and the pass-along detail, so repeated access can never disagree.
 *
 * @param error The object whose stack is read (if it has one at all).
 * @returns The stack only when it is a string; undefined otherwise.
 */
function readErrorStack(error: unknown): string | undefined {
  try {
    const stack = error instanceof Error ? error.stack : undefined;
    return typeof stack === 'string' ? stack : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build the `error`-event listener: our-source errors become one line whose
 * message is the failure itself (flat surfaces like the extensions page
 * render strings, never objects — the old `[object ErrorEvent]` line told
 * nothing), with the source location, the raw error and its stack as
 * trailing details for consoles that can expand them. Claimed events are
 * cancelled (the native record would double ours). Foreign-source events
 * are skipped untouched: the host page reports its own errors natively. The
 * resize-observer loop notice ({@link isResizeObserverLoopNotice}) is never
 * claimed: one debug line per listener, then silence. A dead-context error
 * ({@link isDeadContextError}) is claimed and logged at debug only.
 *
 * @param options The surface logger plus the optional own-source prefix.
 * @returns The listener; register it where cleanup is owned — through the
 *   content-script context in content scripts, directly in the worker scope.
 */
export function onUncaughtError(
  options: UncaughtErrorListenerOptions
): (event: ErrorEvent) => void {
  let loopNoticeSeen = false;
  return (event) => {
    const { log, ownPrefix } = options;
    try {
      if (ownPrefix !== undefined && !isOwnScriptSource(ownPrefix, event.filename)) return;
      if (isResizeObserverLoopNotice(event)) {
        if (!loopNoticeSeen) {
          loopNoticeSeen = true;
          log.debug('Resize observer notifications deferred a frame (benign; logged once)');
        }
        return;
      }
      event.preventDefault();
      const cause: unknown = event.error;
      if (isDeadContextError(cause)) {
        log.debug('Uncaught dead-context error after an extension reload (expected)', cause);
        return;
      }
      const summary =
        cause instanceof Error
          ? cause.message || String(cause)
          : event.message.trim() !== ''
            ? event.message
            : 'unknown error';
      const details: unknown[] = [
        {
          source: event.filename,
          line: event.lineno > 0 ? event.lineno : undefined,
          column: event.colno > 0 ? event.colno : undefined
        },
        cause
      ];
      const stack = readErrorStack(cause);
      if (stack !== undefined) details.push(stack);
      log.error(`Uncaught error: ${summary}`, ...details);
    } catch (failure) {
      // The last line never throws, and a claim must never go unreported:
      // a hostile event payload degrades to one plain line about itself.
      log.error(
        `Uncaught error report failed: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
  };
}

/**
 * Build the `unhandledrejection` listener, same attribution rule as the
 * error listener's: our-source rejections log the reason's own string form
 * plus its stack (the frames the cancelled native record carried); foreign
 * ones are skipped untouched — the page's console reports its rejections
 * natively. Dead-context reasons are claimed and logged at debug only.
 *
 * @param options The surface logger plus the optional own-source prefix.
 * @returns The listener; register it where cleanup is owned, like
 *   {@link onUncaughtError}.
 */
export function onUnhandledRejection(
  options: UncaughtErrorListenerOptions
): (event: PromiseRejectionEvent) => void {
  return (event) => {
    const { log, ownPrefix } = options;
    try {
      const reason: unknown = event.reason;
      const stack = readErrorStack(reason);
      if (ownPrefix !== undefined && (stack === undefined || !stack.includes(ownPrefix))) return;
      event.preventDefault();
      if (isDeadContextError(reason)) {
        log.debug('Unhandled dead-context rejection after an extension reload (expected)', reason);
        return;
      }
      const details: unknown[] = [reason];
      if (stack !== undefined) details.push(stack);
      // Same summary form as the error listener: an own-name fallback for
      // empty-message reasons ('Unhandled promise rejection: Error').
      log.error(
        `Unhandled promise rejection: ${
          reason instanceof Error ? reason.message || String(reason) : String(reason)
        }`,
        ...details
      );
    } catch (failure) {
      // Same contract as the error listener: one plain, honest line.
      log.error(
        `Unhandled rejection report failed: ${failure instanceof Error ? failure.message : String(failure)}`
      );
    }
  };
}
