/**
 * The shared single-choice control — an APG radio-group rendered as one row of
 * tile labels, for every surface's "pick one of N" choice (the options page's
 * appearance tri-state is its first consumer). Keyboard-complete through the
 * platform's own radio semantics: the items' hidden inputs share one group
 * `name`, so arrow keys rove selection and Space toggles the focused radio —
 * the wrapper's job is only guaranteeing that contract (same-group radios,
 * label-linked tiles, a verified focus ring, and checked styling from the
 * data attributes) on top of Kobalte's headless parts.
 */
import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { RadioGroup as KobalteRadioGroup } from '@kobalte/core';
import { cn } from '../../utils/cn';

/** One choice offered by a group. */
export interface ChoiceOption<T extends string> {
  /** The value reported on change (also the checked matcher). */
  readonly value: T;
  /** The tile's visible text (also the radio's accessible name, label-linked). */
  readonly label: string;
}

export interface ChoiceGroupProps<T extends string> {
  /** The choices, in display order. */
  options: readonly ChoiceOption<T>[];
  /** The selected value; pair with `onChange`. */
  value: T;
  /** Called with the chosen value's {@link ChoiceOption.value}. */
  onChange: (value: T) => void;
  /**
   * The group's accessible name — required unless `aria-labelledby` names the
   * group through a visible element; the wrapper throws when both are missing.
   */
  'aria-label'?: string;
  /**
   * Accessible name by reference instead: the id of a visible element naming
   * the group (a row's label text). Takes precedence over `aria-label` on the
   * accessible object (both reach the radio inputs through Kobalte).
   */
  'aria-labelledby'?: string;
  /**
   * Accessible description: the id of the element describing the choice set
   * (a row's explanatory sentence). Kobalte aggregates it onto every hidden
   * radio input, so reading any single radio carries the whole row's meaning.
   */
  'aria-describedby'?: string;
  /** Whether the whole group is disabled (dimmed, still hoverable). */
  disabled?: boolean;
  /** Extra classes on the group, merged last so callers win. */
  class?: string;
}

/**
 * Render a single-choice group.
 *
 * Each option is one tile `<label for>` over a visually hidden native radio:
 * the label click selects, keyboard arrows rove (native radio-group behavior,
 * keyed on the shared `name`), and the checked tile swaps to the accent fill
 * instantly — selection is state, never an animated change.
 *
 * @param props.options The choices in display order.
 * @param props.value The selected value.
 * @param props.onChange The selection callback.
 * @param props['aria-label'] The group's accessible name.
 * @param props['aria-labelledby'] The naming element's id (by reference).
 * @param props['aria-describedby'] The describing element's id.
 * @param props.disabled Disables every option.
 * @param props.class Extra classes on the group element.
 * @throws {@link Error} when the group is named neither by `aria-label` nor by
 *   an `aria-labelledby` reference (a wiring bug — the radios would be nameless).
 */
export function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>): JSX.Element {
  // Fail fast on an unlabeled group: the getter's call site is the JSX build
  // below, so the throw surfaces at mount — the wiring bug is named on the
  // first render, never silently carried as a nameless radio set.
  const naming = (): {
    'aria-label': string | undefined;
    'aria-labelledby': string | undefined;
  } => {
    if (props['aria-label'] === undefined && props['aria-labelledby'] === undefined) {
      throw new Error(
        'ChoiceGroup: the group needs an aria-label or an aria-labelledby reference.'
      );
    }
    return { 'aria-label': props['aria-label'], 'aria-labelledby': props['aria-labelledby'] };
  };
  return (
    // No `name` prop: Kobalte falls back to its per-instance unique group id
    // (`radiogroup-<uid>`), the safe per-group contract — a hardcoded shared
    // name would merge any two groups in one document (arrow keys would rove
    // across them, selections would clobber).
    <KobalteRadioGroup.Root
      data-fdt="choice-group"
      orientation="horizontal"
      value={props.value}
      onChange={(value: string) => {
        props.onChange(value as T);
      }}
      {...naming()}
      aria-describedby={props['aria-describedby']}
      disabled={props.disabled}
      class={cn('flex flex-wrap items-center gap-1', props.class)}
    >
      <For each={props.options}>
        {(option) => {
          // The control owns the selection; the tile reads it directly so the
          // two class lists are static per instance (never a variant race).
          const checked = (): boolean => option.value === props.value;
          return (
            <KobalteRadioGroup.Item
              value={option.value}
              data-fdt="choice"
              data-fdt-choice-value={option.value}
              // The focus ring rides the item wrapper: the hidden input keeps
              // keyboard focus, so FOCUS_RING (`:focus-visible` keyed on the
              // element's own state) cannot match the wrapper — the ancestor
              // `:has` lights up the tile for real keyboard focus only.
              class={cn(
                'inline-flex rounded',
                'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent',
                // Disabled styling from Kobalte's `data-disabled` attribute —
                // `:disabled` never matches a div/label (only the hidden input
                // carries the disabled property).
                'data-disabled:opacity-50 data-disabled:cursor-not-allowed'
              )}
            >
              <KobalteRadioGroup.ItemInput />
              <KobalteRadioGroup.ItemLabel
                class={cn(
                  'flex h-7 cursor-pointer select-none items-center justify-center whitespace-nowrap rounded border px-2 text-xs font-medium',
                  checked()
                    ? 'border-transparent bg-accent-strong text-on-accent'
                    : 'border-line-2 bg-surface-2 text-fg-primary hover:border-line-3 hover:bg-surface-3',
                  // The item label also carries `data-disabled` from Kobalte's
                  // dataset; the variant's specificity beats `cursor-pointer`.
                  'data-disabled:opacity-50 data-disabled:cursor-not-allowed'
                )}
              >
                {option.label}
              </KobalteRadioGroup.ItemLabel>
            </KobalteRadioGroup.Item>
          );
        }}
      </For>
    </KobalteRadioGroup.Root>
  );
}
