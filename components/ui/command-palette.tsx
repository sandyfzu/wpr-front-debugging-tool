/**
 * The command palette's combobox — the APG combobox the study's keyboard
 * contract commits to, shaped for command execution rather than form values.
 *
 * The surface: a `role="combobox"` field (`aria-expanded`, `aria-controls`,
 * `aria-autocomplete="list"`, `aria-activedescendant` — caret focus stays in
 * the field) over its `role="listbox"`; arrows move the highlight with wrap
 * (disabled rows rendered but never rested on), Home/End jump to the enabled
 * ends, Enter runs the highlighted row, a click runs a row, Tab and Escape
 * dismiss. The highlight starts on the top-ranked enabled row and re-arms on
 * every query, so Enter runs the best match without an arrow key.
 *
 * Why its own combobox and not the UI library's: the library's combobox
 * speaks through a page-global live announcer it creates in `document.body`
 * — for an injected palette, a write into the host page being debugged,
 * outside the shadow root and never removed. This one writes only inside
 * its own render tree; its single polite live region (the always-mounted
 * `role="status"`) carries the result count, the no-match line and, on
 * Apple platforms, the highlighted row.
 *
 * Matching/ranking is injected ({@link CommandPaletteProps.filter}): the
 * component renders the ranked result as given. The dialog shell supplies
 * focus handling and dismissals.
 */
import type { JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import type { LucideIcon } from 'lucide-solid';
import Search from 'lucide-solid/icons/search';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';
import {
  fieldHighlightMove,
  highlightAfterRank,
  isApplePlatform,
  moveHighlight,
  noMatchText,
  paletteAnnouncement,
  scrollDeltaToReveal,
  type AnnouncementCause
} from './command-palette-model';
import { ModalDialog, type ModalDialogVariant } from './dialog';

/** One runnable entry of the palette: a page or an action. */
export interface PaletteCommand {
  /** Stable identity — the row's key and the consumer's dispatch key. */
  id: string;
  /** The row's primary text (and the matcher's first vocabulary). */
  label: string;
  /** Extra lowercase words the matcher scores when the label alone is not enough. */
  keywords?: readonly string[];
  /** Row leading icon (pages carry their nav icon; actions theirs). */
  icon?: LucideIcon;
  /** Short type/note rendered right of the label (e.g. the journey group). */
  hint?: string;
  /** The row exists but cannot run right now (rendered, jumped past). */
  disabled?: boolean;
  /** Why the disabled row cannot run (rendered in its hint slot). */
  disabledNote?: string;
}

export interface CommandPaletteProps<T extends PaletteCommand = PaletteCommand> {
  /** Called with the dismissed palette's close request (Escape / Tab / outside click). */
  onClose: () => void;
  /** Every command, in registry order (before matching). */
  commands: readonly T[];
  /**
   * The caller's matcher: raw input value → the rows to display, in ranked
   * order. Injected so the scoring vocabulary stays owned by the caller.
   */
  filter: (commands: readonly T[], query: string) => readonly T[];
  /** Run the chosen command (Enter on the highlighted row, or its click). */
  onRun: (command: T) => void;
  /** Extra classes on the dialog panel, merged last so callers win. */
  class?: string;
  /**
   * Render into this node — an injected UI's shadow-root container (the
   * dialog's mounted mode: non-modal toward the host page, Escape handled
   * on the panel).
   */
  mount?: HTMLElement;
  /** The dialog's accessible description (default: the panel's wording). */
  description?: string;
  /** Content under the list (e.g. a surface's shortcut hint); none by default. */
  footer?: JSX.Element;
  /**
   * The look (default `default`, today's — the on-page palette renders it,
   * restyled by its own stylesheet over the `data-fdt` hooks). `panel` — the
   * devtools panel's: a search field with its icon above a hairline, taller
   * rows, the highlight in the accent tint (the selected-row tint of lists).
   * Opt-in, so the on-page palette's markup never changes.
   */
  variant?: CommandPaletteVariant;
}

/** The palette's looks: the dialog's (one vocabulary for both primitives). */
export type CommandPaletteVariant = ModalDialogVariant;

/**
 * The field: full-width inside the dialog, at the shell's field height, with
 * the shared keyboard-focus ring (the list never receives real focus).
 */
const FIELD_CLASSES =
  'h-8 w-full shrink-0 rounded border border-line-strong bg-surface-2 px-2 text-xs text-fg-primary placeholder:text-fg-muted hover:border-fg-muted';

/** The list: bounded height, token-thin scroll, styled rows below. */
const LIST_CLASSES = 'max-h-72 overflow-y-auto rounded p-1';

/** One option row */
const ROW_CLASSES =
  'flex h-7 w-full cursor-pointer select-none items-center gap-2 rounded px-2 text-left text-xs text-fg-secondary no-underline' +
  ' data-highlighted:bg-surface-3 data-highlighted:text-fg-primary' +
  ' data-disabled:cursor-not-allowed data-disabled:text-fg-muted';

/** The no-match line: a real empty result, never a dead dropdown. */
const EMPTY_CLASSES = 'px-2 py-1.5 text-xs text-fg-muted';

/**
 * What a look styles, part by part — class strings only (the markup, ids,
 * roles and `data-fdt` hooks are the same in every look, except the field
 * frame a look opts into). The shared focus ring is merged onto the field
 * and the rows by the component, never repeated here.
 */
interface PaletteLook {
  /** Classes merged onto the dialog plate (padding; the caller's `class` still wins). */
  readonly plate: string;
  /** The combobox's column (field, list, live line): its flex column and spacing. */
  readonly root: string;
  /**
   * The wrapper the field sits in when the look leads it with the search
   * icon (positioning context, padding, divider); null = the bare field is
   * the column's first child.
   */
  readonly fieldFrame: string | null;
  /** The combobox field: height, frame, fill, inset (room for the icon when framed), type. */
  readonly field: string;
  /** The listbox: height cap, scrolling and padding (the component adds `flex-1 min-h-0`). */
  readonly list: string;
  /** An option row: height, spacing, type and its highlighted/disabled states. */
  readonly row: string;
  /** A row's leading icon: never shrinking, its resting (and highlighted) tone. */
  readonly rowIcon: string;
  /** A row's trailing hint (or disabled note): never shrinking, its size and tone. */
  readonly hint: string;
  /** The visible no-match line (the live line is `sr-only` while rows show). */
  readonly empty: string;
}

/**
 * Every look — adding one is one row here. `default` is the shipped look,
 * byte for byte (the on-page palette's markup depends on it).
 */
export const PALETTE_LOOKS: Readonly<Record<CommandPaletteVariant, PaletteLook>> = {
  default: {
    plate: 'pt-1.5',
    root: 'flex min-h-0 flex-1 flex-col gap-1',
    fieldFrame: null,
    field: FIELD_CLASSES,
    list: LIST_CLASSES,
    row: ROW_CLASSES,
    rowIcon: 'shrink-0 text-fg-muted',
    hint: 'shrink-0 text-2xs',
    empty: EMPTY_CLASSES
  },
  panel: {
    plate: '',
    root: 'flex min-h-0 flex-1 flex-col',
    fieldFrame: 'relative shrink-0 border-b border-line-1 p-2',
    field:
      'h-8 w-full rounded-control border border-line-strong bg-surface-1 ps-8 pe-2.5 text-xs text-fg-primary placeholder:text-fg-muted hover:border-fg-muted',
    list: 'max-h-72 overflow-y-auto p-1.5',
    row:
      'group flex h-8 w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2 text-left text-xs text-fg-secondary no-underline' +
      ' data-highlighted:bg-accent-soft data-highlighted:text-fg-primary' +
      ' data-disabled:cursor-not-allowed data-disabled:text-fg-muted',
    rowIcon: 'shrink-0 text-fg-muted group-data-highlighted:text-accent',
    hint: 'shrink-0 text-2xs text-fg-muted',
    empty: 'px-3 py-6 text-center text-xs text-fg-secondary'
  }
};

/**
 * The search icon's place inside the panel look's field frame: 8 px frame
 * padding + 10 px field inset, centered on the 32 px field.
 */
const FIELD_ICON_CLASSES =
  'pointer-events-none absolute start-4.5 top-1/2 -translate-y-1/2 text-fg-muted';

/**
 * The element ids. Static: one palette renders per document or shadow
 * root at a time (it is mount-driven), and audits key on these shapes.
 */
const FIELD_ID = 'fdt-command-palette-input';
const LIST_ID = 'fdt-command-palette-listbox';

/**
 * A row's element id (the field's active-descendant target).
 *
 * @param commandId The row's command id.
 */
function rowId(commandId: string): string {
  return `${LIST_ID}-item-${commandId}`;
}

/**
 * Render the command palette surface: the combobox field over its ranked
 * list, inside the shared modal dialog. Mount-driven — render inside a
 * `<Show>` while it should be open; the field takes focus on mount, in the
 * same task (another UI's frame callback never finds focus unclaimed and
 * takes it, which a mounted palette would read as an outside focus and
 * dismiss on).
 *
 * @param props.onClose The dismissal callback.
 * @param props.commands The ranked source rows, in registry order.
 * @param props.filter The caller's matcher (raw query → ordered rows).
 * @param props.onRun The chosen command's execution callback.
 * @param props.class Extra panel classes.
 * @param props.mount The injected UI's render node (the dialog's mounted mode).
 * @param props.description The accessible description override.
 * @param props.footer Content rendered under the list (optional).
 * @param props.variant The look (default `default`).
 */
export function CommandPalette<T extends PaletteCommand = PaletteCommand>(
  props: CommandPaletteProps<T>
): JSX.Element {
  /** The field, focused as the dialog mounts (no task gap another UI could take focus in). */
  let field: HTMLInputElement | undefined;
  // eslint-disable-next-line solid/reactivity -- a look is fixed per mount
  const variant = props.variant ?? 'default';
  const look = PALETTE_LOOKS[variant];
  return (
    <ModalDialog
      onClose={props.onClose}
      initialFocus={() => field}
      title="Command palette"
      description={props.description ?? 'Filter the pages and actions, run the highlighted one'}
      class={cn(look.plate, props.class)}
      mount={props.mount}
      variant={variant}
      onKeyDownCapture={(event) => {
        // Tab = dismiss: the field is the dialog's only stop (the list never
        // takes focus), so Tab would cycle back into the same field — ending
        // the palette is the single-stop combobox's natural Tab.
        if (event.key !== 'Tab') return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <PaletteCombobox
        look={look}
        commands={props.commands}
        filter={props.filter}
        onRun={props.onRun}
        fieldRef={(element) => {
          field = element;
        }}
      />
      {props.footer}
    </ModalDialog>
  );
}

/** Props of {@link PaletteCombobox}. */
interface PaletteComboboxProps<T extends PaletteCommand> {
  /** The look (fixed per mount). */
  look: PaletteLook;
  /** The commands, in registry order (before matching). */
  commands: readonly T[];
  /** The caller's matcher (raw query → ordered rows). */
  filter: (commands: readonly T[], query: string) => readonly T[];
  /** The chosen command's execution callback. */
  onRun: (command: T) => void;
  /** Receives the field element (the dialog focuses it on mount). */
  fieldRef: (element: HTMLInputElement) => void;
}

/**
 * The palette's combobox: query, ranked rows, highlight and live region in
 * one component (split from the dialog shell only).
 *
 * @param props See {@link PaletteComboboxProps}.
 */
function PaletteCombobox<T extends PaletteCommand>(props: PaletteComboboxProps<T>): JSX.Element {
  const speakActiveRow = isApplePlatform(globalThis.navigator);
  const [query, setQuery] = createSignal('');
  const ranked = createMemo(() => props.filter(props.commands, query()));
  const [activeId, setActiveId] = createSignal<string | null>(null);
  /** The live region's sentence (empty until the first change worth speaking). */
  const [announcement, setAnnouncement] = createSignal('');
  const empty = (): boolean => ranked().length === 0;
  const active = (): T | undefined => ranked().find((command) => command.id === activeId());
  let list: HTMLUListElement | undefined;

  /**
   * Update the live region after one change (unchanged text stays silent).
   *
   * @param cause What changed.
   */
  const announce = (cause: AnnouncementCause): void => {
    const next = paletteAnnouncement(cause, {
      query: query(),
      count: ranked().length,
      activeLabel: active()?.label ?? null,
      speakActiveRow
    });
    if (next !== null) setAnnouncement(next);
  };

  // Every re-rank re-places the highlight (a new query re-arms the top row);
  // only a query change is spoken — the open itself is named by the dialog.
  let lastQuery = ''; // the field starts empty on every mount
  createEffect(
    on(ranked, (rows) => {
      const queryChanged = query() !== lastQuery;
      lastQuery = query();
      setActiveId((current) => highlightAfterRank(rows, current, queryChanged));
      if (queryChanged) announce('query');
    })
  );

  // Keep the highlighted row in view by scrolling the list alone.
  createEffect(
    on(activeId, (id) => {
      if (id === null || list === undefined || list.hidden) return;
      const row = [...list.children].find((child) => child.id === rowId(id));
      if (row === undefined) return;
      list.scrollTop += scrollDeltaToReveal(
        row.getBoundingClientRect(),
        list.getBoundingClientRect()
      );
    })
  );

  /**
   * Run a row when it is enabled (disabled rows are inert).
   *
   * @param command The chosen row.
   */
  const run = (command: T | undefined): void => {
    if (command === undefined || command.disabled === true) return;
    props.onRun(command);
  };

  /**
   * The field's keys: highlight moves, Enter runs (Escape and Tab belong to
   * the dialog shell).
   *
   * @param event The field's keydown.
   */
  const onFieldKeyDown = (event: KeyboardEvent): void => {
    // An IME composition owns its keys (Enter commits the composition).
    if (event.isComposing) return;
    const move = fieldHighlightMove(event);
    if (move !== null) {
      event.preventDefault();
      setActiveId((current) => moveHighlight(ranked(), current, move));
      announce('move');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(active());
    }
  };

  /** The field's active-descendant (unset while no row is highlighted). */
  const activeDescendant = (): string | undefined => {
    const command = active();
    return command === undefined ? undefined : rowId(command.id);
  };

  const fieldElement = (
    <input
      ref={(element) => {
        props.fieldRef(element);
      }}
      id={FIELD_ID}
      data-fdt="palette-input"
      type="text"
      role="combobox"
      class={cn(props.look.field, FOCUS_RING)}
      placeholder="Type a command…"
      aria-label="Search commands"
      aria-haspopup="listbox"
      aria-autocomplete="list"
      aria-controls={LIST_ID}
      // Expanded only while the list has rows to show (it stays mounted,
      // hidden, while empty — `aria-controls` keeps naming it).
      aria-expanded={!empty()}
      aria-activedescendant={activeDescendant()}
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      onInput={(event) => setQuery(event.currentTarget.value)}
      onKeyDown={onFieldKeyDown}
    />
  );

  return (
    <div data-fdt="palette" class={props.look.root}>
      <Show when={props.look.fieldFrame} fallback={fieldElement}>
        {(frame) => (
          <div class={frame()}>
            <Search size={14} class={FIELD_ICON_CLASSES} aria-hidden="true" />
            {fieldElement}
          </div>
        )}
      </Show>
      <ul
        ref={(element) => {
          list = element;
        }}
        id={LIST_ID}
        role="listbox"
        aria-label="Commands"
        data-fdt="palette-list"
        class={cn(props.look.list, 'flex-1 min-h-0')}
        hidden={empty()}
        // Pressing a row must not move focus out of the field (the field is
        // the combobox; a blur would also read as an outside focus move).
        onMouseDown={(event) => {
          event.preventDefault();
        }}
      >
        <For each={ranked()}>
          {(command) => (
            <CommandRow
              look={props.look}
              command={command}
              highlighted={command.id === activeId()}
              onHover={() => {
                if (command.disabled !== true) setActiveId(command.id);
              }}
              onRun={() => {
                run(command);
              }}
            />
          )}
        </For>
      </ul>
      {/* Always mounted (a live region must exist before its text changes):
          the visible no-match line while nothing matches — derived from the
          current query, so it is never blank or stale (an empty command set,
          a re-rank without a query change) — visually hidden (counts, and the
          highlighted row on Apple platforms) otherwise. */}
      <p data-fdt="palette-empty" role="status" class={empty() ? props.look.empty : 'sr-only'}>
        {empty() ? noMatchText(query()) : announcement()}
      </p>
    </div>
  );
}

/** Props of {@link CommandRow}. */
interface CommandRowProps {
  /** The look (fixed per mount). */
  look: PaletteLook;
  /** The ranked row. */
  command: PaletteCommand;
  /** Whether the highlight rests on this row. */
  highlighted: boolean;
  /** A mouse moved over the row. */
  onHover: () => void;
  /** The row was clicked. */
  onRun: () => void;
}

/**
 * Render one option row: icon, label, hint — the disabled row's hint slot
 * carries its explanation instead. The highlighted row is the selected
 * option (the APG list-autocomplete combobox marks its active descendant
 * `aria-selected`).
 *
 * @param props See {@link CommandRowProps}.
 */
function CommandRow(props: CommandRowProps): JSX.Element {
  const disabled = (): boolean => props.command.disabled === true;
  return (
    <li
      id={rowId(props.command.id)}
      role="option"
      class={cn(props.look.row, FOCUS_RING)}
      data-fdt="palette-command"
      aria-selected={props.highlighted}
      aria-disabled={disabled()}
      data-highlighted={props.highlighted ? '' : undefined}
      data-disabled={disabled() ? '' : undefined}
      onPointerMove={(event) => {
        if (event.pointerType === 'mouse' && !props.highlighted) props.onHover();
      }}
      onClick={() => {
        props.onRun();
      }}
    >
      <Show when={props.command.icon}>
        {(icon) => (
          <Dynamic component={icon()} size={14} class={props.look.rowIcon} aria-hidden="true" />
        )}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.command.label}</span>
      <span data-fdt="palette-command-hint" class={props.look.hint}>
        {disabled() ? props.command.disabledNote : props.command.hint}
      </span>
    </li>
  );
}
