/**
 * The `Copy report` mechanism — shared by the Detections page's button and
 * the command palette's row: build the support report from the loaded data,
 * write it to the clipboard, and confirm or explain through a toast. Every
 * failure shape (clipboard missing, write rejected, an unexpected throw) is
 * an outcome, never an escape past the caller's click handler.
 */
import type { ClipboardLike } from '../../../../components/ui/copy-button';
import { defaultClipboard, performCopy } from '../../../../components/ui/copy-button';
import { toast } from '../../../../components/ui/toast-store';
import { createLogger } from '../../../../lib/logger';
import { buildSupportReport } from '../../../../lib/panel/support-report';
import type { FdtData } from '../../../../lib/wp-rocket/types';

const log = createLogger('panel');

/** The success toast (bar W-1: "<Thing> copied"). */
export const REPORT_COPIED = 'Report copied';

/** The failure toast's title. */
export const REPORT_COPY_FAILED = 'The report could not be copied';

/**
 * The failure's remedy. A DevTools panel's clipboard write is refused while
 * the panel document is not focused — the usual cause when it fails.
 */
export const REPORT_COPY_REMEDY = 'Click inside the panel, then copy again.';

/** How one copy ended (the toasts are the user feedback). */
export type CopyReportOutcome = 'copied' | 'failed';

/**
 * Copy the support report for one data state.
 *
 * @param data The loaded page data.
 * @param clipboard The clipboard seam, resolved lazily so a missing clipboard
 *   is a failure outcome, not a throw (default: the secure-context one).
 * @returns The outcome; never rejects.
 */
export async function copySupportReport(
  data: FdtData,
  clipboard: () => ClipboardLike = defaultClipboard
): Promise<CopyReportOutcome> {
  const failed = (cause: unknown): CopyReportOutcome => {
    log.warn('The support report could not be copied', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error(REPORT_COPY_FAILED, { description: REPORT_COPY_REMEDY });
    return 'failed';
  };
  try {
    let outcome: CopyReportOutcome = 'failed';
    await performCopy(buildSupportReport(data), clipboard(), {
      copied: () => {
        toast.success(REPORT_COPIED);
        outcome = 'copied';
      },
      failed: (cause: unknown) => {
        outcome = failed(cause);
      }
    });
    return outcome;
  } catch (cause) {
    // The seam's construction (no clipboard here) or the build itself threw
    // before a write could run — same honest outcome.
    return failed(cause);
  }
}
