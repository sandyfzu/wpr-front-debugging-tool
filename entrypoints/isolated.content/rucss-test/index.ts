/**
 * The RUCSS test's page module (top frame): answers the panel's
 * `startRucssTest` / `applyRucssTest` with the executor, asks the
 * background for the service's CSS, and keeps the page's test state for
 * the page's own surfaces ({@link rucssTestModeFor}). No request leaves
 * unless the panel starts a test; nothing is logged about the page.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createLogger } from '../../../lib/logger';
import { onMessage, sendMessage } from '../../../lib/messaging';
import { boundedAsk } from '../../../lib/messaging/bounded-ask';
import {
  parseRucssApplyRequest,
  parseRucssFetchReply,
  parseRucssStartRequest,
  type RucssFetchReply,
  type RucssFetchRequest
} from '../../../lib/messaging/rucss-test';
import { RUCSS_FETCH_ASK_DEADLINE_MS } from '../../../lib/rucss-tester/deadlines';
import { createRandomId } from '../../../utils/random-id';
import { createRucssTestExecutor, type RucssTestMode } from './executor';

const log = createLogger('rucss-test');

/** Each live context's test-state reader. */
const modeReaders = new WeakMap<ContentScriptContext, () => RucssTestMode>();

/**
 * The page's RUCSS test state, for a same-context surface.
 *
 * @param ctx The content script's context.
 * @returns The reader, or null before (or without) the module's setup.
 */
export function rucssTestModeFor(ctx: ContentScriptContext): (() => RucssTestMode) | null {
  return modeReaders.get(ctx) ?? null;
}

/**
 * Ask the background for the service's CSS, bounded.
 *
 * @param request The request.
 * @returns The validated reply, or null for any miss (logged).
 */
async function askShakenCss(request: RucssFetchRequest): Promise<RucssFetchReply | null> {
  const outcome = await boundedAsk({
    send: () => sendMessage('fetchRucssShakenCss', request),
    parse: parseRucssFetchReply,
    timeoutMs: RUCSS_FETCH_ASK_DEADLINE_MS
  });
  if (outcome.kind === 'reply') return outcome.reply;
  log.warn(
    `RUCSS request got no answer from the background: ${outcome.kind}`,
    outcome.kind === 'failed' && outcome.cause instanceof Error ? outcome.cause.message : ''
  );
  return null;
}

/**
 * Wire the module (registry row of the isolated world). Top frame only:
 * the test acts on the page as a whole.
 *
 * @param ctx The content script's context; the handlers ride its lifetime.
 */
export function setupRucssTest(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  const executor = createRucssTestExecutor({
    document,
    pageUrl: () => location.href,
    fetchShakenCss: askShakenCss,
    newRunId: createRandomId,
    isInvalid: () => ctx.isInvalid
  });
  modeReaders.set(ctx, executor.mode);
  ctx.onInvalidated(
    onMessage('startRucssTest', ({ data }) => {
      const request = parseRucssStartRequest(data);
      // Both ends ship in one build: a malformed start is a defect, refused loudly.
      if (request === null) throw new Error('startRucssTest: malformed request');
      return executor.start(request);
    })
  );
  ctx.onInvalidated(
    onMessage('applyRucssTest', ({ data }) => {
      const request = parseRucssApplyRequest(data);
      return request === null ? { ok: false, failure: 'invalid-request' } : executor.apply(request);
    })
  );
}
