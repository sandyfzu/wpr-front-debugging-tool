/**
 * The devtools page: the DevTools-owned field where the tool's extension
 * surfaces register. It creates the `WPR FDT` panel (whose page is
 * `panel.html`, the shell the panel phase delivers), relays what happens on
 * that panel (search), and populates the Elements sidebar pane; finally it
 * warms the inspected tab's page data so the panel opens with data ready.
 *
 * The three registrations are independent guarded steps — one failing can
 * never keep the others from registering (the devtools page has no fallback
 * recovery, so every failure is named, logged and visibly scoped).
 */

import { sendMessage } from '../../lib/messaging/index';
import { isNoReceiverError } from '../../lib/messaging/no-receiver';
import { createLogger } from '../../lib/logger';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import { registerLazyloadSidebar } from './lazyload-sidebar';
import { registerSearchRelay } from './search-relay';

const log = createLogger('devtools');

/** The panel's title among the devtools tools (user-facing, parity string). */
const PANEL_TITLE = 'WPR FDT';
/** The panel's icon, relative to the extension root (copied public asset). */
const PANEL_ICON = 'icon/32.png';
/** The panel's page: the extension-root-relative HTML path. */
const PANEL_PAGE = 'panel.html';

// Global error handlers first: anything escaping the guarded steps surfaces
// as one prefixed console line instead of killing the devtools page's work.
// This page is an exclusive extension document — no host page shares it, so
// every uncaught error here is ours and no attribution prefix is needed.
window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

try {
  // Callback form (Chromium only gained the promise form beyond the
  // manifest's Chrome floor) — any creation failure must be read from
  // `runtime.lastError` inside the callback.
  browser.devtools.panels.create(PANEL_TITLE, PANEL_ICON, PANEL_PAGE, (panel) => {
    const creationFailure = browser.runtime.lastError;
    if (creationFailure !== undefined) {
      log.error('Panel creation failed', {
        title: PANEL_TITLE,
        message: creationFailure.message
      });
      return;
    }
    registerSearchRelay(panel);
  });
} catch (cause) {
  log.error('Panel registration failed — no WPR FDT panel', cause);
}

try {
  registerLazyloadSidebar();
} catch (cause) {
  log.error('Lazyload sidebar registration failed — no Elements sidebar pane', cause);
}

try {
  // Parity warm-up: ask the inspected tab's content script to process the
  // page now, so the panel's first open finds data ready. Tab-targeted, and
  // fully expected to fail cleanly when the content script is not injected
  // (page without host permission, extension reloading, navigation mid-send):
  // the panel's first data request triggers the same processing lazily, so a
  // skipped warm-up costs a slower first answer, never a broken one.
  sendMessage('processPageData', undefined, browser.devtools.inspectedWindow.tabId)
    .then(() => {
      log.debug('Page data warm-up handed to the inspected tab');
    })
    .catch((cause: unknown) => {
      if (isNoReceiverError(cause)) {
        // Expected until the tab's content script is there (navigation,
        // extension reload, a page outside the host permissions): purely a
        // slower first answer, so it stays at debug.
        log.debug('Page data warm-up skipped', cause instanceof Error ? cause.message : cause);
        return;
      }
      // Any other failure is not a miss — say so loudly enough to find.
      log.warn('Page data warm-up send failed', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    });
} catch (cause) {
  log.error('Page data warm-up could not start', cause);
}
