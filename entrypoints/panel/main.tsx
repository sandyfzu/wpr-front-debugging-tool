/**
 * The panel document's boot — WPR FDT's page inside the DevTools window.
 *
 * Order matters, and this file is the only place it lives together:
 * 1. global error handlers first (the page is an exclusive extension
 *    document — there is no host page to attribute errors to);
 * 2. the stored appearance resolves onto `<html>` with its follow armed
 *    *before* the app renders — combined with `index.html`'s paint lock the
 *    first painted frame is the resolved palette (a failed read paints the
 *    token default instead, never a wrong or stuck-hidden panel);
 * 3. the Solid app mounts and the shell takes over (stores, router, data
 *    flight registration all happen inside `App`, once per panel run);
 * 4. the cold-start instrument marks script start (this module's first
 *    statement) and shell interactive (the mount lands).
 */
import { render } from 'solid-js/web';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import { createLogger } from '../../lib/logger';
import { applyStoredAppearance, releaseThemeLock } from './appearance';
import { panelColdStart } from './cold-start';
import './style.css';
import App from './App';

const log = createLogger('panel');

panelColdStart.markScriptStart();

window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from panel/index.html');

/**
 * Boot sequence: stored appearance → palette applied → lock released →
 * render. The paint lock releases in every arm — a resolved appearance and
 * its failed read (the finally), plus a boot failure beyond that (the outer
 * catch) — so the panel is never left hidden; the hidden period paints no
 * frame, only the release does, in the resolved palette.
 *
 * @param mountPoint The pre-checked `#root` element (the document is
 *   guarded once at module scope; everything below assumes it exists).
 * @throws Only for an unrenderable page — the mount error is logged by the
 *   caller below; the appearance leg degrades to its own documented default.
 */
async function boot(mountPoint: HTMLElement): Promise<void> {
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
  } finally {
    releaseThemeLock(document.documentElement);
  }

  render(() => <App />, mountPoint);
  // The shell is mounted: the third cold-start entry. A failed render above
  // never reaches this — the interactive point marks only a real shell.
  panelColdStart.markShellInteractive();
}

void boot(root).catch((cause: unknown) => {
  releaseThemeLock(document.documentElement);
  log.error('Panel boot failed', cause instanceof Error ? { message: cause.message } : cause);
});
