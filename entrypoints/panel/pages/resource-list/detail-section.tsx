/**
 * A detail view's building blocks — the titled section (a script's source,
 * a style's CSS, a word's definitions) and the facts list — shared, so
 * every list's detail reads the same.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { cn } from '../../../../utils/cn';

/**
 * A detail body's layout: one column at every width — chips, the source
 * tile, the facts, then the code (last: a tall block never hides a section
 * below it). Side by side, the code and the tile only
 * get room once both columns are wide, which no drill-in width and few pane
 * widths reach; one column gives each the full width instead.
 */
export const DETAIL_STACK = 'flex min-w-0 flex-col gap-3.5';

/**
 * The detail view's scroller (the side pane, the drill-in body) as a size
 * container, so code inside can cap its height to the view's own (`cqh`).
 * Safe on these boxes: their size comes from the layout around them, never
 * from their content.
 */
export const DETAIL_VIEW = '[container-type:size]';

/**
 * The most a detail code block's area shows before it scrolls inside: the
 * view's height less its section heading and toolbar (≈ 3.5 rem), so once
 * scrolled to, a big source shows its whole area — scrollbar ends included —
 * with its heading; at least 10 rem (≈ 8 lines) on a short view, yet never
 * taller than the view (then the heading scrolls off, the area stays whole)
 * nor than the panel's visible height less the top bar, the view's padding
 * and the heading (7 rem: a drill-in on a short dock is taller than the
 * panel). Short code keeps its natural height. Code sits last in a detail,
 * so nothing waits below it.
 */
export const DETAIL_CODE_MAX_HEIGHT = 'min(100cqh, max(10rem, 100cqh - 3.5rem), 100dvh - 7rem)';

/** One fact line of a detail (an attribute the element carries, a size…). */
export interface DetailFact {
  readonly label: string;
  readonly value: string;
  /** The value is markup or an identifier (rendered mono). */
  readonly mono: boolean;
  /** The value holds line breaks to keep (one attribute per line). */
  readonly multiline?: boolean;
}

/**
 * A detail's facts as a two-column `dl` (label, value); nothing without facts.
 *
 * @param props.facts The facts, in reading order.
 * @param props.hook The list's `data-fdt` hook.
 */
export function FactList(props: { facts: readonly DetailFact[]; hook: string }): JSX.Element {
  return (
    <Show when={props.facts.length > 0}>
      <dl
        data-fdt={props.hook}
        class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-2xs"
      >
        <For each={props.facts}>
          {(fact) => (
            <>
              <dt class="text-fg-muted">{fact.label}</dt>
              <dd
                class={cn(
                  fact.mono ? 'font-mono break-all text-fg-primary' : 'text-fg-primary',
                  fact.multiline === true && 'whitespace-pre-line'
                )}
              >
                {fact.value}
              </dd>
            </>
          )}
        </For>
      </dl>
    </Show>
  );
}

/**
 * A titled detail section (a script's source, a style's CSS, a word's
 * possible definitions): caps heading (+ a muted aside) over its content.
 *
 * @param props.title The heading.
 * @param props.aside The muted text after it ("12 lines").
 * @param props.hook The section's `data-fdt` hook.
 * @param props.children The section body.
 */
export function DetailSection(props: {
  title: string;
  aside?: string;
  hook: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section data-fdt={props.hook} class="flex min-w-0 flex-col gap-1.5">
      <h3 class="flex items-baseline gap-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
        {props.title}
        <Show when={props.aside}>
          {(aside) => (
            <span class="font-normal tracking-normal normal-case tabular-nums">{aside()}</span>
          )}
        </Show>
      </h3>
      {props.children}
    </section>
  );
}
