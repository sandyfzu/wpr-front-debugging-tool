/**
 * The one-line key to the state chips' sources, shown once per page above
 * its rows: only the sources that page's chips can show (each page declares
 * its list), in legend order, each word led by its chip icon in the chip's
 * text color — the page's own state by a small outlined swatch in muted text
 * (its chip has no icon). Wraps at compact widths, never scrolls.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import { StateSourceIcon } from './state-chip-list';
import { STATE_SOURCES, STATE_SOURCE_LOOKS, type StateSource } from './state-sources';

/**
 * The sources to list, in legend order, each once — whatever order or
 * repetition the page's declaration has.
 *
 * @param sources The page's possible sources.
 */
export function legendSources(sources: readonly StateSource[]): StateSource[] {
  return STATE_SOURCES.filter((source) => sources.includes(source));
}

/**
 * Render the legend.
 *
 * @param props.sources The sources the page's chips can show.
 */
export function StateSourceLegend(props: { sources: readonly StateSource[] }): JSX.Element {
  return (
    <p data-fdt="state-source-legend" class="flex flex-wrap gap-x-3 gap-y-1 text-2xs">
      <For each={legendSources(props.sources)}>
        {(source) => {
          const look = STATE_SOURCE_LOOKS[source];
          return (
            <span
              data-fdt-source={source}
              class={cn(
                'inline-flex items-center gap-1 whitespace-nowrap',
                look.icon === null ? 'text-fg-muted' : STATUS_TEXT_CLASSES[look.kind]
              )}
            >
              <Show
                when={look.icon !== null}
                fallback={
                  <span
                    aria-hidden="true"
                    class="h-2.5 w-3 shrink-0 rounded-sm border border-line-2"
                  />
                }
              >
                <StateSourceIcon source={source} />
              </Show>
              {look.legend}
            </span>
          );
        }}
      </For>
    </p>
  );
}
