/**
 * The filter bar — the one filter pattern for every list page (one
 * mechanism per mechanism kind): filter chips (single-select,
 * keyboard-operable, counts exposed in each chip's name) + the search field
 * (wave-1 `Input`). It replaces per-page filter button rows and ad-hoc
 * search inputs — selection is carried in `aria-pressed` (never by
 * background color alone).
 */
import type { JSX } from 'solid-js';
import { For, Show, splitProps } from 'solid-js';
import Search from 'lucide-solid/icons/search';
import { cn } from '../../utils/cn';
import { DISABLED, FOCUS_RING } from './classes';
import { Input } from './input';

/** One filter chip in the registry — declared by its owning page. */
export interface FilterChip {
  /** Stable chip value carried to `onSelect` and the test hooks. */
  value: string;
  /** The visible label ("All", "Delayed", …). */
  label: string;
  /**
   * The count this chip selects over — rendered inside the chip and exposed
   * via the count hook so lists answer "how many" before being opened.
   */
  count: number;
  /** Whether the chip is selectable now (default `true`). */
  disabled?: boolean;
}

export type FilterBarProps = {
  /** The chips in registry order (pages own their set — this bar is set-agnostic). */
  chips: FilterChip[];
  /** The selected chip value; `undefined` = none selected (severity: see `onSelect`). */
  selected?: string;
  /** Selection change callback. */
  onSelect?: (value: string) => void;
  /** The accessible name of the chip group (default "Filters"). */
  filterLabel?: string;
  /** The search input's current value (controlled; the owning page owns the debouncing). */
  searchQuery?: string;
  /** Search-value change callback (input's `onInput` payload). */
  onSearchChange?: (query: string) => void;
  /** The search input's placeholder (default "Search…"). */
  searchPlaceholder?: string;
  /** The accessible name of the search field (default "Search"). */
  searchLabel?: string;
  /** Whether the search field renders (default `true`). */
  showSearch?: boolean;
  /** Extra classes on the bar, merged last so callers win. */
  class?: string;
};

/**
 * Render the filter bar: a named chip group and the shared search field.
 *
 * Chip semantics: each is a `button` with `aria-pressed` (single-select
 * toggle-button group) — natively keyboard-operable (Tab + Enter/Space) —
 * and the selected chip carries `data-fdt-selected` beside the
 * `aria-pressed` attribute. Each chip's accessible name includes its count
 * ("Delayed 12 matching"), so the pre-open answer "how many" is
 * announced, not just painted. Search semantics: an `Input` typed `search`
 * (the browser's built-in clear affordance comes with the type) wired
 * through the page's controlled value loop; this bar adds zero input
 * logic of its own.
 *
 * @param props.chips The chips.
 * @param props.selected The selected chip value (undefined: nothing selected).
 * @param props.onSelect Selection change (1 callback to the page).
 * @param props.filterLabel The chip group's accessible name (default "Filters").
 * @param props.searchQuery The search field's controlled value.
 * @param props.onSearchChange Search-value change.
 * @param props.searchPlaceholder Field placeholder (default "Search…").
 * @param props.searchLabel Field aria-label (default "Search").
 * @param props.showSearch Whether the search field renders (default `true`).
 * @param props.class Extra classes on the bar.
 */
export function FilterBar(props: FilterBarProps): JSX.Element {
  const [own, rest] = splitProps(props, [
    'chips',
    'selected',
    'onSelect',
    'filterLabel',
    'searchQuery',
    'onSearchChange',
    'searchPlaceholder',
    'searchLabel',
    'showSearch',
    'class'
  ]);

  return (
    <div data-fdt="filter-bar" class={cn('flex flex-col gap-y-1.5', own.class)} {...rest}>
      <div
        class="flex flex-wrap items-center gap-1"
        role="group"
        aria-label={own.filterLabel ?? 'Filters'}
      >
        <For each={own.chips}>
          {(chip) => (
            <FilterChipButton
              chip={chip}
              selected={own.selected === chip.value}
              onSelect={own.onSelect}
            />
          )}
        </For>
      </div>
      <Show when={own.showSearch ?? true}>
        <div class="relative flex items-center">
          <Search
            size={14}
            class="pointer-events-none absolute start-2 text-fg-muted"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label={own.searchLabel ?? 'Search'}
            placeholder={own.searchPlaceholder ?? 'Search…'}
            value={own.searchQuery}
            onInput={(event) => own.onSearchChange?.(event.currentTarget.value)}
            class="ps-7"
          />
        </div>
      </Show>
    </div>
  );
}

/** Chip button class: the soft fill selected, quiet outline otherwise. */
const CHIP_BASE = cn(
  'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-2xs font-medium whitespace-nowrap',
  FOCUS_RING,
  DISABLED
);

/** The unselected look: an outlined ghost chip at the page surface. */
const CHIP_UNSELECTED = cn(
  'border-line-2 bg-surface-2 text-fg-secondary',
  'hover:border-line-3 hover:text-fg-primary'
);

/** The selected look: the accent-riding chip (pressed also gets fuller text). */
const CHIP_SELECTED = cn(
  'border-accent-strong bg-accent-strong text-on-accent',
  'hover:brightness-110'
);

/**
 * Render one chip.
 *
 * Selection lands on `aria-pressed` + `data-fdt-selected` (+ the accent
 * fill): three redundant carriers so state survives each channel — color
 * alone is never the selected signal. The accessible name is computed from
 * the chip's own content — the visible label, the visible count, a visually
 * hidden " matching" — so it reads "Delayed 12 matching" while starting
 * with, and containing, exactly the visible text (WCAG 2.5.3 label-in-name;
 * an `aria-label` would replace the content and drift from it). No comma
 * after the label: the count is a flex item, and name computation (Chromium
 * and the test runner alike) puts a space around it, so a hidden comma
 * could never sit flush against the label.
 *
 * @param props.chip The chip data.
 * @param props.selected Whether this chip is the selected one.
 * @param props.onSelect Selection callback.
 */
function FilterChipButton(props: {
  chip: FilterChip;
  selected: boolean;
  onSelect: FilterBarProps['onSelect'];
}): JSX.Element {
  return (
    <button
      type="button"
      data-fdt="filter-chip"
      data-fdt-filter-chip={props.chip.value}
      data-fdt-selected={props.selected ? '' : undefined}
      aria-pressed={props.selected}
      disabled={props.chip.disabled}
      onClick={() => props.onSelect?.(props.chip.value)}
      class={cn(CHIP_BASE, props.selected ? CHIP_SELECTED : CHIP_UNSELECTED)}
    >
      {props.chip.label}
      <span
        data-fdt-filter-count
        class={cn(
          'rounded-full px-1 text-2xs tabular-nums',
          props.selected ? 'bg-on-accent/20' : 'bg-surface-3'
        )}
      >
        {props.chip.count}
      </span>
      <span class="sr-only"> matching</span>
    </button>
  );
}
