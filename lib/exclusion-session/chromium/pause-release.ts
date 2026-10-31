/**
 * The one release of a paused response: fulfilled with a rewritten body,
 * continued as it is, or continued with its `Speculation-Rules` header
 * dropped (`Fetch.continueResponse` — the original body, connection and
 * security state kept; verified on Chromium 156 and Chrome 155). Whichever
 * lands first wins, every later attempt is a no-op; a refused fulfill or
 * header-dropping continue leaves the request held, so the caller (or the
 * fallback here) can still continue it plainly.
 *
 * A release marked as a session tab's top-frame page logs its pass once,
 * at info level, with why — the page's address as origin + path only.
 */
import type { Logger } from '../../logger';
import { errorMessage, isAbandonedRequestError, isNotAttachedError } from './debugger-errors';
import { continueWithoutRulesHeaderParams, type PausedRequest } from './paused-request';
import { parseUrl } from '../../../utils/urls';

/** A paused request's release (see the module doc). */
export interface PauseRelease {
  /**
   * Mark the paused response as a session tab's top-frame page: its pass
   * (if it is passed) is then logged.
   *
   * @param url The page's URL (logged as origin + path).
   */
  markSessionPage(url: string): void;
  /** Serve the original response (no-op once released). */
  pass(why: string): Promise<void>;
  /**
   * Serve the original response without its `Speculation-Rules` header —
   * a plain {@link pass} when it has none or the browser refuses.
   */
  passWithoutRulesHeader(why: string, pause: PausedRequest): Promise<void>;
  /**
   * Serve a rewritten body: `fulfilled`, `refused` (still held — continue
   * it), or `gone` (the browser had already dropped the request: nothing
   * was served by this release).
   */
  fulfill(params: Record<string, unknown>): Promise<FulfillResult>;
}

/** What a fulfill attempt came to (see {@link PauseRelease.fulfill}). */
export type FulfillResult = 'fulfilled' | 'refused' | 'gone';

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
 * A page's address for a log line: origin + path, never the query or
 * fragment (they may carry tokens).
 *
 * @param url The page's URL.
 */
export function pageAddress(url: string): string {
  const parsed = parseUrl(url);
  return parsed === null ? '(unparsable URL)' : `${parsed.origin}${parsed.pathname}`;
}

/**
 * Create the release of one paused request.
 *
 * @param deps The request id, the tab, the command sender and the logger.
 */
export function createPauseRelease(deps: PauseReleaseDeps): PauseRelease {
  const { requestId, log } = deps;
  let held = true;
  /** The marked session page's address (origin + path), or null. */
  let sessionPage: string | null = null;

  /** Log a marked page's pass (once: a release passes at most once). */
  const logPass = (why: string): void => {
    if (sessionPage !== null)
      log.info('Session page served as received', { tabId: deps.tabId, why, page: sessionPage });
  };

  /** Try one releasing command (a no-op once released). */
  const attempt = async (
    method: string,
    params: Record<string, unknown>
  ): Promise<FulfillResult | 'released'> => {
    if (!held) return 'released';
    held = false;
    try {
      await deps.send(method, params);
      return 'fulfilled';
    } catch (cause) {
      const details = { tabId: deps.tabId, method, cause: errorMessage(cause) };
      if (alreadyGone(cause)) {
        // Nothing left to serve (the browser released or dropped it): done.
        log.debug('Paused request already gone (released)', details);
        return 'gone';
      }
      held = true;
      log.warn('Paused-request release refused', details);
      return 'refused';
    }
  };

  const pass = async (why: string): Promise<void> => {
    if (!held) return;
    held = false;
    logPass(why);
    try {
      await deps.send('Fetch.continueRequest', { requestId });
    } catch (cause) {
      if (alreadyGone(cause))
        log.debug('Paused request already gone (released)', { why, cause: errorMessage(cause) });
      else log.warn('Paused request could not be continued', { why, cause: errorMessage(cause) });
    }
  };

  return {
    markSessionPage(url) {
      sessionPage = pageAddress(url);
    },
    pass,
    async passWithoutRulesHeader(why, pause) {
      const params = continueWithoutRulesHeaderParams(pause);
      if (params !== null && held) {
        const result = await attempt('Fetch.continueResponse', params);
        if (result === 'fulfilled' || result === 'gone') logPass(why);
        if (result !== 'refused') return;
      }
      await pass(why);
    },
    async fulfill(params) {
      const result = await attempt('Fetch.fulfillRequest', params);
      // Released earlier (e.g. past the deadline): this fulfill served nothing.
      return result === 'released' ? 'gone' : result;
    }
  };
}
