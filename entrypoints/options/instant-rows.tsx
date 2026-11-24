/**
 * The options rows that apply the moment they change (registry kinds
 * `page-ui-gate`, `whats-new` and `chord`): each renders its instant
 * setting's state matrix — loading (a skeleton the control's shape), failed
 * (the reason + Retry), retrying (the reason held, Retry busy), ready — and
 * hands edits to the page's writers, which toast the outcome. No row touches
 * the page's draft.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch as Branch } from 'solid-js';
import TriangleExclamationPoint from 'lucide-solid/icons/triangle-exclamation-point';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  chordsEqual,
  DEFAULT_PALETTE_CHORD,
  formatChord,
  type PaletteChord
} from '../../lib/storage/palette-chord';
import type { ChordPlatform } from '../../lib/storage/palette-chord-platform';
import type { InstantSettingSnapshot } from '../../lib/options/instant-setting';
import { chordFiringCaveat } from '../../lib/options/chord-capture';
import type {
  ChordOptionRow,
  PageUiGateOptionRow,
  WhatsNewOptionRow
} from '../../lib/options/registry';
import { WHATS_NEW_PAGE_PATH } from '../../lib/release-notes/page-path';
import { WHATS_NEW_NAME } from '../../lib/release-notes/words';
import { FOCUS_RING } from '../../components/ui/classes';
import { ChordField } from './chord-field';
import {
  OPTION_ROW,
  OPTION_ROW_LINE,
  OPTION_ROW_STACKED,
  SWITCH_ROW_LINE_INDENT
} from './row-look';
import { cn } from '../../utils/cn';

/** The link's words. */
export const WHATS_NEW_LINK_TEXT = `Open ${WHATS_NEW_NAME}`;

/** How the instant rows reach their settings and writers (wired by the page). */
export interface InstantRowsScope {
  /** The gate's state. */
  readonly gate: () => InstantSettingSnapshot<boolean>;
  /** The shortcut's state. */
  readonly chord: () => InstantSettingSnapshot<PaletteChord>;
  /** The keyboard convention; null until the platform answer arrives. */
  readonly platform: () => ChordPlatform | null;
  /** A chord's key legend (layout-true when the layout is known). */
  readonly legend: (chord: PaletteChord) => string;
  /** The What's new setting's state. */
  readonly whatsNew: () => InstantSettingSnapshot<boolean>;
  /** Apply the What's new setting now. */
  readonly setWhatsNew: (next: boolean) => void;
  /** Retry the What's new setting's failed read. */
  readonly retryWhatsNew: () => void;
  /** Apply the gate now. */
  readonly setGate: (next: boolean) => void;
  /** Apply a captured shortcut now. */
  readonly setChord: (next: PaletteChord) => void;
  /** Retry the gate's failed read. */
  readonly retryGate: () => void;
  /** Retry the shortcut's failed read. */
  readonly retryChord: () => void;
  /** Re-read the keyboard layout (recording is about to start). */
  readonly refreshLayout: () => void;
}

/** The stable element id of a row's description. */
function descriptionId(rowId: string): string {
  return `option-${rowId}-description`;
}

/**
 * A failed instant read: the reason and a Retry (never a dead end). While a
 * retry is in flight the line says so and Retry is held `busy` — focusable,
 * so keyboard focus stays on it through the attempt.
 *
 * @param props.retrying A retry is in flight.
 * @param props.onRetry Re-runs the read.
 */
function ReadFailure(props: { retrying: boolean; onRetry: () => void }): JSX.Element {
  return (
    <div data-fdt="option-read-failure" class="flex flex-wrap items-center gap-1.5">
      <p class="text-2xs text-status-error">
        {props.retrying ? 'Reading the setting again…' : 'This setting could not be read.'}
      </p>
      <Button
        size="sm"
        busy={props.retrying}
        onClick={() => {
          props.onRetry();
        }}
      >
        Retry
      </Button>
    </div>
  );
}

/**
 * Whether an instant read shows its failure line (failed, or retrying it).
 *
 * @param snapshot The setting's snapshot.
 */
function readFailed(snapshot: InstantSettingSnapshot<unknown>): boolean {
  return snapshot.status === 'failed' || snapshot.status === 'retrying';
}

/**
 * The row's description (shared shape with the drafted rows).
 *
 * @param props.rowId The row's id (the description's element id).
 * @param props.text The registry copy.
 * @param props.indent Whether the line sits under a switch's label text.
 */
function Description(props: { rowId: string; text: string; indent?: boolean }): JSX.Element {
  return (
    <p
      id={descriptionId(props.rowId)}
      class={cn(OPTION_ROW_LINE, props.indent === true && SWITCH_ROW_LINE_INDENT)}
    >
      {props.text}
    </p>
  );
}

/**
 * One instant boolean row: the shared switch over its setting's state
 * matrix, the row's description, then any extra line (a link).
 *
 * @param props.row The registry row (copy).
 * @param props.snapshot The setting's state.
 * @param props.onSet Apply a flip now.
 * @param props.onRetry Retry a failed read.
 * @param props.children An extra line under the description.
 */
function InstantSwitchRow(props: {
  row: PageUiGateOptionRow | WhatsNewOptionRow;
  snapshot: InstantSettingSnapshot<boolean>;
  onSet: (next: boolean) => void;
  onRetry: () => void;
  children?: JSX.Element;
}): JSX.Element {
  const ready = (): Extract<InstantSettingSnapshot<boolean>, { status: 'ready' }> | null =>
    props.snapshot.status === 'ready' ? props.snapshot : null;
  return (
    <div data-fdt="option-row" data-fdt-option={props.row.id} class={OPTION_ROW}>
      <Branch>
        <Match when={readFailed(props.snapshot)}>
          <span class="text-xs font-medium text-fg-primary">{props.row.label}</span>
          <ReadFailure retrying={props.snapshot.status === 'retrying'} onRetry={props.onRetry} />
        </Match>
        <Match when={ready()}>
          {(setting) => (
            <Switch
              label={props.row.label}
              aria-describedby={descriptionId(props.row.id)}
              checked={setting().value}
              onChange={(next) => {
                props.onSet(next);
              }}
            />
          )}
        </Match>
        <Match when={props.snapshot.status === 'loading'}>
          <div class="flex min-h-6 items-center gap-1.5">
            {/* The switch's 36 px hit box around its 28 px pill: the label
                lands where the ready switch puts it (no shift). */}
            <span class="inline-flex w-9 shrink-0 justify-center">
              <Skeleton class="h-3.5 w-7 rounded-full" />
            </span>
            <span class="text-xs font-medium text-fg-primary">{props.row.label}</span>
          </div>
        </Match>
      </Branch>
      {/* Under the label text beside a switch (or its skeleton); flush under
          the failure line, which has no toggle. */}
      <Description
        rowId={props.row.id}
        text={props.row.description}
        indent={!readFailed(props.snapshot)}
      />
      {props.children}
    </div>
  );
}

/**
 * The on-page UI master switch.
 *
 * @param props.row The registry row (copy).
 * @param props.scope The wired settings.
 */
export function PageUiGateRow(props: {
  row: PageUiGateOptionRow;
  scope: InstantRowsScope;
}): JSX.Element {
  return (
    <InstantSwitchRow
      row={props.row}
      snapshot={props.scope.gate()}
      onSet={props.scope.setGate}
      onRetry={props.scope.retryGate}
    />
  );
}

/**
 * The "Show what's new after updates" switch, with the link that reopens
 * the page (always shown — reopening never depends on the setting).
 *
 * @param props.row The registry row (copy).
 * @param props.scope The wired settings.
 */
export function WhatsNewRow(props: {
  row: WhatsNewOptionRow;
  scope: InstantRowsScope;
}): JSX.Element {
  return (
    <InstantSwitchRow
      row={props.row}
      snapshot={props.scope.whatsNew()}
      onSet={props.scope.setWhatsNew}
      onRetry={props.scope.retryWhatsNew}
    >
      <p class={cn(OPTION_ROW_LINE, SWITCH_ROW_LINE_INDENT, 'pt-1')}>
        <a
          data-fdt="options-whats-new-link"
          href={WHATS_NEW_PAGE_PATH}
          target="_blank"
          class={cn('font-medium text-accent underline-offset-2 hover:underline', FOCUS_RING)}
        >
          {WHATS_NEW_LINK_TEXT}
        </a>
      </p>
    </InstantSwitchRow>
  );
}

/**
 * The palette shortcut row: the capture field, Reset to the default, the
 * gate's disabled note and the persistent Ctrl+Alt caveat.
 *
 * @param props.row The registry row (copy).
 * @param props.scope The wired settings.
 * @param props.disabledNote The cascade's note while the gate holds the row, else null.
 */
export function ChordRow(props: {
  row: ChordOptionRow;
  scope: InstantRowsScope;
  disabledNote: string | null;
}): JSX.Element {
  const noteId = (): string => `option-${props.row.id}-note`;
  const caveatId = (): string => `option-${props.row.id}-caveat`;
  /** The ready chord and its platform together — the field needs both. */
  const ready = (): { chord: PaletteChord; writing: boolean; platform: ChordPlatform } | null => {
    const chord = props.scope.chord();
    const platform = props.scope.platform();
    if (chord.status !== 'ready' || platform === null) return null;
    return { chord: chord.value, writing: chord.writing, platform };
  };
  const caveat = (): string | null => {
    const current = ready();
    if (current === null) return null;
    return chordFiringCaveat(current.chord, current.platform, props.scope.legend);
  };
  const describedBy = (): string =>
    [
      descriptionId(props.row.id),
      props.disabledNote === null ? null : noteId(),
      caveat() === null ? null : caveatId()
    ]
      .filter((id): id is string => id !== null)
      .join(' ');

  return (
    <div data-fdt="option-row" data-fdt-option={props.row.id} class={OPTION_ROW_STACKED}>
      {/* Once the field renders, its name carries the label (aria-label, label
          first) and this text is its render twin, hidden from readers — never
          a <label for>, whose click would start a recording. Before that it
          names the loading/failed row for everyone. */}
      <span
        aria-hidden={ready() === null ? undefined : 'true'}
        class="text-xs font-medium text-fg-primary"
      >
        {props.row.label}
      </span>
      <Branch>
        <Match when={readFailed(props.scope.chord())}>
          <ReadFailure
            retrying={props.scope.chord().status === 'retrying'}
            onRetry={props.scope.retryChord}
          />
        </Match>
        <Match when={ready()}>
          {(current) => (
            <div class="flex flex-wrap items-start gap-1.5">
              <ChordField
                idBase={props.row.id}
                label={props.row.label}
                describedBy={describedBy()}
                chord={current().chord}
                platform={current().platform}
                legend={props.scope.legend}
                disabled={props.disabledNote !== null}
                busy={current().writing}
                onCapture={(chord) => {
                  props.scope.setChord(chord);
                }}
                onRecordStart={() => {
                  props.scope.refreshLayout();
                }}
              />
              <Show when={!chordsEqual(current().chord, DEFAULT_PALETTE_CHORD)}>
                {/* The chord rides in parentheses in both the visible text
                    (glyphs) and the name (words), so the visible words stay
                    the start of the name (WCAG 2.5.3: say "Reset to default"). */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={props.disabledNote !== null}
                  aria-label={`Reset to default (${formatChord(DEFAULT_PALETTE_CHORD, current().platform, 'words', props.scope.legend(DEFAULT_PALETTE_CHORD))})`}
                  onClick={() => {
                    props.scope.setChord(DEFAULT_PALETTE_CHORD);
                  }}
                >
                  Reset to default (
                  {formatChord(
                    DEFAULT_PALETTE_CHORD,
                    current().platform,
                    'symbols',
                    props.scope.legend(DEFAULT_PALETTE_CHORD)
                  )}
                  )
                </Button>
              </Show>
            </div>
          )}
        </Match>
        <Match when={!readFailed(props.scope.chord())}>
          <Skeleton class="h-6 w-24" />
        </Match>
      </Branch>
      <Description rowId={props.row.id} text={props.row.description} />
      <Show when={props.disabledNote}>
        {(note) => (
          <p id={noteId()} class={OPTION_ROW_LINE}>
            {note()}
          </p>
        )}
      </Show>
      <Show when={caveat()}>
        {(text) => (
          <p
            id={caveatId()}
            data-fdt="chord-caveat"
            class="flex items-start gap-1 rounded-sm bg-status-warn-soft px-1.5 py-1 text-2xs leading-snug text-status-warn"
          >
            <TriangleExclamationPoint size={12} class="mt-px shrink-0" aria-hidden="true" />
            <span>
              <span class="font-medium">Heads-up: </span>
              {text()}
            </span>
          </p>
        )}
      </Show>
    </div>
  );
}
