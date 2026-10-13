/**
 * The panel document's boot — WPR FDT's page inside the DevTools window.
 *
 * Order matters, and this file is the only place it lives together:
 * 1. global error handlers first (the page is an exclusive extension
 *    document — there is no host page to attribute errors to);
 * 2. the stored appearance resolves onto `<html>` with its follow armed
 *    *before* the app renders — no wrong-palette frame, and later options
 *    writes restyle live;
 * 3. the Solid app mounts and the shell takes over (stores, router, data
 *    flight registration all happen inside `App`, once per panel run).
 */
import { render } from 'solid-js/web';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import { createLogger } from '../../lib/logger';
import { applyStoredAppearance } from './appearance';
import './style.css';
import App from './App';

const log = createLogger('panel');

window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from panel/index.html');

/**
 * Boot sequence: stored appearance → palette applied → render.
 *
 * @throws Only for an unrenderable page — the mount error is logged by the
 *   caller below; the appearance leg degrades to its own documented default.
 */
async function boot(): Promise<void> {
  if (!root) throw new Error('#root element missing from panel/index.html');

  try {
    // The follow handle lives for the page's lifetime (tokens.css resolves a
    // stored `system` through the OS media query, so only writes from the
    // options page need re-applying); a failed read degrades to the token
    // stylesheet's system default and skips the follow.
    await applyStoredAppearance(document.documentElement);
  } catch (cause) {
    log.warn(
      "Stored appearance could not be read — following the system scheme (the token stylesheet's default)",
      cause instanceof Error ? { message: cause.message } : cause
    );
  }

  render(() => <App />, root);
}

void boot().catch((cause: unknown) => {
  log.error('Panel boot failed', cause instanceof Error ? { message: cause.message } : cause);
});
