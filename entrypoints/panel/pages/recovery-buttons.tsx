/**
 * The recovery row under a tool page's outcome: ask again, reload the
 * inspected page, or (where the tool has settings) go back to them. A
 * recovery the context cannot carry out is left out first, then the first
 * one left is primary — and a row with nothing left is not rendered.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Button } from '../../../components/ui/button';

/** A recovery a tool page offers. */
export type PageRecovery = 'retry' | 'reload-page' | 'review-settings';

/** Props of {@link RecoveryButtons}. */
export interface RecoveryButtonsProps<R extends PageRecovery> {
  /** In order; the first available one is primary. */
  recoveries: readonly R[];
  labels: Readonly<Record<R, string>>;
  onRetry: () => void;
  /** Reload the inspected page; absent where the context cannot. */
  reloadPage?: () => void;
  /** Go to the settings the outcome names; absent where the tool has none. */
  onReviewSettings?: () => void;
  /** The test hook attribute's value prefix (`data-fdt-recovery` = `<hook>:<recovery>`). */
  hook: string;
}

/** What the context can carry out. */
export interface RecoveryAbilities {
  /** The inspected page can be reloaded. */
  readonly reload: boolean;
  /** The tool has settings to go back to. */
  readonly reviewSettings: boolean;
}

/**
 * The recoveries the context can carry out, in their order.
 *
 * @param recoveries The outcome's recoveries.
 * @param can What the context can carry out.
 * @returns The recoveries left.
 */
export function availableRecoveries<R extends PageRecovery>(
  recoveries: readonly R[],
  can: RecoveryAbilities
): R[] {
  return recoveries.filter((recovery) => {
    if (recovery === 'reload-page') return can.reload;
    if (recovery === 'review-settings') return can.reviewSettings;
    return true;
  });
}

/**
 * Render the row.
 *
 * @param props See {@link RecoveryButtonsProps}.
 */
export function RecoveryButtons<R extends PageRecovery>(
  props: RecoveryButtonsProps<R>
): JSX.Element {
  const shown = () =>
    availableRecoveries(props.recoveries, {
      reload: props.reloadPage !== undefined,
      reviewSettings: props.onReviewSettings !== undefined
    });
  /**
   * Carry out one recovery.
   *
   * @param recovery The clicked recovery.
   */
  const carryOut = (recovery: PageRecovery): void => {
    switch (recovery) {
      case 'retry':
        props.onRetry();
        return;
      case 'reload-page':
        props.reloadPage?.();
        return;
      case 'review-settings':
        props.onReviewSettings?.();
        return;
    }
  };
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
                carryOut(recovery);
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
