/**
 * The recovery row under a tool page's ask outcome: ask again or reload the
 * inspected page, the first one primary. A reload where the context cannot
 * reload is left out (and with it, a row that would be empty).
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Button } from '../../../components/ui/button';

/** A recovery a tool page offers. */
export type PageRecovery = 'retry' | 'reload-page';

/** Props of {@link RecoveryButtons}. */
export interface RecoveryButtonsProps {
  /** In order; the first available one is primary. */
  recoveries: readonly PageRecovery[];
  labels: Readonly<Record<PageRecovery, string>>;
  onRetry: () => void;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
  /** The test hook attribute's value prefix (`data-fdt-recovery` = `<hook>:<recovery>`). */
  hook: string;
}

/**
 * The recoveries the context can carry out.
 *
 * @param recoveries The outcome's recoveries.
 * @param canReload Whether the inspected page can be reloaded.
 */
export function availableRecoveries(
  recoveries: readonly PageRecovery[],
  canReload: boolean
): PageRecovery[] {
  return recoveries.filter((recovery) => recovery !== 'reload-page' || canReload);
}

/**
 * Render the row.
 *
 * @param props See {@link RecoveryButtonsProps}.
 */
export function RecoveryButtons(props: RecoveryButtonsProps): JSX.Element {
  const shown = () => availableRecoveries(props.recoveries, props.reloadPage !== undefined);
  return (
    <Show when={shown().length > 0}>
      <div class="flex flex-wrap gap-1.5">
        <For each={shown()}>
          {(recovery, index) => (
            <Button
              size="sm"
              variant={index() === 0 ? 'primary' : 'secondary'}
              data-fdt-recovery={`${props.hook}:${recovery}`}
              onClick={() => {
                if (recovery === 'retry') props.onRetry();
                else props.reloadPage?.();
              }}
            >
              {props.labels[recovery]}
            </Button>
          )}
        </For>
      </div>
    </Show>
  );
}
