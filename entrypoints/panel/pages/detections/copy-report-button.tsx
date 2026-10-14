/**
 * The Detections page's one primary action: copy the support report.
 * Icon-only on the compact tier (its name stays "Copy report" — the label is
 * visually hidden, never removed), labelled from the regular tier up. The
 * icon flashes a check after a confirmed copy; the toast is the feedback
 * either way (see `copy-report.ts`).
 */
import type { JSX } from 'solid-js';
import { createSignal, onCleanup } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import ClipboardCopy from 'lucide-solid/icons/clipboard-copy';
import { Button } from '../../../../components/ui/button';
import type { ClipboardLike } from '../../../../components/ui/copy-button';
import type { FdtData } from '../../../../lib/wp-rocket/types';
import { copySupportReport } from './copy-report';

/** How long the check confirmation lingers after a copy (ms). */
export const COPIED_FLASH_MS = 1600;

/** Props of {@link CopyReportButton}. */
export interface CopyReportButtonProps {
  /** The loaded page data the report is built from (read at click time). */
  data: FdtData;
  /** The clipboard seam (tests inject; default: the secure-context clipboard). */
  clipboard?: () => ClipboardLike;
}

/**
 * Render the `Copy report` button.
 *
 * @param props See {@link CopyReportButtonProps}.
 */
export function CopyReportButton(props: CopyReportButtonProps): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let flashReset: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(flashReset);
  });

  const onCopy = async (): Promise<void> => {
    const outcome = await copySupportReport(props.data, props.clipboard);
    if (outcome !== 'copied') return;
    setCopied(true);
    clearTimeout(flashReset);
    flashReset = setTimeout(() => setCopied(false), COPIED_FLASH_MS);
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
      <span class="@max-regular:sr-only">Copy report</span>
    </Button>
  );
}
