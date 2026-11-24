/**
 * The options page's row rendering: the registry's three section cards
 * (Improvements / Appearance / Features, calm rows with no hairlines)
 * projected as designed controls —
 * boolean rows ride the shared switch, the appearance tri-state rides the
 * shared choice group's segmented tray, the instant rows (gate, shortcut, What's new) render from
 * `./instant-rows`; every label+description pair is wired
 * (labelled/described) keyboard-complete. The gate cascade is data-driven:
 * a row carrying the registry's `onPage` marker disables with its note
 * while the gate is off. Drafted rows render only once the draft is loaded;
 * the instant rows never wait on it (a failed `sync:options` read must not
 * hide the gate's switch) — a card left with no row is not rendered.
 */

import type { JSX } from 'solid-js';
import { For, Match, Show, Switch as Branch } from 'solid-js';
import { Switch } from '../../components/ui/switch';
import { ChoiceGroup, type ChoiceOption } from '../../components/ui/choice-group';
import { APPEARANCES, type Appearance } from '../../utils/theme';
import { cn } from '../../utils/cn';
import {
  isDraftedOptionRow,
  onPageDisabledNote,
  optionRowsIn,
  OPTION_SECTIONS,
  type AppearanceOptionRow,
  type BooleanOptionRow,
  type DraftedOptionRow,
  type OptionRow
} from '../../lib/options/registry';
import { ChordRow, PageUiGateRow, WhatsNewRow, type InstantRowsScope } from './instant-rows';
import { SectionCard } from './section-card';
import {
  OPTION_ROW,
  OPTION_ROW_LINE,
  OPTION_ROW_STACKED,
  SWITCH_ROW_LINE_INDENT
} from './row-look';

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
    <div data-fdt="option-row" data-fdt-option={props.row.id} class={OPTION_ROW}>
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
      <p id={describedBy(props.row)} class={cn(OPTION_ROW_LINE, SWITCH_ROW_LINE_INDENT)}>
        {props.row.description}
      </p>
      <Show when={props.disabledNote}>
        {(note) => (
          <p id={noteId()} class={cn(OPTION_ROW_LINE, SWITCH_ROW_LINE_INDENT)}>
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
    <div data-fdt="option-row" data-fdt-option={props.row.id} class={OPTION_ROW_STACKED}>
      {/* The row's label is announced by the group itself (aria-label below);
          the visible span is its render twin, hidden from readers twice. */}
      <span aria-hidden="true" class="text-xs font-medium text-fg-primary">
        {props.row.label}
      </span>
      <ChoiceGroup
        variant="segmented"
        options={APPEARANCE_CHOICES}
        value={props.scope.read(props.row) as Appearance}
        onChange={(next) => {
          props.scope.edit(props.row, next);
        }}
        aria-label={props.row.label}
        aria-describedby={describedBy(props.row)}
      />
      <p id={describedBy(props.row)} class={OPTION_ROW_LINE}>
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
      <Match when={props.row.kind === 'whats-new' ? props.row : undefined}>
        {(row) => <WhatsNewRow row={row()} scope={props.instant} />}
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
 * @param props.drafted Whether the draft is loaded (drafted rows render only then).
 */
export function OptionSections(props: {
  scope: OptionRowScope;
  instant: InstantRowsScope;
  drafted: boolean;
}): JSX.Element {
  return (
    <For each={OPTION_SECTIONS}>
      {(section) => {
        // Same row objects on every pass, so `For` keeps the mounted rows.
        const rows = (): readonly OptionRow[] =>
          optionRowsIn(section.id).filter((row) => props.drafted || !isDraftedOptionRow(row));
        return (
          <Show when={rows().length > 0}>
            <SectionCard
              headingHook="options-section-heading"
              title={section.title}
              description={section.description}
            >
              <For each={rows()}>
                {(row) => <OptionRowView row={row} scope={props.scope} instant={props.instant} />}
              </For>
            </SectionCard>
          </Show>
        );
      }}
    </For>
  );
}
