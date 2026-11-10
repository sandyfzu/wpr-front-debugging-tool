/**
 * A resource row's state chips: the split from `state-chips.ts`, rendered as
 * bare, non-interactive items (no tab stop, no hover affordance beyond a
 * plain `title`; the hook spans are `display: contents`) so the
 * row's own wrapping line lays them out beside its other items — at compact
 * widths they wrap, never scroll; a chip never breaks inside its words. Each
 * chip shows its source by icon + treatment (`state-sources.ts`).
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Badge } from '../../../../components/ui/badge';
import type { StateChipSplit } from './state-chips';
import { STATE_SOURCE_LOOKS, type StateSource } from './state-sources';

/** Every chip's shared classes: the state chips' weight, never broken inside. */
const CHIP_CLASS = 'font-medium whitespace-nowrap';

/**
 * A source's icon at chip size (nothing for a source without one).
 *
 * @param props.source The source.
 */
export function StateSourceIcon(props: { source: StateSource }): JSX.Element {
  return (
    <Show when={STATE_SOURCE_LOOKS[props.source].icon}>
      {(icon) => <Dynamic component={icon()} size={12} class="shrink-0" aria-hidden="true" />}
    </Show>
  );
}

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
          <span
            data-fdt="state-chip"
            data-fdt-state={chip.id}
            data-fdt-source={chip.source}
            class="contents"
          >
            <Badge
              kind={STATE_SOURCE_LOOKS[chip.source].kind}
              variant={STATE_SOURCE_LOOKS[chip.source].variant}
              title={chip.title}
              class={CHIP_CLASS}
            >
              <StateSourceIcon source={chip.source} />
              {chip.label}
            </Badge>
          </span>
        )}
      </For>
      <Show when={props.chips.overflow}>
        {(overflow) => (
          <span
            data-fdt="state-chip-overflow"
            data-fdt-hides-wp-rocket={overflow().hidesWpRocket ? '' : undefined}
            class="contents"
          >
            {/* Outline, in WP Rocket's tone + rocket when it hides WP Rocket work. */}
            <Badge
              kind={overflow().hidesWpRocket ? STATE_SOURCE_LOOKS['wp-rocket'].kind : 'neutral'}
              variant="outline"
              title={overflow().title}
              class={`${CHIP_CLASS} tabular-nums`}
            >
              <Show when={overflow().hidesWpRocket}>
                <StateSourceIcon source="wp-rocket" />
              </Show>
              {overflow().label}
            </Badge>
          </span>
        )}
      </Show>
    </>
  );
}
