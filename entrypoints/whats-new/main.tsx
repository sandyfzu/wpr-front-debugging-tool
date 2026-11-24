/**
 * The What's new page's boot: error handlers first, the stored appearance
 * onto `<html>` before the first render (the paint lock in `index.html`
 * releases in every arm), the copy placeholders' values (the user's palette
 * shortcut, the platform's DevTools shortcut — each degrading to its
 * default), then the view over the registry (from the address's `since`
 * floor, when the update opened it) and the real storage.
 */
import { render } from 'solid-js/web';
import { bootAppearance } from '../../components/boot-appearance';
import { releaseThemeLock } from '../../lib/appearance/appearance';
import { createLogger } from '../../lib/logger';
import { createWhatsNewOnUpdateIO } from '../../lib/options/instant-io';
import { RELEASE_NOTES } from '../../lib/release-notes/notes';
import { readSinceParam } from '../../lib/release-notes/page-path';
import { whatsNewTokens, whatsNewView } from '../../lib/release-notes/page-view';
import { DEFAULT_PALETTE_CHORD, readPaletteChord } from '../../lib/storage/palette-chord';
import { resolveChordPlatform } from '../../lib/storage/palette-chord-platform';
import { onUncaughtError, onUnhandledRejection } from '../../lib/uncaught-errors';
import './style.css';
import App from './App';

const log = createLogger('whats-new');

window.addEventListener('error', onUncaughtError({ log }));
window.addEventListener('unhandledrejection', onUnhandledRejection({ log }));

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from whats-new/index.html');

/** Boot: appearance → lock released → placeholders → render. */
async function boot(mountPoint: HTMLElement): Promise<void> {
  const appearance = await bootAppearance(document.documentElement, log);
  const [platform, chord] = await Promise.all([
    resolveChordPlatform({ getPlatformInfo: () => browser.runtime.getPlatformInfo(), log }),
    readPaletteChord().catch((cause: unknown) => {
      log.warn('The palette shortcut could not be read — showing the default', cause);
      return DEFAULT_PALETTE_CHORD;
    })
  ]);
  const manifest = browser.runtime.getManifest();
  const view = whatsNewView(
    RELEASE_NOTES,
    manifest.version,
    import.meta.env.BROWSER === 'firefox' ? 'firefox' : 'chromium',
    // After an update: the version the user knew, so every unseen release expands.
    readSinceParam(location.search)
  );
  render(
    () => (
      <App
        name={manifest.name}
        version={manifest.version}
        view={view}
        tokens={whatsNewTokens(chord, platform)}
        appearance={appearance}
        settingIO={createWhatsNewOnUpdateIO(log)}
        openOptions={() =>
          browser.runtime.openOptionsPage().catch((cause: unknown) => {
            log.error('Opening the options page failed', cause);
          })
        }
      />
    ),
    mountPoint
  );
}

void boot(root).catch((cause: unknown) => {
  releaseThemeLock(document.documentElement);
  log.error('What’s new boot failed', cause instanceof Error ? { message: cause.message } : cause);
});
