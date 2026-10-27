/**
 * The options page's row rendering: the registry's three section cards
 * (Improvements / Appearance / Features) projected as designed controls —
 * boolean rows ride the shared switch, the appearance tri-state rides the
 * shared choice group, the instant rows (gate, shortcut) render from
 * `./instant-rows`; every label+description pair is wired
 * (labelled/described) keyboard-complete. The gate cascade is data-driven:
 * a row carrying the registry's `onPage` marker disables with its note
 * while the gate is off.
 */

import type { JSX } from 'solid-js';
import { For, Match, Show, Switch as Branch } from 'solid-js';
import { Card } from '../../components/ui/card';
import { Switch } from '../../components/ui/switch';
import { ChoiceGroup, type ChoiceOption } from '../../components/ui/choice-group';
import { APPEARANCES, type Appearance } from '../../utils/theme';
import {
  onPageDisabledNote,
  optionRowsIn,
  OPTION_SECTIONS,
  type AppearanceOptionRow,
  type BooleanOptionRow,
  type DraftedOptionRow,
  type OptionRow
} from '../../lib/options/registry';
import { ChordRow, PageUiGateRow, type InstantRowsScope } from './instant-rows';

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
  read(row: DraftedOptionRow): boolean | Appearance;
  /**
   * Commit a pending edit for one row — the wired model's `setOption`.
   *
   * @param row The row being edited.
   * @param value The new pending value.
   */
  edit(row: DraftedOptionRow, value: boolean | Appearance): void;
}

/**
 * The watched gate for the cascade: its value once known, else null (an
 * unknown gate disables nothing).
 *
 * @param instant The instant rows' scope.
 */
function watchedGate(instant: InstantRowsScope): boolean | null {
  const gate = instant.gate();
  return gate.status === 'ready' ? gate.value : null;
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

/**
 * One boolean option as the shared switch + its wired description; held
 * with the cascade's note while the gate disables it.
 */
function BooleanRow(props: {
  row: BooleanOptionRow;
  scope: OptionRowScope;
  disabledNote: string | null;
}): JSX.Element {
  const noteId = (): string => `option-${props.row.id}-note`;
  return (
    <div data-fdt="option-row" data-fdt-option={props.row.id} class="px-0.5 py-2">
      <Switch
        label={props.row.label}
        aria-describedby={
          props.disabledNote === null
            ? describedBy(props.row)
            : `${describedBy(props.row)} ${noteId()}`
        }
        checked={props.scope.read(props.row) === true}
        disabled={props.disabledNote !== null}
        onChange={(next) => {
          props.scope.edit(props.row, next);
        }}
      />
      <p id={describedBy(props.row)} class="text-2xs leading-snug text-fg-secondary">
        {props.row.description}
      </p>
      <Show when={props.disabledNote}>
        {(note) => (
          <p id={noteId()} class="text-2xs leading-snug text-fg-secondary">
            {note()}
          </p>
        )}
      </Show>
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
 * Render one registry row by kind.
 *
 * @param props.row The row.
 * @param props.scope The drafted rows' scope.
 * @param props.instant The instant rows' scope (also the cascade's gate).
 */
function OptionRowView(props: {
  row: OptionRow;
  scope: OptionRowScope;
  instant: InstantRowsScope;
}): JSX.Element {
  const note = (): string | null => onPageDisabledNote(props.row, watchedGate(props.instant));
  // Registry rows are immutable data: each row matches exactly one kind.
  return (
    <Branch>
      <Match when={props.row.kind === 'boolean' ? props.row : undefined}>
        {(row) => <BooleanRow row={row()} scope={props.scope} disabledNote={note()} />}
      </Match>
      <Match when={props.row.kind === 'appearance' ? props.row : undefined}>
        {(row) => <AppearanceRow row={row()} scope={props.scope} />}
      </Match>
      <Match when={props.row.kind === 'page-ui-gate' ? props.row : undefined}>
        {(row) => <PageUiGateRow row={row()} scope={props.instant} />}
      </Match>
      <Match when={props.row.kind === 'chord' ? props.row : undefined}>
        {(row) => <ChordRow row={row()} scope={props.instant} disabledNote={note()} />}
      </Match>
    </Branch>
  );
}

/**
 * Render the registry's sections, each as one card holding exactly its rows.
 * The page renders nothing outside these cards: the registry is the only
 * authority for what the options page offers (appears verbatim).
 *
 * @param props.scope The drafted rows' scope.
 * @param props.instant The instant rows' scope.
 */
export function OptionSections(props: {
  scope: OptionRowScope;
  instant: InstantRowsScope;
}): JSX.Element {
  return (
    <For each={OPTION_SECTIONS}>
      {(section) => (
        <Card
          level={1}
          header={<SectionHeader title={section.title} description={section.description} />}
        >
          <div class="divide-y divide-line-1">
            <For each={optionRowsIn(section.id)}>
              {(row) => <OptionRowView row={row} scope={props.scope} instant={props.instant} />}
            </For>
          </div>
        </Card>
      )}
    </For>
  );
}
