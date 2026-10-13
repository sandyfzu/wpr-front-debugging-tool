/**
 * The Export-page-data-as-JSON action's mechanism: one `Blob` + anchor
 * download of the currently loaded `FdtData`, with a clipboard fallback when
 * the download cannot run in the current context — a DevTools panel document
 * has no dedicated downloads API (the `downloads` permission is not held),
 * so the browser's own anchor download is the mechanism; its unreliability
 * in a real DevTools panel is the manual row this phase records, and a
 * failing download degrades to a clipboard copy (never a dead end).
 *
 * Every failure shape is a result, not a throw: the clipboard fallback's own
 * failure is a third outcome, each toasting honestly.
 */
import type { ClipboardLike, CopyOutcomeSink } from '../../../components/ui/copy-button';
import { performCopy } from '../../../components/ui/copy-button';
import { createLogger } from '../../../lib/logger';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { toast } from '../../../components/ui/toast-store';

const log = createLogger('panel');

/** How one export ended (the caller may react; the toasts are the feedback). */
export type JsonExportResult = 'downloaded' | 'copied' | 'failed';

export interface JsonExportDeps {
  /**
   * The file-download seam (production: Blob + anchor click; tests inject).
   */
  download: (payload: string, filename: string) => void;
  /**
   * The clipboard seam for the degrade path — constructed lazily: the
   * accessor resolves only inside the fallback's own handling, so a context
   * without the clipboard (a throw at construction) is an _outcome_ of the
   * fallback arm, not an escape before it.
   */
  clipboard: () => ClipboardLike;
  /** The wall clock for the filename stamp. */
  now: () => Date;
}

/**
 * The export file's name: fixed prefix, no path characters, a minute-level
 * stamp so repeated exports do not overwrite one another.
 *
 * @param at The stamp's date.
 */
export function exportFilename(at: Date): string {
  const pad = (value: number): string => value.toString().padStart(2, '0');
  const year = String(at.getFullYear());
  const month = pad(at.getMonth() + 1);
  const day = pad(at.getDate());
  const hour = pad(at.getHours());
  const minute = pad(at.getMinutes());
  return `wpr-fdt-export-${year}${month}${day}-${hour}${minute}.json`;
}

/**
 * Export the page data as JSON.
 *
 * Success downloads a `.json` file (temporarily); a download seam failure
 * falls back to a clipboard copy; a clipboard failure is the final honest
 * answer. The raw platform error never renders — the toasts carry the
 * actionable framing, the log carries the cause.
 *
 * @param data The loaded page data (the whole `FdtData` shape, pretty-printed).
 * @param deps The seams (download + clipboard + clock).
 * @returns The outcome; never rejects.
 */
export async function exportPageDataJson(
  data: FdtData,
  deps: JsonExportDeps
): Promise<JsonExportResult> {
  const payload = JSON.stringify(data, null, 2);
  const filename = exportFilename(deps.now());
  try {
    deps.download(payload, filename);
    toast.success('Page data exported', { description: filename });
    return 'downloaded';
  } catch (cause) {
    log.warn('The JSON download could not run — falling back to the clipboard', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    const sink: CopyOutcomeSink = {
      copied: () => {
        toast.info('Page data exported — to the clipboard', {
          description: 'The file download is unavailable in this context.'
        });
      },
      failed: (copyError: unknown) => {
        log.warn('The clipboard export failed as well', {
          cause: copyError instanceof Error ? { message: copyError.message } : copyError
        });
        toast.error('Page data could not be exported', {
          description: 'Neither the file download nor the clipboard worked in this context.'
        });
      }
    };
    try {
      const outcome = await performCopy(payload, deps.clipboard(), sink);
      return outcome === 'copied' ? 'copied' : 'failed';
    } catch (cause) {
      // The clipboard seam's construction (or its provider) blew up before a
      // copy could even be attempted — the third honest outcome, same toast.
      log.error('The clipboard export failed before it could run', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
      sink.failed(cause);
      return 'failed';
    }
  }
}
