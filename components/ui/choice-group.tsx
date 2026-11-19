/**
 * The shared single-choice control — an APG radio-group rendered as one row of
 * tile labels, for every surface's "pick one of N" choice (the options page's
 * appearance tri-state is its first consumer). Keyboard-complete through the
 * platform's own radio semantics: the items' hidden inputs share one group
 * `name`, so arrow keys rove selection and Space toggles the focused radio —
 * the wrapper's job is only guaranteeing that contract (same-group radios,
 * label-linked tiles, a verified focus ring, and checked styling from the
 * data attributes) on top of Kobalte's headless parts.
 *
 * Two ways to take the group out of play: `disabled` (native: off the Tab
 * order) and `held` (a reason: reachable and announced as unavailable, the
 * reason as its tooltip, every change refused) — the latter for a group an
 * action holds for a moment, so keyboard focus never drops out of it.
 *
 * Two looks, one anatomy: `tiles` (default — bordered tiles, the checked one
 * accent-filled; injected UIs rely on it staying exactly as it is) and
 * `segmented` (opt-in — one tray, the checked segment raised, see
 * `segmented.ts`). The look only swaps classes: the radios, their naming and
 * the keyboard contract are the same in both.
 */
import type { JSX } from 'solid-js';
import { For, Show } from 'solid-js';
import { RadioGroup as KobalteRadioGroup } from '@kobalte/core';
// Plain joining, not `cn`: no caller fights the group's own utilities, and
// the conflict resolver would ship to every injected UI that mounts a group.
import { clsx } from 'clsx';
import {
  SEGMENT_BASE,
  SEGMENT_COUNT,
  SEGMENT_COUNT_TYPE,
  SEGMENT_STRETCH,
  SEGMENTED_CAPTION,
  SEGMENTED_TRAY,
  SEGMENTED_TRAY_STRETCH,
  segmentCountText,
  segmentStateClass
} from './segmented';

/** The group's look: `tiles` (default) or the opt-in `segmented` tray. */
export type ChoiceGroupVariant = 'tiles' | 'segmented';

/** One choice offered by a group. */
export interface ChoiceOption<T extends string> {
  /** The value reported on change (also the checked matcher). */
  readonly value: T;
  /** The tile's visible text (also the radio's accessible name, label-linked). */
  readonly label: string;
  /**
   * Whether this one choice is unavailable (dimmed, skipped by arrow keys,
   * never selectable); the caller says why next to the group.
   */
  readonly disabled?: boolean;
  /**
   * How many items this choice selects over (a non-negative integer), shown
   * muted after the label and part of the radio's accessible name. A zero
   * count stays selectable — pass `disabled` to refuse it.
   */
  readonly count?: number;
}

export interface ChoiceGroupProps<T extends string> {
  /** The choices, in display order. */
  options: readonly ChoiceOption<T>[];
  /** The selected value (null: none checked, still controlled); pair with `onChange`. */
  value: T | null;
  /** Called with the chosen value's {@link ChoiceOption.value}. */
  onChange: (value: T) => void;
  /** The look (default `tiles`, today's tiles; `segmented` opts into the tray). */
  variant?: ChoiceGroupVariant;
  /**
   * Segmented only: the tray spans its container and the segments share the
   * width (a bottom sheet's rows). Throws on the tiles look, which has no
   * stretched form.
   */
  stretch?: boolean;
  /**
   * A visible caption leading the options ("Delay"), muted; never blank
   * (throws). It names the group (Kobalte links it as `aria-labelledby`), so
   * pass no `aria-label` beside it — that would be appended to the name.
   */
  label?: string;
  /**
   * The group's accessible name — required unless `label` or
   * `aria-labelledby` names the group through a visible element; the wrapper
   * throws when all three are missing.
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
  /**
   * Why the whole group is held, or undefined when it is not: a held group
   * stays focusable (`aria-disabled`, never native `disabled`), shows the
   * reason as its tooltip, and refuses every selection change. An option's
   * own `disabled` still applies on top.
   */
  held?: string;
  /**
   * Extra classes on the group, appended last — joined, never
   * conflict-resolved: pass none that fights the group's own utilities.
   */
  class?: string;
}

/** What a tile's classes depend on (beyond the look). */
interface TileState {
  /** Whether this option is the controlled value. */
  readonly checked: boolean;
  /** Whether the whole group is disabled. */
  readonly groupDisabled: boolean;
  /** Whether the whole group is held. */
  readonly held: boolean;
  /** Whether this option alone is disabled. */
  readonly optionDisabled: boolean;
}

/** One look's class set — every look styles the same anatomy. */
interface ChoiceLook {
  /** The radio-group root. */
  readonly group: string;
  /** An item wrapper (carries the keyboard focus ring). */
  readonly item: string;
  /** The leading caption. */
  readonly caption: string;
  /**
   * A tile's visible label classes.
   *
   * @param state The tile's state.
   * @returns The joined classes.
   */
  tile(state: TileState): string;
  /**
   * A tile's count classes.
   *
   * @param checked Whether the tile is checked.
   * @returns The joined classes.
   */
  count(checked: boolean): string;
}

/**
 * The focus ring on an item wrapper: the hidden input keeps keyboard focus,
 * so `FOCUS_RING` (`:focus-visible` keyed on the element's own state) cannot
 * match the wrapper — the ancestor `:has` lights up the tile for real
 * keyboard focus only. Same outline values as `FOCUS_RING`.
 */
const ITEM_FOCUS_RING =
  'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-1 has-[input:focus-visible]:outline-accent';

/** Every look by variant — adding one is one row here. */
const CHOICE_LOOKS: Readonly<Record<ChoiceGroupVariant, ChoiceLook>> = {
  tiles: {
    // A held group dims once, on the group (never per tile: no compounding
    // with a host stylesheet that dims every `aria-disabled` element).
    group: 'flex flex-wrap items-center gap-1 data-held:opacity-50',
    item: clsx(
      'inline-flex rounded',
      ITEM_FOCUS_RING,
      // Disabled styling from Kobalte's `data-disabled` attribute —
      // `:disabled` never matches a div/label (only the hidden input
      // carries the disabled property).
      'data-disabled:opacity-50 data-disabled:cursor-not-allowed'
    ),
    caption: 'text-xs font-medium text-fg-muted',
    tile: (state) =>
      clsx(
        'flex h-7 select-none items-center justify-center whitespace-nowrap rounded border px-2 text-xs font-medium',
        state.checked
          ? 'border-transparent bg-accent-strong text-on-accent'
          : 'border-line-2 bg-surface-2 text-fg-primary',
        // Pointer feedback only while the group can change (a
        // disabled tile keeps its resting look).
        // A held tile reads as unavailable under the pointer too.
        state.held ? 'cursor-not-allowed' : 'cursor-pointer',
        !state.checked &&
          !state.groupDisabled &&
          !state.held &&
          !state.optionDisabled &&
          'hover:border-line-3 hover:bg-surface-3',
        // The item label also carries `data-disabled` from Kobalte's
        // dataset; the variant's specificity beats `cursor-pointer`.
        'data-disabled:opacity-50 data-disabled:cursor-not-allowed'
      ),
    // On the accent fill the count takes the fill's own text pair (AA-gated).
    count: (checked) => (checked ? `${SEGMENT_COUNT_TYPE} text-on-accent` : SEGMENT_COUNT)
  },
  segmented: {
    // No opacity anywhere (text stays readable, C-1): an unavailable
    // segment takes the muted text tone instead (`segmentStateClass`).
    group: SEGMENTED_TRAY,
    item: clsx('inline-flex rounded-md', ITEM_FOCUS_RING),
    caption: SEGMENTED_CAPTION,
    tile: (state) =>
      clsx(
        SEGMENT_BASE,
        segmentStateClass({
          selected: state.checked,
          unavailable: state.groupDisabled || state.held || state.optionDisabled
        })
      ),
    count: () => SEGMENT_COUNT
  }
};

/**
 * The segmented look stretched: full-width tray, each item and its tile
 * filling an equal share (the tile is already a centered flex box).
 */
const SEGMENTED_STRETCH_LOOK: ChoiceLook = {
  ...CHOICE_LOOKS.segmented,
  group: SEGMENTED_TRAY_STRETCH,
  item: clsx(CHOICE_LOOKS.segmented.item, SEGMENT_STRETCH),
  tile: (state) => clsx(CHOICE_LOOKS.segmented.tile(state), 'w-full')
};

/**
 * The look a group renders with.
 *
 * @param variant The requested variant (default `tiles`).
 * @param stretch Whether the segmented tray spans its container.
 * @returns The look.
 * @throws {@link Error} when `stretch` is asked of the tiles look (a wiring bug).
 */
function choiceLook(variant: ChoiceGroupVariant | undefined, stretch: boolean): ChoiceLook {
  const resolved = variant ?? 'tiles';
  if (!stretch) return CHOICE_LOOKS[resolved];
  if (resolved !== 'segmented') {
    throw new Error('ChoiceGroup: `stretch` needs the segmented variant.');
  }
  return SEGMENTED_STRETCH_LOOK;
}

/**
 * Render a single-choice group.
 *
 * Each option is one tile `<label for>` over a visually hidden native radio:
 * the label click selects, keyboard arrows rove (native radio-group behavior,
 * keyed on the shared `name`), and the checked tile swaps to its checked
 * look (accent fill, or the raised segment) instantly — selection is state,
 * never an animated change.
 *
 * @param props.options The choices in display order.
 * @param props.value The selected value (null: none checked).
 * @param props.onChange The selection callback.
 * @param props.variant The look (default `tiles`).
 * @param props.stretch Segmented only: span the container, segments sharing it.
 * @param props.label The visible caption naming the group.
 * @param props['aria-label'] The group's accessible name.
 * @param props['aria-labelledby'] The naming element's id (by reference).
 * @param props['aria-describedby'] The describing element's id.
 * @param props.disabled Disables every option (an option's own `disabled` disables it alone).
 * @param props.held Holds the group for that reason (focusable, changes refused).
 * @param props.class Extra classes on the group element.
 * @throws {@link Error} when the group is named neither by `label`, `aria-label`
 *   nor an `aria-labelledby` reference, or `label` is blank (a wiring bug —
 *   the radios would be nameless), when an option's `count` is not a
 *   non-negative integer, or when `stretch` is set on the tiles look.
 */
export function ChoiceGroup<T extends string>(props: ChoiceGroupProps<T>): JSX.Element {
  // Fail fast on an unlabeled group: the getter's call site is the JSX build
  // below, so the throw surfaces at mount — the wiring bug is named on the
  // first render, never silently carried as a nameless radio set.
  const naming = (): {
    'aria-label': string | undefined;
    'aria-labelledby': string | undefined;
  } => {
    if (
      props.label === undefined &&
      props['aria-label'] === undefined &&
      props['aria-labelledby'] === undefined
    ) {
      throw new Error(
        'ChoiceGroup: the group needs a label, an aria-label or an aria-labelledby reference.'
      );
    }
    // A blank caption would render nothing yet pass the check above: the
    // group would silently be nameless.
    if (props.label?.trim() === '') {
      throw new Error('ChoiceGroup: the label must not be empty or whitespace only.');
    }
    return { 'aria-label': props['aria-label'], 'aria-labelledby': props['aria-labelledby'] };
  };
  const held = (): boolean => props.held !== undefined;
  const look = (): ChoiceLook => choiceLook(props.variant, props.stretch === true);
  return (
    // No `name` prop: Kobalte falls back to its per-instance unique group id
    // (`radiogroup-<uid>`), the safe per-group contract — a hardcoded shared
    // name would merge any two groups in one document (arrow keys would rove
    // across them, selections would clobber).
    <KobalteRadioGroup.Root
      data-fdt="choice-group"
      orientation="horizontal"
      // `''` keeps the group controlled with nothing checked (`undefined`
      // would hand the selection to the group itself).
      value={props.value ?? ''}
      onChange={(value: string) => {
        // Refused while held: the group is controlled, so Kobalte re-syncs
        // every native radio to `value` and the attempted pick leaves no trace.
        if (!held()) props.onChange(value as T);
      }}
      {...naming()}
      aria-describedby={props['aria-describedby']}
      // Overrides Kobalte's own (native-disabled-only) attribute when held.
      aria-disabled={props.disabled === true || held() ? 'true' : undefined}
      data-held={held() ? '' : undefined}
      title={props.held}
      disabled={props.disabled}
      class={clsx(look().group, props.class)}
    >
      <Show when={props.label}>
        {(caption) => (
          // Kobalte registers its id as the group's `aria-labelledby`.
          <KobalteRadioGroup.Label data-fdt="choice-group-label" class={look().caption}>
            {caption()}
          </KobalteRadioGroup.Label>
        )}
      </Show>
      <For each={props.options}>
        {(option) => {
          // The control owns the selection; the tile reads it directly so the
          // two class lists are static per instance (never a variant race).
          const checked = (): boolean => option.value === props.value;
          // Validated at render: a bad count throws naming the option.
          const countText = (): string | undefined =>
            option.count === undefined ? undefined : segmentCountText(option.count, option.value);
          return (
            <KobalteRadioGroup.Item
              value={option.value}
              disabled={option.disabled === true}
              data-fdt="choice"
              data-fdt-choice-value={option.value}
              class={look().item}
            >
              <KobalteRadioGroup.ItemInput />
              <KobalteRadioGroup.ItemLabel
                class={look().tile({
                  checked: checked(),
                  groupDisabled: props.disabled === true,
                  held: held(),
                  optionDisabled: option.disabled === true
                })}
              >
                {option.label}
                <Show when={countText()}>
                  {(text) => (
                    <span data-fdt-choice-count class={look().count(checked())}>
                      {text()}
                    </span>
                  )}
                </Show>
              </KobalteRadioGroup.ItemLabel>
            </KobalteRadioGroup.Item>
          );
        }}
      </For>
    </KobalteRadioGroup.Root>
  );
}
