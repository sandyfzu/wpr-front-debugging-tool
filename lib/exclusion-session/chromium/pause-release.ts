/**
 * The one release of a paused response: fulfilled with a rewritten body,
 * continued as it is, or continued with its `Speculation-Rules` header
 * dropped (`Fetch.continueResponse` — the original body, connection and
 * security state kept; verified on Chromium 156 and Chrome 155). Whichever
 * lands first wins, every later attempt is a no-op; a refused fulfill or
 * header-dropping continue leaves the request held, so the caller (or the
 * fallback here) can still continue it plainly.
 */
import type { Logger } from '../../logger';
import { errorMessage, isAbandonedRequestError, isNotAttachedError } from './debugger-errors';
import { continueWithoutRulesHeaderParams, type PausedRequest } from './paused-request';

/** A paused request's release (see the module doc). */
export interface PauseRelease {
  /** Serve the original response (no-op once released). */
  pass(why: string): Promise<void>;
  /**
   * Serve the original response without its `Speculation-Rules` header —
   * a plain {@link pass} when it has none or the browser refuses.
   */
  passWithoutRulesHeader(why: string, pause: PausedRequest): Promise<void>;
  /** Serve a rewritten body; false when refused (still held). */
  fulfill(params: Record<string, unknown>): Promise<boolean>;
}

/** What a release needs. */
export interface PauseReleaseDeps {
  readonly requestId: string;
  /** The tab, for logs. */
  readonly tabId: number;
  /** Send one release command (already time-boxed by the caller). */
  readonly send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly log: Logger;
}

/** Whether a release failure only means the request is already gone (detached / abandoned). */
function alreadyGone(cause: unknown): boolean {
  return isNotAttachedError(cause) || isAbandonedRequestError(cause);
}

/**
 * Create the release of one paused request.
 *
 * @param deps The request id, the tab, the command sender and the logger.
 */
export function createPauseRelease(deps: PauseReleaseDeps): PauseRelease {
  const { requestId, log } = deps;
  let held = true;

  /** Try one releasing command; false (still held) when it was refused. */
  const attempt = async (method: string, params: Record<string, unknown>): Promise<boolean> => {
    if (!held) return true;
    held = false;
    try {
      await deps.send(method, params);
      return true;
    } catch (cause) {
      const details = { tabId: deps.tabId, method, cause: errorMessage(cause) };
      if (alreadyGone(cause)) {
        // Nothing left to serve (the browser released or dropped it): done.
        log.debug('Paused request already gone (released)', details);
        return true;
      }
      held = true;
      log.warn('Paused-request release refused', details);
      return false;
    }
  };

  const pass = async (why: string): Promise<void> => {
    if (!held) return;
    held = false;
    try {
      await deps.send('Fetch.continueRequest', { requestId });
    } catch (cause) {
      if (alreadyGone(cause))
        log.debug('Paused request already gone (released)', { why, cause: errorMessage(cause) });
      else log.warn('Paused request could not be continued', { why, cause: errorMessage(cause) });
    }
  };

  return {
    pass,
    async passWithoutRulesHeader(why, pause) {
      const params = continueWithoutRulesHeaderParams(pause);
      if (params !== null && (await attempt('Fetch.continueResponse', params))) return;
      await pass(why);
    },
    fulfill: (params) => attempt('Fetch.fulfillRequest', params)
  };
}
