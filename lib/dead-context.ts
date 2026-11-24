/**
 * Dead extension context: what a content script's teardown meets after an
 * extension reload or update. The page keeps the old isolated world, but
 * every `browser.*` touch there (a storage watch remover, a message
 * listener's removal) throws "Extension context invalidated". Teardown runs
 * exactly then — the context invalidates because the extension went away —
 * so such a throw is the expected end state, not a failure: nothing is left
 * to release (the browser dropped those listeners with the context). Left
 * uncaught it escapes the invalidation's abort listener into the host
 * page's `error` event and prints a red line on the site being debugged.
 */
import type { Logger } from './logger';

/**
 * The text Chromium puts on every API error raised from a dead context
 * (message `Extension context invalidated.`); matched as a substring so the
 * trailing period or a wrapper's prefix cannot defeat it.
 */
export const DEAD_CONTEXT_MESSAGE = 'Extension context invalidated';

/**
 * Whether `error` is the dead-context API error, hostile-getter safe (a
 * throwing `message` getter reads as "not dead": the caller then reports it).
 *
 * @param error Any thrown value or rejection reason.
 * @returns True only for an `Error` whose message names the dead context.
 */
export function isDeadContextError(error: unknown): boolean {
  try {
    return error instanceof Error && error.message.includes(DEAD_CONTEXT_MESSAGE);
  } catch {
    return false;
  }
}

/**
 * Report one teardown failure by kind: a dead context is one debug line
 * (silent in production, never page console noise); anything else is a real
 * defect in our cleanup, logged at `severity` with the cause. The single
 * classifying site for every teardown catch, the guard's and the modules'
 * own (which keep their message and level for real failures).
 *
 * @param log The surface logger.
 * @param cause The thrown value or rejection reason.
 * @param failure The line naming what failed (e.g. "Stopping X failed during teardown").
 * @param severity The level for a real failure (default `error`).
 */
export function reportTeardownFailure(
  log: Pick<Logger, 'debug' | 'warn' | 'error'>,
  cause: unknown,
  failure: string,
  severity: 'warn' | 'error' = 'error'
): void {
  if (isDeadContextError(cause)) {
    log.debug(`${failure}: the extension context is gone (expected after a reload)`);
    return;
  }
  log[severity](failure, cause);
}

/** The guard's line for a failing teardown step it ran. */
const GUARDED_STEP_FAILURE = 'A teardown step failed while the content script was invalidated';

/**
 * Run one cleanup so nothing escapes it: a sync throw or an async rejection
 * is classified by {@link reportTeardownFailure}. Each cleanup is its own
 * abort listener, so a failing one never stops its siblings either way.
 *
 * @param cleanup The teardown step (sync, or returning a promise).
 * @param log The surface logger.
 */
export function runTeardown(cleanup: () => unknown, log: Logger): void {
  try {
    const result = cleanup();
    if (result instanceof Promise) {
      result.catch((cause: unknown) => {
        reportTeardownFailure(log, cause, GUARDED_STEP_FAILURE);
      });
    }
  } catch (cause) {
    reportTeardownFailure(log, cause, GUARDED_STEP_FAILURE);
  }
}

/** The part of WXT's content-script context the guard wraps. */
export interface InvalidationHost {
  /** Registers a cleanup for the invalidation; returns its removal. */
  onInvalidated(cleanup: () => void): () => void;
}

/**
 * Route every cleanup later registered on `ctx` through {@link runTeardown}.
 * Installed once at the top of a content script's `main`, before any
 * feature registers: wrapping the context (instead of each call site)
 * covers every teardown — the features', the helpers' that receive the
 * context, and WXT's own timer clears — and every future one, so a new
 * `ctx.onInvalidated(store.watch(...))` cannot reintroduce the page error.
 * The returned removal still removes the registered (wrapped) cleanup.
 *
 * @param ctx The content script's context (mutated: its `onInvalidated`).
 * @param log The surface logger teardown failures are reported to.
 */
export function guardInvalidationTeardown(ctx: InvalidationHost, log: Logger): void {
  const register = ctx.onInvalidated.bind(ctx);
  ctx.onInvalidated = (cleanup) =>
    register(() => {
      runTeardown(cleanup, log);
    });
}
