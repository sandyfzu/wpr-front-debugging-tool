/**
 * The options page's row rendering: the registry's three section cards
 * (Improvements / Appearance / Features) projected as designed controls —
 * boolean rows ride the shared switch, the appearance tri-state rides the
 * shared choice group, every label+description pair is wired
 * (labelled/described) keyboard-complete.
 */

import type { JSX } from 'solid-js';
import { For } from 'solid-js';
import { Card } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import { ChoiceGroup, type ChoiceOption } from '../../components/ui/choice-group';
import { APPEARANCES, type Appearance } from '../../utils/theme';
import {
  optionRowsIn,
  OPTION_SECTIONS,
  type AppearanceOptionRow,
  type BooleanOptionRow,
  type OptionRow
} from '../../lib/options/registry';

/** The appearance row's three tiles, in the vocabulary's registry order. */
const APPEARANCE_LABELS: Record<Appearance, string> = {
  system: 'System default',
  dark: 'Dark',
  light: 'Light'
};
/** The choice rows' data, derived from the vocabulary (never a second order). */
const APPEARANCE_CHOICES: readonly ChoiceOption<Appearance>[] = APPEARANCES.map((appearance) =>
  Object.freeze({ value: appearance, label: APPEARANCE_LABELS[appearance] })
);

/** How the page reaches a row's pending value (the drafted options page). */
export interface OptionRowScope {
  /** The row's pending value (as the draft holds it). */
  read(row: OptionRow): boolean | Appearance;
  /**
   * Commit a pending edit for one row — the wired model's `setOption`.
   *
   * @param row The row being edited.
   * @param value The new pending value.
   */
  edit(row: OptionRow, value: boolean | Appearance): void;
}

/** The stable element id of a row's description (`aria-describedby` target). */
function describedBy(row: OptionRow): string {
  return `option-${row.id}-description`;
}

/** A section card's header: the title (an h2) over its one-line description. */
function SectionHeader(props: { title: string; description: string }): JSX.Element {
  return (
    <div data-fdt="options-section-heading" class="flex flex-col gap-0.5">
      <h2 class="text-sm font-medium text-fg-primary">{props.title}</h2>
      <p class="text-2xs text-fg-secondary">{props.description}</p>
    </div>
  );
}

/** One boolean option as the shared switch + its wired description. */
function BooleanRow(props: { row: BooleanOptionRow; scope: OptionRowScope }): JSX.Element {
  return (
    <div data-fdt="option-row" data-fdt-option={props.row.id} class="px-0.5 py-2">
      <Switch
        label={props.row.label}
        aria-describedby={describedBy(props.row)}
        checked={props.scope.read(props.row) === true}
        onChange={(next) => {
          props.scope.edit(props.row, next);
        }}
      />
      <p id={describedBy(props.row)} class="text-2xs leading-snug text-fg-secondary">
        {props.row.description}
      </p>
    </div>
  );
}

/** The appearance tri-state as the shared choice group + its wired description. */
function AppearanceRow(props: { row: AppearanceOptionRow; scope: OptionRowScope }): JSX.Element {
  return (
    <div
      data-fdt="option-row"
      data-fdt-option={props.row.id}
      class="flex flex-col gap-1.5 px-0.5 py-2"
    >
      {/* The row's label is announced by the group itself (aria-label below);
          the visible span is its render twin, hidden from readers twice. */}
      <span aria-hidden="true" class="text-xs font-medium text-fg-primary">
        {props.row.label}
      </span>
      <ChoiceGroup
        options={APPEARANCE_CHOICES}
        value={props.scope.read(props.row) as Appearance}
        onChange={(next) => {
          props.scope.edit(props.row, next);
        }}
        aria-label={props.row.label}
        aria-describedby={describedBy(props.row)}
      />
      <p id={describedBy(props.row)} class="text-2xs leading-snug text-fg-secondary">
        {props.row.description}
      </p>
    </div>
  );
}

/**
 * Render the registry's sections, each as one card holding exactly its rows.
 * The page renders nothing outside these cards: the registry is the only
 * authority for what the options page offers (appears verbatim).
 */
export function OptionSections(props: { scope: OptionRowScope }): JSX.Element {
  return (
    <For each={OPTION_SECTIONS}>
      {(section) => (
        <Card
          level={1}
          header={<SectionHeader title={section.title} description={section.description} />}
        >
          <div class="divide-y divide-line-1">
            <For each={optionRowsIn(section.id)}>
              {(row) => {
                if (row.kind === 'boolean') {
                  return <BooleanRow row={row} scope={props.scope} />;
                }
                return <AppearanceRow row={row} scope={props.scope} />;
              }}
            </For>
          </div>
        </Card>
      )}
    </For>
  );
}
