/**
 * The panel boot's appearance leg: puts `<html>` on the stored choice, arms
 * the follow, releases the paint lock, and hands the top bar's appearance
 * menu the choice the document follows — fed by that one follow, never a
 * second storage subscription.
 *
 * A failed read degrades to the token stylesheet's system default (the
 * menu shows System) and still arms the write half of the follow: the
 * menu's own pick, the palette's cycle or the options page then restyle the
 * panel and move the menu as soon as one write lands — never a pick that
 * saves yet changes nothing visible.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../../lib/logger';
import {
  applyStoredAppearance,
  followAppearanceWrites,
  releaseThemeLock,
  type AppearanceSource
} from '../../lib/appearance/appearance';
import { FALLBACK } from '../../lib/storage/options';
import type { Appearance } from '../../utils/theme';

/**
 * Summarize a cause for the log: an `Error`'s message, anything else as is.
 *
 * @param cause The caught value.
 */
function logCause(cause: unknown): unknown {
  return cause instanceof Error ? { message: cause.message } : cause;
}

/**
 * Resolve the panel document's appearance before the first render. Never
 * rejects: every failure is logged and degrades, and the paint lock
 * releases in every arm (the panel is never left hidden). The follow lives
 * for the document's lifetime, so no stop handle is returned.
 *
 * @param root The document root (`<html>`).
 * @param log The panel's diagnostics sink.
 * @param source The options seam; absent, the real storage item.
 * @returns The choice the document follows (the menu's value).
 */
export async function bootPanelAppearance(
  root: HTMLElement,
  log: Logger,
  source?: AppearanceSource
): Promise<Accessor<Appearance>> {
  const [appearance, setAppearance] = createSignal<Appearance>(FALLBACK.appearance);
  /** The follow's observer: the menu's value moves with the document. */
  const follow = (choice: Appearance): void => {
    setAppearance(choice);
  };
  try {
    await applyStoredAppearance(root, source, follow);
  } catch (cause) {
    log.warn(
      "Stored appearance could not be read — following the system scheme (the token stylesheet's default)",
      logCause(cause)
    );
    try {
      // The read unwound its watch; re-arm the write half alone.
      followAppearanceWrites(root, source, follow);
    } catch (armCause) {
      log.warn(
        'The appearance follow could not be armed — the panel keeps the system scheme',
        logCause(armCause)
      );
    }
  } finally {
    releaseThemeLock(root);
  }
  return appearance;
}
