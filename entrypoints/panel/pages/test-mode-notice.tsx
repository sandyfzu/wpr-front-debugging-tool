/**
 * The TEST MODE notice: one line saying a RUCSS test replaced the inspected
 * page's styles (so every reading on the page is of the test's result, not
 * of the page as served), with the one remedy — reload the page. Shown by
 * the Detections page and the RUCSS tester while the payload carries the
 * page's test fact; gone with the reload's fresh payload.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import RotateCw from 'lucide-solid/icons/rotate-cw';
import TestTubeDiagonal from 'lucide-solid/icons/test-tube-diagonal';
import { Button } from '../../../components/ui/button';
import { STATUS_SOFT_CLASSES, STATUS_TEXT_CLASSES } from '../../../components/ui/status-badge';
import { RUCSS_TEST_MODE_SENTENCE, RUCSS_TEST_MODE_TAG } from '../../../lib/rucss-tester/test-mode';
import type { RucssTestModeFact } from '../../../lib/wp-rocket/types';
import { cn } from '../../../utils/cn';

/** Props of {@link TestModeNotice}. */
export interface TestModeNoticeProps {
  /** The page's test fact; nothing renders without one. */
  fact: RucssTestModeFact | undefined;
  /** Reloads the inspected page; absent where the context cannot (the action hides). */
  reloadInspectedPage?: () => void;
}

/**
 * Render the notice (or nothing when no test changed the page).
 *
 * @param props See {@link TestModeNoticeProps}.
 * @returns The notice row.
 */
export function TestModeNotice(props: TestModeNoticeProps): JSX.Element {
  return (
    <Show when={props.fact}>
      <div
        data-fdt="test-mode-notice"
        class={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md px-2.5 py-2',
          STATUS_SOFT_CLASSES.warn
        )}
      >
        <p class="flex min-w-0 flex-1 basis-56 items-start gap-1.5 text-xs text-fg-primary">
          <TestTubeDiagonal
            size={14}
            class={cn('mt-px shrink-0', STATUS_TEXT_CLASSES.warn)}
            aria-hidden="true"
          />
          <span>
            <span class="font-semibold">{RUCSS_TEST_MODE_TAG}</span> {RUCSS_TEST_MODE_SENTENCE}
          </span>
        </p>
        <Show when={props.reloadInspectedPage}>
          {(reload) => (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                reload()();
              }}
            >
              <RotateCw size={12} aria-hidden="true" />
              Reload page
            </Button>
          )}
        </Show>
      </div>
    </Show>
  );
}
