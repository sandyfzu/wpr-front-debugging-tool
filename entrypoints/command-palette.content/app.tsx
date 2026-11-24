/**
 * The on-page command palette's view: the shared command palette (APG
 * combobox inside the dialog, mounted mode) over the rows the palette
 * module lists, and the inline confirm step a row may ask for (the master
 * gate's "this also turns off this palette" warning).
 *
 * Mount-driven per open: while closed nothing renders; every open is a
 * fresh surface (empty query, focus in the field, the command list). The
 * whole view sits in one top-layer element, re-shown on every open, so it
 * paints above every sibling surface and anything the page put in the top
 * layer before.
 */
import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from 'solid-js';
import type { Accessor, JSX } from 'solid-js';
import type { LucideIcon } from 'lucide-solid';
import Columns2 from 'lucide-solid/icons/columns-2';
import Gauge from 'lucide-solid/icons/gauge';
import ScanEye from 'lucide-solid/icons/scan-eye';
import ListFilter from 'lucide-solid/icons/list-filter';
import PowerOff from 'lucide-solid/icons/power-off';
import { CommandPalette, type PaletteCommand } from '../../components/ui/command-palette';
import { ModalDialog } from '../../components/ui/dialog';
import { rankCommands } from '../../components/ui/command-matcher';
import { hideFromTopLayer, showInTopLayer } from '../../components/injected-ui/top-layer';
import type { Logger } from '../../lib/logger';
import type { PaletteCommandId } from '../../lib/page-commands/commands';
import type { PaletteRowView } from '../../lib/page-commands/palette-rows';

/** Each palette command's leading icon (the compiler checks every row has one). */
const ROW_ICONS: Readonly<Record<PaletteCommandId, LucideIcon>> = {
  'side-by-side': Columns2,
  'psi-side-by-side': Gauge,
  'toggle-detection-widget': ScanEye,
  'exclusion-builder': ListFilter,
  'page-ui-gate': PowerOff
};

/** The dialog's accessible description on the page. */
const PAGE_PALETTE_DESCRIPTION = 'Filter the on-page actions, run the highlighted one';

/** One palette row as the combobox renders it. */
type PageRowCommand = PaletteCommand & { readonly row: PaletteRowView };

/**
 * The combobox row for one listed row.
 *
 * @param row The listed row.
 */
export function toPaletteCommand(row: PaletteRowView): PageRowCommand {
  return {
    id: row.id,
    label: row.label,
    keywords: row.keywords,
    icon: ROW_ICONS[row.id],
    ...(row.disabledNote === null ? {} : { disabled: true, disabledNote: row.disabledNote }),
    row
  };
}

/** Props of {@link PaletteApp}. */
export interface PaletteAppProps {
  /** Whether the palette is open. */
  readonly open: Accessor<boolean>;
  /** The rows to list (read once per open). */
  readonly rows: () => readonly PaletteRowView[];
  /**
   * The opening chord in the platform's notation, or null while unresolved
   * (read once per open, so a rebinding shows on the next open).
   */
  readonly chordHint: () => string | null;
  /** Run a row (the view closes first). */
  readonly onRun: (id: PaletteCommandId) => void;
  /** Dismiss (Escape, Tab, an outside pointer or focus move, Cancel). */
  readonly onDismiss: () => void;
  readonly log: Logger;
}

/**
 * Render the view.
 *
 * @param props See {@link PaletteAppProps}.
 */
export function PaletteApp(props: PaletteAppProps): JSX.Element {
  /** The top-layer element the dialogs portal into (set once rendered). */
  const [layer, setLayer] = createSignal<HTMLDivElement>();
  /** The row whose confirm step shows, or null for the command list. */
  const [confirming, setConfirming] = createSignal<PaletteRowView | null>(null);
  // The rows are a snapshot per open (the list never churns under the user).
  const commands = createMemo(() => (props.open() ? props.rows().map(toPaletteCommand) : []));
  // The chord hint, snapshotted per open like the rows.
  const chordHint = createMemo(() => (props.open() ? props.chordHint() : null));

  createEffect(
    on([() => props.open(), layer], ([isOpen, element]) => {
      if (element === undefined) return;
      if (isOpen) {
        setConfirming(null);
        showInTopLayer(element, props.log);
      } else {
        hideFromTopLayer(element, props.log);
      }
    })
  );

  const choose = (command: PageRowCommand): void => {
    if (command.row.disabledNote !== null) return;
    if (command.row.confirm !== null) setConfirming(command.row);
    else props.onRun(command.row.id);
  };

  return (
    <div class="cp-layer" ref={setLayer}>
      {/* Keyed: the callbacks get plain values, never accessors — the
          library's deferred teardown reads its props after the branch closed. */}
      <Show when={props.open() ? layer() : undefined} keyed>
        {(mount) => (
          <Switch>
            <Match when={confirming()} keyed>
              {(row) => (
                <ConfirmStep
                  row={row}
                  mount={mount}
                  onConfirm={() => {
                    props.onRun(row.id);
                  }}
                  onDismiss={props.onDismiss}
                />
              )}
            </Match>
            <Match when={confirming() === null}>
              <CommandPalette
                mount={mount}
                commands={commands()}
                filter={rankCommands}
                onRun={choose}
                onClose={props.onDismiss}
                description={PAGE_PALETTE_DESCRIPTION}
                footer={<ChordHint chord={chordHint()} />}
              />
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
}

/**
 * The palette's shortcut hint: the chord that opens it, in the platform's
 * notation — what the page listener actually matches, never a hardcoded
 * default. Nothing renders while the chord is unresolved.
 *
 * @param props.chord The formatted chord, or null.
 */
function ChordHint(props: { readonly chord: string | null }): JSX.Element {
  return (
    <Show when={props.chord} keyed>
      {(chord) => (
        <p class="cp-hint" data-fdt="palette-hint">
          Open with <kbd class="cp-kbd">{chord}</kbd>
        </p>
      )}
    </Show>
  );
}

/** Props of {@link ConfirmStep}. */
interface ConfirmStepProps {
  readonly row: PaletteRowView;
  readonly mount: HTMLElement;
  readonly onConfirm: () => void;
  readonly onDismiss: () => void;
}

/**
 * The inline confirm a row asks for: its title (the dialog's visible name),
 * the consequence sentence, Cancel first and the confirming action. Cancel
 * (the safe choice) takes focus in the task the step replaces the list, so
 * focus never sits on the page between the two dialogs (another UI could
 * take it there, which the non-modal confirm would read as an outside focus
 * and dismiss on).
 *
 * @param props See {@link ConfirmStepProps}.
 */
function ConfirmStep(props: ConfirmStepProps): JSX.Element {
  const confirm = (): NonNullable<PaletteRowView['confirm']> =>
    props.row.confirm ?? { title: props.row.label, body: '', action: props.row.label };
  /** The Cancel control, the step's initial focus. */
  let cancel: HTMLButtonElement | undefined;
  return (
    <ModalDialog
      mount={props.mount}
      title={confirm().title}
      description={confirm().body}
      onClose={props.onDismiss}
      initialFocus={() => cancel}
      class="cp-confirm"
    >
      <div class="cp-actions" data-fdt="palette-confirm">
        <button
          ref={(element) => {
            cancel = element;
          }}
          type="button"
          class="cp-button"
          data-fdt="palette-confirm-cancel"
          onClick={() => {
            props.onDismiss();
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          class="cp-button cp-button-primary"
          data-fdt="palette-confirm-action"
          onClick={() => {
            props.onConfirm();
          }}
        >
          {confirm().action}
        </button>
      </div>
    </ModalDialog>
  );
}
