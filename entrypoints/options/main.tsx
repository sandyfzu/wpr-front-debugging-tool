/**
 * The options document's boot — the settings surface's open-in-tab page.
 *
 * Order matters, and this file is the only place it lives together:
 * 1. global error handlers first (an exclusive extension document — every
 *    uncaught error here is ours);
 * 2. the stored appearance resolves onto `<html>` *before* the app renders —
 *    combined with `index.html`'s paint lock the first painted frame is the
 *    resolved palette (a failed read paints the token default instead, never
 *    a wrong or stuck-hidden page);
 * 3. the Solid app mounts and its model takes over.
 */
import { render } from 'solid-js/web';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import { createLogger } from '../../lib/logger';
import { applyStoredAppearance, releaseThemeLock } from '../../lib/appearance/appearance';
import './style.css';
import App from './App';

const log = createLogger('options');

window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from options/index.html');

/**
 * Boot sequence: stored appearance → palette applied → lock released →
 * render. The lock releases on every arm (resolved read, failed read, boot
 * failure) so the page is never left hidden; the hidden period paints no
 * frame, only the release does, in the resolved palette.
 */
async function boot(mountPoint: HTMLElement): Promise<void> {
  try {
    // The follow handle lives for the page's lifetime (tokens.css resolves a
    // stored `system` through the OS media query; the page's own writes and
    // other surfaces' writes re-apply through the armed watch).
    await applyStoredAppearance(document.documentElement);
  } catch (cause) {
    log.warn(
      "Stored appearance could not be read — following the system scheme (the token stylesheet's default)",
      cause instanceof Error ? { message: cause.message } : cause
    );
  } finally {
    releaseThemeLock(document.documentElement);
  }

  // The product name + version come from the manifest at boot — never a
  // re-typed constant — and the h1 reads the plural name the browser shows.
  const manifest = browser.runtime.getManifest();
  render(() => <App name={manifest.name} version={manifest.version} />, mountPoint);
}

void boot(root).catch((cause: unknown) => {
  releaseThemeLock(document.documentElement);
  log.error('Options boot failed', cause instanceof Error ? { message: cause.message } : cause);
});
