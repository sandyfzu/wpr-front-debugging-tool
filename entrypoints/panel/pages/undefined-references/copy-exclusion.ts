/**
 * The "Copy as exclusion" action: copy a script's exclusion pattern and say
 * where it goes. A script that defines a name other code reads too early is
 * the usual Delay JS casualty, and excluding that script from Delay JS is the
 * usual fix — so the confirmation names the WP Rocket setting to paste into,
 * not just "copied".
 */
import {
  performCopy,
  defaultClipboard,
  type ClipboardLike
} from '../../../../components/ui/copy-button';
import { toast } from '../../../../components/ui/toast-store';
import { LABEL_DELAY_JAVASCRIPT_EXECUTION } from '../../../../lib/detection/labels';
import { createLogger } from '../../../../lib/logger';

const log = createLogger('panel');

/** The success toast's title. */
export const COPIED_TITLE = 'Exclusion copied';

/**
 * Where the pattern goes (the success toast's description): WP Rocket's
 * own setting — the feature label from the verified label table, then the
 * field under it.
 */
export const COPIED_DESCRIPTION = `Paste it into WP Rocket's ${LABEL_DELAY_JAVASCRIPT_EXECUTION} → Excluded JavaScript Files.`;

/** The failure toast's title (the shared copy-failure shape). */
export const COPY_FAILED_TITLE = 'Copy failed';

/**
 * The failure remedy, naming the pattern so it can be typed in by hand.
 *
 * @param pattern The exclusion that could not be copied.
 * @returns The toast description.
 */
export function copyFailedRemedy(pattern: string): string {
  return `Add it by hand: ${pattern}`;
}

/**
 * Copy one exclusion pattern and toast the outcome. Never throws: a missing
 * clipboard (insecure or blocked context) and a rejected write both end in
 * the error toast plus a warn log.
 *
 * @param pattern The exclusion pattern to copy.
 * @param resolveClipboard The clipboard seam resolver (default: the platform clipboard).
 * @returns `'copied'` when the write was confirmed, else `'failed'`.
 */
export async function copyAsExclusion(
  pattern: string,
  resolveClipboard: () => ClipboardLike = defaultClipboard
): Promise<'copied' | 'failed'> {
  const failed = (cause: unknown): void => {
    log.warn('Copying a script exclusion failed', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error(COPY_FAILED_TITLE, { description: copyFailedRemedy(pattern) });
  };
  let clipboard: ClipboardLike;
  try {
    clipboard = resolveClipboard();
  } catch (cause) {
    failed(cause);
    return 'failed';
  }
  return performCopy(pattern, clipboard, {
    copied: () => {
      toast.success(COPIED_TITLE, { description: COPIED_DESCRIPTION });
    },
    failed
  });
}
