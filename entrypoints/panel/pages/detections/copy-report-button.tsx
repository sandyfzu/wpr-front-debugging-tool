/**
 * The Detections page's one primary action: copy the support report
 * through the shell's report binding. The icon flashes a check after a
 * confirmed copy; the toast is the feedback either way. Clicks landing while
 * a copy is still in flight are ignored (one report per intent, no stacked
 * toasts), and nothing outlives the button: a copy settling after unmount
 * arms no timer.
 */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ClipboardCopy from 'lucide-solid/icons/clipboard-copy';
import { Button } from '../../../../components/ui/button';
import { COPIED_FLASH_MS } from '../../../../components/ui/copy-flash';
import { createLogger } from '../../../../lib/logger';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { copySupportReport, type CopyReportOutcome } from '../../report/copy-report';

const log = createLogger('panel');

/** Props of {@link CopyReportButton}. */
export interface CopyReportButtonProps {
  /** The loaded page data the report is built from (read at click time). */
  data: FdtData;
  /** The copy seam (tests inject; default: the shell's report binding). */
  copy?: (data: FdtData) => Promise<CopyReportOutcome>;
}

/**
 * Render the `Copy report` button.
 *
 * @param props See {@link CopyReportButtonProps}.
 * @returns The button.
 */
export function CopyReportButton(props: CopyReportButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let flashReset: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(flashReset);
  });

  const onCopy = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const copy = props.copy ?? ((data: FdtData) => copySupportReport(data));
      const outcome = await copy(props.data);
      if (outcome !== 'copied' || disposed) return;
      setCopied(true);
      clearTimeout(flashReset);
      flashReset = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
    } catch (cause) {
      // The shell binding never rejects; an injected seam that does must not
      // become an unhandled rejection from a click.
      log.error('The report copy rejected past its own handling', {
        cause: cause instanceof Error ? { message: cause.message } : cause
      });
    } finally {
      inFlight = false;
    }
  };

  return (
    <Button
      variant="primary"
      size="sm"
      data-fdt="copy-report"
      data-fdt-copied={copied() ? '' : undefined}
      onClick={() => {
        void onCopy();
      }}
    >
      {copied() ? (
        <Check size={14} class="shrink-0" aria-hidden="true" />
      ) : (
        <ClipboardCopy size={14} class="shrink-0" aria-hidden="true" />
      )}
      Copy report
    </Button>
  );
}
