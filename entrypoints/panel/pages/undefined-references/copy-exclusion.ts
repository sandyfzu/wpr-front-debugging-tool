/**
 * The "Copy as exclusion" action: copy a definition's script URL and point at
 * where it goes. A script that defines a name other code reads too early is
 * the usual Delay JS casualty, and excluding that script from Delay JS is the
 * usual fix — so the confirmation names the Exclusion Builder field to paste
 * into, not just "copied".
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
export const COPIED_TITLE = 'Script URL copied';

/** Where the copied URL goes (the success toast's description). */
export const COPIED_DESCRIPTION = `Paste it into the Exclusion Builder's ${LABEL_DELAY_JAVASCRIPT_EXECUTION} exclusions — open the builder from the command palette.`;

/** The failure toast's title (the shared copy-failure shape). */
export const COPY_FAILED_TITLE = 'Copy failed';

/** The failure remedy: the URL is on screen as selectable text. */
export const COPY_FAILED_REMEDY = 'Select the script URL and copy it instead.';

/**
 * Copy one script URL and toast the outcome. Never throws: a missing
 * clipboard (insecure or blocked context) and a rejected write both end in
 * the error toast plus a warn log.
 *
 * @param url The script URL to copy.
 * @param resolveClipboard The clipboard seam resolver (default: the platform clipboard).
 * @returns `'copied'` when the write was confirmed, else `'failed'`.
 */
export async function copyAsExclusion(
  url: string,
  resolveClipboard: () => ClipboardLike = defaultClipboard
): Promise<'copied' | 'failed'> {
  const failed = (cause: unknown): void => {
    log.warn('Copying a script URL as an exclusion failed', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error(COPY_FAILED_TITLE, { description: COPY_FAILED_REMEDY });
  };
  let clipboard: ClipboardLike;
  try {
    clipboard = resolveClipboard();
  } catch (cause) {
    failed(cause);
    return 'failed';
  }
  return performCopy(url, clipboard, {
    copied: () => {
      toast.success(COPIED_TITLE, { description: COPIED_DESCRIPTION });
    },
    failed
  });
}
