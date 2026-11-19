/**
 * A detail view's building blocks — the titled section (a script's source,
 * a style's CSS) and the facts list — shared, so every list's detail reads
 * the same.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';

/** One fact line of a detail (an attribute the element carries, a size…). */
export interface DetailFact {
  readonly label: string;
  readonly value: string;
  /** The value is markup or an identifier (rendered mono). */
  readonly mono: boolean;
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
              <dd class={fact.mono ? 'font-mono break-all text-fg-primary' : 'text-fg-primary'}>
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
 * A titled code section: caps heading (+ a muted aside) over its content.
 *
 * @param props.title The heading.
 * @param props.aside The muted text after it ("12 lines").
 * @param props.hook The section's `data-fdt` hook.
 * @param props.children The section body.
 */
export function CodeSection(props: {
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
