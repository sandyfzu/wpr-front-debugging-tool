/**
 * The background's tab relay: answers `relayTabAsk` for this extension's
 * tab-less pages that cannot message tabs themselves (Firefox DevTools
 * pages), forwarding the registry-listed ask with the direct tab send and
 * handing back the answer — or a typed failure, never a silent drop. The
 * contract (asks, payload checks, reply shape) lives in
 * `lib/messaging/tab-relay`.
 */
import { createLogger, type Logger } from '../../lib/logger';
import { onMessage } from '../../lib/messaging';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import { isOwnExtensionPageSender, type LooseMessageSender } from '../../lib/messaging/sender';
import { DIRECT_TAB_ASKS, type TabAsks } from '../../lib/messaging/tab-asks';
import {
  parseTabRelayRequest,
  type TabRelayFailure,
  type TabRelayReply
} from '../../lib/messaging/tab-relay';
import { tabExists } from './tab-exists';

const log = createLogger('tab-relay');

/** What the relay runs against (tests inject doubles). */
export interface TabRelayDeps {
  /** This extension's id (`runtime.id`). */
  readonly extensionId: string;
  /** This extension's root URL (`runtime.getURL('/')`) — the sender-page origin check. */
  readonly extensionRootUrl: string;
  /** Whether a tab with this id exists. */
  readonly tabExists: (tabId: number) => Promise<boolean>;
  /** The transport the ask is forwarded over (production: the direct tab send). */
  readonly asks: TabAsks;
  readonly log: Logger;
}

/** A typed failure reply. */
function failed(failure: TabRelayFailure): TabRelayReply {
  return { ok: false, failure };
}

/**
 * Answer one relay request. Never rejects: every refusal and failure is a
 * typed reply the asking page maps onto its own states.
 *
 * @param sender The runtime sender, untrusted.
 * @param data The request, untrusted.
 * @param deps See {@link TabRelayDeps}.
 */
export async function answerTabRelay(
  sender: LooseMessageSender | undefined,
  data: unknown,
  deps: TabRelayDeps
): Promise<TabRelayReply> {
  if (!isOwnExtensionPageSender(sender, deps.extensionId, deps.extensionRootUrl)) {
    deps.log.warn('Relay refused — only this extension’s tab-less pages may name a tab');
    return failed('refused');
  }
  const request = parseTabRelayRequest(data);
  if (request === null) {
    deps.log.warn('Relay refused a malformed request (unknown ask, junk tab id or payload)');
    return failed('invalid-request');
  }
  const { ask, tabId } = request;
  try {
    if (!(await deps.tabExists(tabId))) {
      deps.log.debug('Relay target tab is gone', { ask, tabId });
      return failed('tab-gone');
    }
    return { ok: true, answer: await request.forward(deps.asks) };
  } catch (cause) {
    if (isNoReceiverError(cause)) {
      // Expected: the tab's content script is not there (yet).
      deps.log.debug('Relay found no receiver in the tab', { ask, tabId });
      return failed('no-receiver');
    }
    deps.log.warn('Relay forward failed', {
      ask,
      tabId,
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return failed('failed');
  }
}

/** Register the relay's one channel (once per background start). */
export function registerTabRelay(): void {
  const deps: TabRelayDeps = {
    extensionId: browser.runtime.id,
    extensionRootUrl: browser.runtime.getURL('/'),
    tabExists: (tabId) => tabExists(tabId, log),
    asks: DIRECT_TAB_ASKS,
    log
  };
  onMessage('relayTabAsk', ({ sender, data }) => answerTabRelay(sender, data, deps));
}
