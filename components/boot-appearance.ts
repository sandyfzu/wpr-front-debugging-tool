/**
 * The appearance leg of an extension page's boot (the panel and the options
 * page): puts `<html>` on the stored choice, arms the follow, releases the
 * paint lock, and hands the page the choice the document follows (its
 * appearance menu, the options row) — fed by that one follow, never a
 * second storage subscription.
 *
 * A failed read degrades to the token stylesheet's system default (the
 * page shows System) and still arms the write half of the follow: the
 * page's own pick or another surface's write then restyles the document
 * and moves its controls as soon as one write lands — never a pick that
 * saves yet changes nothing visible.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { Logger } from '../lib/logger';
import {
  applyStoredAppearance,
  followAppearanceWrites,
  releaseThemeLock,
  type AppearanceSource
} from '../lib/appearance/appearance';
import { FALLBACK } from '../lib/storage/options';
import type { Appearance } from '../utils/theme';

/**
 * Summarize a cause for the log: an `Error`'s message, anything else as is.
 *
 * @param cause The caught value.
 */
function logCause(cause: unknown): unknown {
  return cause instanceof Error ? { message: cause.message } : cause;
}

/**
 * Resolve an extension page's appearance before its first render. Never
 * rejects: every failure is logged and degrades, and the paint lock
 * releases in every arm (the page is never left hidden). The follow lives
 * for the document's lifetime, so no stop handle is returned.
 *
 * @param root The document root (`<html>`).
 * @param log The page's diagnostics sink.
 * @param source The options seam; absent, the real storage item.
 * @returns The choice the document follows (the menu's value).
 */
export async function bootAppearance(
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
        'The appearance follow could not be armed — the page keeps the system scheme',
        logCause(armCause)
      );
    }
  } finally {
    releaseThemeLock(root);
  }
  return appearance;
}
