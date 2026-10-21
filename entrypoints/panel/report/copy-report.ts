/**
 * The `Copy report` mechanism — the shell-owned binding every surface that
 * offers the support report runs (the Detections page's button, the command
 * palette's row): gather the report's provenance (time, extension version,
 * inspected page URL), build the report, write it to the clipboard, and
 * confirm or explain through a toast.
 *
 * Every failure shape (clipboard missing, write rejected, an unexpected
 * throw) is an outcome, never an escape past the caller's click handler;
 * a missing version or URL only thins the report, it never fails it.
 */
import type { ClipboardLike } from '../../../components/ui/copy-button';
import { defaultClipboard, performCopy } from '../../../components/ui/copy-button';
import { toast } from '../../../components/ui/toast-store';
import { createLogger } from '../../../lib/logger';
import { buildSupportReport } from '../../../lib/panel/support-report';
import type { FdtData } from '../../../lib/wp-rocket/types';
import { readInspectedPageUrl, realInspectedEvalApi } from './inspected-page-url';

const log = createLogger('panel');

/**
 * The success toast. Side effects confirm as "<thing> copied" — the noun
 * names what landed on the clipboard, the verb is the effect.
 */
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

/** The seams one copy runs against (tests inject; production: {@link realCopyReportDeps}). */
export interface CopyReportDeps {
  /** The clipboard, resolved lazily so a missing one is an outcome, not a throw. */
  readonly clipboard: () => ClipboardLike;
  /** The wall clock (epoch ms) stamped as the generation time. */
  readonly now: () => number;
  /** The extension's version, or null when the runtime cannot say. */
  readonly extensionVersion: () => string | null;
  /** The inspected page's URL, or null when it cannot be read (never rejects). */
  readonly pageUrl: () => Promise<string | null>;
}

/**
 * The extension's own version from its manifest.
 *
 * @returns The version, or null when the runtime is gone (extension reloaded).
 */
export function manifestVersion(): string | null {
  try {
    return browser.runtime.getManifest().version;
  } catch (cause) {
    log.warn('The extension version could not be read; the report omits it', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    return null;
  }
}

/**
 * The production seams.
 *
 * @returns The real clipboard, clock, manifest version and DevTools URL read.
 */
export function realCopyReportDeps(): CopyReportDeps {
  return {
    clipboard: defaultClipboard,
    now: () => Date.now(),
    extensionVersion: manifestVersion,
    pageUrl: () => readInspectedPageUrl(realInspectedEvalApi(), browser.runtime)
  };
}

/**
 * Copy the support report for one data state.
 *
 * @param data The loaded page data.
 * @param deps The seams (default: {@link realCopyReportDeps}).
 * @returns The outcome; never rejects.
 */
export async function copySupportReport(
  data: FdtData,
  deps: CopyReportDeps = realCopyReportDeps()
): Promise<CopyReportOutcome> {
  const failed = (cause: unknown): CopyReportOutcome => {
    log.warn('The support report could not be copied', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error(REPORT_COPY_FAILED, { description: REPORT_COPY_REMEDY });
    return 'failed';
  };
  try {
    const report = buildSupportReport(data, {
      generatedAt: deps.now(),
      extensionVersion: deps.extensionVersion(),
      pageUrl: await deps.pageUrl()
    });
    let outcome: CopyReportOutcome = 'failed';
    await performCopy(report, deps.clipboard(), {
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
    // The clipboard seam's construction (no clipboard here), a context read
    // or the build threw before a write could run — same honest outcome.
    return failed(cause);
  }
}
