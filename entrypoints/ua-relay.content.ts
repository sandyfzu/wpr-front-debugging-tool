/**
 * Isolated-world registration of the simulated-device identity relay: the
 * per-frame counterpart ferrying the tab's simulation state between the
 * extension world and the page-world identity shadow. Registered at document
 * start in every frame — the compare overlay's halves can redirect
 * cross-origin, and the identity must be answerable inside redirected frames
 * exactly the same. Registered on its own on purpose: it is not a lift of an
 * existing content script, whose matches and lifecycle belong to their own
 * features.
 *
 * Inactive when nothing simulates: the relay asks once at document start,
 * answers nothing but the state it cached, and never touches the page world
 * beyond the bridge messages.
 *
 * Page-safety model (all observable from this wiring alone): the shared
 * global handlers surface any error escaping the guarded setup as one
 * console line; every listener registers through the context, so an
 * invalidation (extension reload) tears the whole relay down cleanly.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { URL_PATTERNS } from '../lib/wp-rocket/constants';
import { guardInvalidationTeardown } from '../lib/dead-context';
import { QUIET_START, installRestartGuard } from '../lib/content-script-restart';
import { createLogger } from '../lib/logger';
import { onMessage, sendMessage } from '../lib/messaging';
import { uaIdentityMessenger } from '../lib/messaging/window-bridge';
import { onUnhandledRejection, onUncaughtError } from '../lib/uncaught-errors';
import { startUaIdentityRelay } from './ua-relay/relay';

const log = createLogger('ua-relay');

export default defineContentScript({
  // No start broadcast to the page's `message` listeners (it names our id).
  ...QUIET_START,
  matches: [...URL_PATTERNS],
  runAt: 'document_start',
  allFrames: true,
  main(ctx: ContentScriptContext) {
    // First: every teardown registered below runs dead-context safe (an
    // extension reload must never put an error on the host page).
    guardInvalidationTeardown(ctx, log);
    // Then, before the page can run again: only a dead extension context or a
    // newer start of this script in our own world may end it, never the page.
    installRestartGuard(ctx, log);
    // Attached first, like every isolated-world surface's: an error escaping
    // the guarded setup still surfaces as one console line while the relay
    // itself stays alive until the invalidation tears it down.
    const ownPrefix = browser.runtime.getURL('');
    ctx.addEventListener(window, 'error', onUncaughtError({ log, ownPrefix }));
    ctx.addEventListener(window, 'unhandledrejection', onUnhandledRejection({ log, ownPrefix }));

    try {
      const stop = startUaIdentityRelay({
        log,
        extension: {
          // The ask is sender-resolved by the background; the answer is
          // narrowed at the relay module's boundary before use.
          askBackground: (): Promise<unknown> => sendMessage('getDeviceSimulation'),
          // The row's typed acknowledgement (true) settles the tab's push.
          onBackgroundPush: (handler) =>
            onMessage('deviceSimulationChanged', ({ data }) => {
              handler(data);
              return true;
            })
        },
        windowBridge: {
          onIdentityAsk: (handler) =>
            uaIdentityMessenger.onMessage('uaIdentityRequest', () => handler()),
          announceIdentityState: (state) => {
            // Best-effort announcement: an absent page-world listener leaves
            // the send pending forever (bridge semantics — never rejected,
            // never resolved), and a present one settles on its ack. Nothing
            // here waits on delivery; a rejection would only mean the page
            // world reported its own receiver failure, logged and done.
            void uaIdentityMessenger
              .sendMessage('uaIdentityUpdate', state)
              .catch((cause: unknown) => {
                log.debug('The page world refused an identity announcement', cause);
              });
          }
        }
      });
      // The relay's own stop, plus the messengers' internal send bookkeeping
      // (a send mid-flight hangs its response listener — the teardown clears
      // it so the invalidated relay leaves no listener behind).
      ctx.onInvalidated(() => {
        stop();
        uaIdentityMessenger.removeAllListeners();
      });
    } catch (cause) {
      log.error('The identity relay could not start', cause);
    }
  }
});
