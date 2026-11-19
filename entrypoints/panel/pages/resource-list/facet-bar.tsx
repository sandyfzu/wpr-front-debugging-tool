/**
 * The facet bar: a list's combinable filters around its search field.
 *
 * - **Inline** (a `regular` list): one wrapping line — each choice facet as a
 *   segmented group with per-value counts, each toggle facet as a chip, the
 *   search field last, pushed to the line's end.
 * - **Compact**: the search field and a "Filters" button carrying the count
 *   of narrowing picks, those picks as removable chips under them, and the
 *   facets in a bottom sheet (full-width segments) with Reset and a
 *   "Show N <rows>" close.
 *
 * The search field is the caller's element, mounted once and kept across a
 * tier change (focus and caret survive a resize); the sheet closes when the
 * list grows out of compact (focus left in it moves to the search field, the
 * Filters button having left with the tier). Counts and the selection are the caller's
 * (`facetCounts` / `FacetSelection`), so the bar holds only the sheet's
 * open state.
 */
import type { JSX } from 'solid-js';
import { children, createEffect, createSignal, createUniqueId, For, on, Show } from 'solid-js';
import SlidersHorizontal from 'lucide-solid/icons/sliders-horizontal';
import X from 'lucide-solid/icons/x';
import { Button } from '../../../../components/ui/button';
import { ChoiceGroup } from '../../../../components/ui/choice-group';
import { FOCUS_RING } from '../../../../components/ui/classes';
import { Sheet } from '../../../../components/ui/sheet';
import {
  activeFacetChips,
  choiceSegments,
  type ActiveFacetChip,
  facetValueOf,
  noFacetSelection,
  toggleState,
  withFacetValue
} from '../../../../lib/panel/facet-controls';
import {
  ANY_VALUE,
  TOGGLE_VALUE,
  type Facet,
  type FacetCounts,
  type FacetSelection,
  type FacetSet
} from '../../../../lib/panel/resource-facets';
import { formatCount } from '../../../../utils/format-count';
import { ToggleChip } from './toggle-chip';

/** Props of {@link FacetBar}. */
export interface FacetBarProps<Row, Id extends string> {
  /** The list's facets. */
  facets: FacetSet<Row, Id>;
  /** The current selection (controlled). */
  selection: FacetSelection<Id>;
  /** Per-value counts for the current selection + search. */
  counts: FacetCounts<Id>;
  /** Receives the next selection. */
  onChange: (next: FacetSelection<Id>) => void;
  /** The list is compact: fold the facets into the Filters sheet. */
  compact: boolean;
  /** The search field (mounted once, kept across tier changes). */
  search: JSX.Element;
  /** The filters group's accessible name ("Filter scripts"). */
  filterLabel: string;
  /** The rows the selection keeps, counted ("12 scripts"), for the sheet's close button. */
  shownLabel: string;
}

/**
 * One facet's control in either tier: segments for a choice, a chip for a
 * toggle. `stretch` = the sheet's full-width form (its caption a line above).
 *
 * @param props.facet The facet.
 * @param props.counts The facet counts.
 * @param props.selection The selection.
 * @param props.onChange The selection sink.
 * @param props.stretch The sheet form.
 */
function FacetControl<Row, Id extends string>(props: {
  facet: Facet<Row, Id>;
  counts: FacetCounts<Id>;
  selection: FacetSelection<Id>;
  onChange: (next: FacetSelection<Id>) => void;
  stretch: boolean;
}): JSX.Element {
  const value = (): string => facetValueOf(props.selection, props.facet.id);
  const counts = (): Readonly<Record<string, number>> => props.counts.byFacet[props.facet.id];
  const pick = (valueId: string): void => {
    props.onChange(withFacetValue(props.selection, props.facet.id, valueId));
  };
  const toggle = (): ReturnType<typeof toggleState> => toggleState(props.facet, counts(), value());
  const captionId = createUniqueId();
  return (
    <Show
      when={props.facet.kind === 'choice'}
      fallback={
        <ToggleChip
          value={props.facet.id}
          label={props.facet.label}
          pressed={toggle().pressed}
          count={toggle().count}
          disabled={toggle().disabled}
          onChange={(on) => {
            pick(on ? TOGGLE_VALUE : ANY_VALUE);
          }}
        />
      }
    >
      <Show
        when={props.stretch}
        fallback={
          <ChoiceGroup
            variant="segmented"
            label={props.facet.label}
            options={choiceSegments(props.facet, counts(), value())}
            value={value()}
            onChange={pick}
          />
        }
      >
        <div data-fdt="facet-sheet-row" class="flex flex-col gap-1.5">
          <div id={captionId} class="text-2xs font-medium text-fg-muted">
            {props.facet.label}
          </div>
          <ChoiceGroup
            variant="segmented"
            stretch
            aria-labelledby={captionId}
            options={choiceSegments(props.facet, counts(), value())}
            value={value()}
            onChange={pick}
          />
        </div>
      </Show>
    </Show>
  );
}

/** What takes focus when the Filters button is gone, in priority order (not document order). */
const FILTERS_FALLBACK_SELECTORS = [
  'input[type="search"]',
  'button:not(:disabled), input:not(:disabled)'
] as const;

/**
 * Where a closing sheet hands focus back: the Filters button that opened it,
 * or — once growing out of compact unmounted that button — the bar's search
 * field (else its first enabled control), so focus never drops to the body.
 *
 * @param bar The bar's root.
 * @param filtersButton The Filters button, if it ever mounted.
 * @returns The restore target, or undefined when the bar has nothing to focus.
 */
export function filtersRestoreTarget(
  bar: HTMLElement | undefined,
  filtersButton: HTMLElement | undefined
): HTMLElement | undefined {
  if (filtersButton?.isConnected === true) return filtersButton;
  for (const selector of FILTERS_FALLBACK_SELECTORS) {
    const found = bar?.querySelector<HTMLElement>(selector);
    if (found != null) return found;
  }
  return undefined;
}

/**
 * Render the facet bar in its current tier.
 *
 * @param props See {@link FacetBarProps}.
 */
export function FacetBar<Row, Id extends string>(props: FacetBarProps<Row, Id>): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let filtersButton: HTMLButtonElement | undefined;
  let bar: HTMLDivElement | undefined;
  // Resolved once: the field must survive a tier change (no rebuild per read).
  const search = children(() => props.search);
  const active = (): ActiveFacetChip<Id>[] => activeFacetChips(props.facets, props.selection);
  const choices = (): readonly Facet<Row, Id>[] =>
    props.facets.facets.filter((facet) => facet.kind === 'choice');
  const toggles = (): readonly Facet<Row, Id>[] =>
    props.facets.facets.filter((facet) => facet.kind === 'toggle');

  // Growing out of compact moves the facets inline: the sheet has nothing left to hold.
  createEffect(
    on(
      () => props.compact,
      (compact) => {
        if (!compact) setOpen(false);
      }
    )
  );

  return (
    <div ref={bar} data-fdt="facet-bar" data-fdt-compact={props.compact ? '' : undefined}>
      <div class="flex flex-wrap items-center gap-2">
        {/* A list without facets (search only) shows neither the group nor the Filters button. */}
        <Show when={!props.compact && props.facets.facets.length > 0}>
          <div
            role="group"
            aria-label={props.filterLabel}
            class="flex flex-wrap items-center gap-2"
          >
            <For each={props.facets.facets}>
              {(facet) => (
                <FacetControl
                  facet={facet}
                  counts={props.counts}
                  selection={props.selection}
                  onChange={props.onChange}
                  stretch={false}
                />
              )}
            </For>
          </div>
        </Show>
        {/* Wide: the field's own bounded width (an intrinsic-width wrapper would shrink it to its placeholder's start). */}
        <div class={props.compact ? 'min-w-0 flex-1' : 'ms-auto w-80 max-w-full'}>{search()}</div>
        <Show when={props.compact && props.facets.facets.length > 0}>
          <Button
            ref={filtersButton}
            data-fdt="facet-filters-button"
            aria-haspopup="dialog"
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters
            <Show when={active().length > 0}>
              <span
                data-fdt="facet-filters-count"
                class="rounded-full bg-accent-strong px-1.5 text-2xs text-on-accent tabular-nums"
              >
                {formatCount(active().length)}
              </span>
            </Show>
          </Button>
        </Show>
      </div>
      <Show when={props.compact && active().length > 0}>
        <div data-fdt="facet-chips" class="mt-1.5 flex flex-wrap items-center gap-1.5">
          <For each={active()}>
            {(chip) => (
              <button
                type="button"
                data-fdt="facet-chip"
                data-fdt-facet={chip.facetId}
                aria-label={`Remove filter ${chip.label}`}
                class={`inline-flex h-6 items-center gap-1 rounded-md bg-surface-3 px-2 text-2xs font-medium text-fg-secondary hover:text-fg-primary ${FOCUS_RING}`}
                onClick={() => {
                  props.onChange(withFacetValue(props.selection, chip.facetId, ANY_VALUE));
                  // The chip leaves with its pick: keep focus on the bar.
                  filtersButton?.focus();
                }}
              >
                {chip.label}
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </For>
        </div>
      </Show>
      <Sheet
        open={open()}
        onClose={() => setOpen(false)}
        title="Filters"
        restoreFocusTo={() => filtersRestoreTarget(bar, filtersButton)}
        actions={
          <Button
            size="sm"
            variant="ghost"
            data-fdt="facet-sheet-reset"
            onClick={() => {
              props.onChange(noFacetSelection<Id>());
            }}
          >
            Reset
          </Button>
        }
        footer={
          <Button
            variant="primary"
            class="w-full"
            data-fdt="facet-sheet-show"
            onClick={() => setOpen(false)}
          >
            Show {props.shownLabel}
          </Button>
        }
      >
        <div class="flex flex-col gap-3">
          <For each={choices()}>
            {(facet) => (
              <FacetControl
                facet={facet}
                counts={props.counts}
                selection={props.selection}
                onChange={props.onChange}
                stretch
              />
            )}
          </For>
          <Show when={toggles().length > 0}>
            <div class="flex flex-wrap items-center gap-1.5">
              <For each={toggles()}>
                {(facet) => (
                  <FacetControl
                    facet={facet}
                    counts={props.counts}
                    selection={props.selection}
                    onChange={props.onChange}
                    stretch
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </Sheet>
    </div>
  );
}
