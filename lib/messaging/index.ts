/**
 * The shared extension messenger. Every surface imports this module to
 * produce one listener registration per context (`@webext-core/messaging`
 * allows a single listener per channel per JS context).
 */

import { defineExtensionMessaging } from '@webext-core/messaging';
import { createLogger } from '../logger';
import type { ProtocolMap } from './protocol';
import { preventUncheckedLastError } from './tab-send';

const messenger = defineExtensionMessaging<ProtocolMap>();

// The transport wins its own no-response semantics (the platform's tab send
// resolves empty on failure and the library folds that into a rejection);
// what it must not win is Chromium's "Unchecked runtime.lastError" console
// error for every expected tab-send miss — patched once per context, before
// any send, by wrapping the tab transport (see `./tab-send`). Optional-chain
// typing because not every importing context has a `chrome` global (pure
// unit-test environments do not).
type InjectedGlobals = {
  chrome?: { tabs?: { sendMessage: typeof chrome.tabs.sendMessage } };
};
const globalChrome = (globalThis as InjectedGlobals).chrome;
const currentTabSend = globalChrome?.tabs?.sendMessage;
if (typeof currentTabSend === 'function' && globalChrome?.tabs) {
  try {
    globalChrome.tabs.sendMessage = preventUncheckedLastError(currentTabSend);
  } catch (cause) {
    // The API property is not rebindable in this context: the guard is
    // unavailable, the transport itself still works. Named, not silent —
    // failed sends will surface their exploration in the console as before.
    createLogger('messaging').error(
      'Tab-send lastError guard could not be installed — failed sends may log "Unchecked runtime.lastError"',
      cause
    );
  }
}

/** Typed receive half of the protocol map (see `./protocol` for row docs). */
export const onMessage = messenger.onMessage;
/** Typed send half of the protocol map (see `./protocol` for row docs). */
export const sendMessage = messenger.sendMessage;
