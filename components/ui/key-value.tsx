/**
 * The dense label/value row — the workhorse of the cards pages will fill
 * (Detections, the Diagnoser, sidebar inventories). One row: a quiet term on
 * the left, the detail taking the rest; mono/tabular-friendly spacing —
 * compact first, so evidence rows stack densely without losing scanability.
 */
import type { JSX } from 'solid-js';
import { For, Show, splitProps } from 'solid-js';
import { cn } from '../../utils/cn';

export type KeyValueProps = {
  /** The term's label — a feature, a server, a source. */
  term: string;
  /** The detail rendered next to (or under) the term: text, `Badge`, copy control, anything composable. */
  children: JSX.Element;
  /** `true` = the term gets its own line above the detail; inline by default. */
  stacked?: boolean;
  /** Whether the dotted leader stretches between term and detail in inline rows (default `true`). */
  leader?: boolean;
  /** Extra classes on the row, merged last so callers win. */
  class?: string;
};

export type TermValue = {
  /** The term's label. */
  term: string;
  /** The detail rendered for the term. */
  value: JSX.Element;
  /** Whether this row renders stacked (rare; per-row override). */
  stacked?: boolean;
};

export type KeyValueListProps = {
  /** The rows in display order. */
  items: TermValue[];
  /** Whether dotted leaders stretch between term and detail (default `true`). */
  leader?: boolean;
  /** Extra classes on the list container, merged last so callers win. */
  class?: string;
};

/**
 * Render one label/value row.
 *
 * The term is muted and never selectable copy; the value is the row's payload
 * and stays caller-owned, so rows compose (`KeyValue( term='Version', … )`
 * with a badge or a copy control inside) instead of re-implementing. Stacked
 * rows drop the leader (it has nowhere to run).
 *
 * @param props.term The label.
 * @param props.children The detail.
 * @param props.stacked Whether the term keeps its own line above the detail.
 * @param props.leader Whether the dotted leader runs (default `true`; inline rows only).
 * @param props.class Extra classes on the row.
 */
export function KeyValue(props: KeyValueProps): JSX.Element {
  return (
    <div
      data-fdt="key-value"
      data-fdt-stacked={props.stacked === true ? '' : undefined}
      class={cn(
        'text-xs leading-snug',
        props.stacked === true ? 'flex flex-col gap-y-0.5' : 'flex min-w-0 items-baseline gap-x-2',
        props.class
      )}
    >
      <span data-fdt-key-value-term class="shrink-0 text-fg-muted">
        {props.term}
      </span>
      <Show when={props.stacked !== true && (props.leader ?? true)} fallback={undefined}>
        <span aria-hidden="true" class="min-w-4 flex-1 self-center overflow-hidden">
          <span class="block h-px w-full border-t border-dotted border-line-2" />
        </span>
      </Show>
      <span data-fdt-key-value-value class={cn('min-w-0', props.stacked !== true && 'text-end')}>
        {props.children}
      </span>
    </div>
  );
}

/**
 * Render a whole key/value ledger — the data-driven form of `KeyValue` rows.
 *
 * Rows are declared as data, so the container owns spacing and leader policy
 * once and each row is rendered by the same standalone primitive.
 *
 * @param props.items The rows in order.
 * @param props.leader Whether the dotted leaders run (default `true`).
 * @param props.class Extra classes on the list.
 */
export function KeyValueList(props: KeyValueListProps): JSX.Element {
  const [own, rest] = splitProps(props, ['items', 'leader', 'class']);
  return (
    <div data-fdt="key-value-list" class={cn('flex flex-col gap-y-1', own.class)} {...rest}>
      <For each={own.items}>
        {(item) => (
          <KeyValue term={item.term} stacked={item.stacked} leader={own.leader}>
            {item.value}
          </KeyValue>
        )}
      </For>
    </div>
  );
}
