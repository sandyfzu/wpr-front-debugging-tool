/** The background's one tab-existence probe, shared by the subsystems that name tabs. */
import type { Logger } from '../../lib/logger';

/**
 * Whether a tab exists. An id-only read: `tabs.get` needs no `tabs`
 * permission, and a missing tab rejects — that rejection is the answer.
 *
 * @param tabId The tab to probe.
 * @param log The caller's logger (the miss is logged at debug under it).
 */
export async function tabExists(tabId: number, log: Logger): Promise<boolean> {
  try {
    await browser.tabs.get(tabId);
    return true;
  } catch (cause) {
    log.debug('Tab probe found no tab', { tabId, cause });
    return false;
  }
}
