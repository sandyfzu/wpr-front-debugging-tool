/**
 * A resource row's state chips: the split from `state-chips.ts`, rendered as
 * bare, non-interactive items (no tab stop, no hover affordance beyond a
 * plain `title`; the hook spans are `display: contents`) so the
 * row's own wrapping line lays them out beside its other items — at compact
 * widths they wrap, never scroll; a chip never breaks inside its words.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Badge } from '../../../../components/ui/badge';
import { StatusBadge } from '../../../../components/ui/status-badge';
import type { StateChipSplit } from './state-chips';

/**
 * Render a row's state chips.
 *
 * @param props.chips The row's split chips.
 */
export function StateChips(props: { chips: StateChipSplit }): JSX.Element {
  return (
    <>
      <For each={props.chips.visible}>
        {(chip) => (
          <span data-fdt="state-chip" data-fdt-state={chip.id} class="contents">
            <StatusBadge kind={chip.kind} title={chip.title} class="whitespace-nowrap">
              {chip.label}
              <Show when={chip.mark}>
                {(mark) => (
                  <>
                    {' '}
                    <span data-fdt="state-chip-mark" class="font-normal">
                      ({mark()})
                    </span>
                  </>
                )}
              </Show>
            </StatusBadge>
          </span>
        )}
      </For>
      <Show when={props.chips.overflow}>
        {(overflow) => (
          <span data-fdt="state-chip-overflow" class="contents">
            <Badge
              variant="outline"
              title={overflow().title}
              class="whitespace-nowrap tabular-nums"
            >
              {overflow().label}
            </Badge>
          </span>
        )}
      </Show>
    </>
  );
}
