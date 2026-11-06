/**
 * The beacon test's page module (top frame): answers the panel's
 * `runBeaconTest` with the executor, and asks the background to inject the
 * runner on the first run. No on-page trigger: the panel is the only way in.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { createLogger } from '../../../lib/logger';
import { onMessage, sendMessage } from '../../../lib/messaging';
import { boundedAsk, logAskMiss } from '../../../lib/messaging/bounded-ask';
import { parseBeaconTestRequest } from '../../../lib/messaging/beacon-test';
import { BEACON_RUNNER_LOAD_DEADLINE_MS } from '../../../lib/beacon-test/deadlines';
import { readBeaconRunner } from '../../../lib/beacon-test/runner-bridge';
import { createBeaconTestExecutor } from './executor';

const log = createLogger('beacon-test');

/**
 * Ask the background to inject the runner, bounded.
 *
 * @returns Whether it ran (a miss is logged).
 */
async function loadRunner(): Promise<boolean> {
  const outcome = await boundedAsk({
    send: () => sendMessage('loadBeaconRunner', undefined),
    parse: (answer) => (answer === true ? answer : null),
    timeoutMs: BEACON_RUNNER_LOAD_DEADLINE_MS
  });
  if (outcome.kind === 'reply') return true;
  logAskMiss(log, 'Loading the beacon test runner', outcome);
  return false;
}

/**
 * Wire the module (registry row of the isolated world). Top frame only: the
 * beacon measures the page's own viewport.
 *
 * @param ctx The content script's context; the handler rides its lifetime.
 */
export function setupBeaconTest(ctx: ContentScriptContext): void {
  if (window !== window.top) return;
  const executor = createBeaconTestExecutor({
    readRunner: () => readBeaconRunner(globalThis),
    loadRunner
  });
  ctx.onInvalidated(executor.dispose);
  ctx.onInvalidated(
    onMessage('runBeaconTest', ({ data }) => {
      const request = parseBeaconTestRequest(data);
      // Both ends ship in one build: a malformed request is a defect, refused loudly.
      if (request === null) throw new Error('runBeaconTest: malformed request');
      return executor.run(request);
    })
  );
}
