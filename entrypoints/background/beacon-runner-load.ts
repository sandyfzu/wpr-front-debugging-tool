/**
 * The beacon test's background ask: inject the beacon runner — an unlisted
 * script, never in the manifest, so pages carry none of WP Rocket's beacon
 * code until a test runs — into the asking page's own top frame. The shared
 * top-frame injection answer (`./top-frame-injection`) owns the sender check
 * and the document targeting.
 */
import { createLogger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import type { LooseMessageSender } from '../../lib/messaging/sender';
import {
  answerTopFrameInjection,
  injectAtTarget,
  type InjectScripts,
  type TopFrameInjectionAsk
} from './top-frame-injection';

const log = createLogger('beacon-test');

/** The runner's built script (WXT emits unlisted scripts at the output root). */
export const BEACON_RUNNER_SCRIPT = '/beacon-runner.js';

/** The runner load's identity for the shared top-frame injection answer. */
const RUNNER_LOAD: TopFrameInjectionAsk = {
  row: 'loadBeaconRunner',
  refusal: 'only a top-frame page may load the runner',
  what: 'the beacon test runner',
  files: [BEACON_RUNNER_SCRIPT],
  log
};

/**
 * Answer a runner load for the sender's own top frame.
 *
 * @param sender The runtime sender.
 * @param inject Injects script files at a target.
 * @returns `true` once the runner ran.
 * @throws {@link Error} for a sender that is not a top-frame http(s) page;
 *   an injection failure rejects as the scripting API does (logged).
 */
export function answerBeaconRunnerLoad(
  sender: LooseMessageSender | undefined,
  inject: InjectScripts
): Promise<true> {
  return answerTopFrameInjection(sender, RUNNER_LOAD, inject);
}

/** Register the channel (once per background start). */
export function registerBeaconRunnerLoad(): void {
  onMessage('loadBeaconRunner', ({ sender }) => answerBeaconRunnerLoad(sender, injectAtTarget));
}
