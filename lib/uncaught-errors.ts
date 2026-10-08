/**
 * Shared last-line reporting for uncaught `error` and `unhandledrejection`
 * events: the renderer gets real details (message, source location, the
 * error itself) instead of an event wrapper, and host-page errors are never
 * claimed.
 *
 * Why attribution matters: a content script's `window` is shared with the
 * host page, so every uncaught page-script error also fires there. Those are
 * the page's business — its own console reports them natively, and claiming
 * them under our prefix would pollute the extension's error page with spam
 * that reads as ours. Extension-source errors are told apart by URL: our
 * bundles live under the runtime URL, so an event `filename` starting with
 * it (or a rejection stack naming it) means ours. Events that cannot be
 * attributed to us are skipped, not guessed.
 */

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
 * Whether a rejected reason is attributable to our scripts: rejection events
 * carry no `filename`, so attribution falls back to the stack naming our
 * runtime URL — frames raised by our bundle are always listed with it.
 *
 * @param prefix The runtime URL prefix, e.g. `chrome-extension://<id>/`.
 * @param reason The rejection's `reason` value.
 * @returns True only when the reason's stack names one of our script files.
 */
export function isOwnRejectionSource(prefix: string, reason: unknown): boolean {
  return (
    reason instanceof Error && typeof reason.stack === 'string' && reason.stack.includes(prefix)
  );
}

/**
 * Build the `error`-event listener: our-source errors become one line whose
 * message is the failure itself (flat surfaces like the extensions page
 * render strings, never objects — the old `[object ErrorEvent]` line told
 * nothing), with the source location and the raw error as trailing details
 * for consoles that can expand them. Foreign-source events are skipped: the
 * host page reports its own errors natively.
 *
 * @param options The surface logger plus the optional own-source prefix.
 * @returns The listener; register it where cleanup is owned — through the
 *   content-script context in content scripts, directly in the worker scope.
 */
export function onUncaughtError(
  options: UncaughtErrorListenerOptions
): (event: ErrorEvent) => void {
  return (event) => {
    const { log, ownPrefix } = options;
    if (ownPrefix !== undefined && !isOwnScriptSource(ownPrefix, event.filename)) return;
    const cause: unknown = event.error;
    const summary =
      cause instanceof Error
        ? cause.message || String(cause)
        : event.message.trim() !== ''
          ? event.message
          : 'unknown error';
    log.error(
      `Uncaught error: ${summary}`,
      {
        source: event.filename,
        line: event.lineno > 0 ? event.lineno : undefined,
        column: event.colno > 0 ? event.colno : undefined
      },
      cause
    );
  };
}

/**
 * Build the `unhandledrejection` listener, same attribution rule as the
 * error listener's: our-source rejections log the reason's own string form
 * (with the reason itself for stack inspection); foreign ones are skipped —
 * the page's console reports its rejections natively.
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
    const reason: unknown = event.reason;
    if (ownPrefix !== undefined && !isOwnRejectionSource(ownPrefix, reason)) return;
    log.error(
      `Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      reason
    );
  };
}
