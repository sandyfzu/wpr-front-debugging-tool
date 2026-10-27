/**
 * The command palette's combobox — the APG combobox the study's keyboard
 * contract commits to, shaped for command execution rather than form values.
 *
 * Why wrapping Kobalte's `Combobox` and not a bespoke field+list: the library
 * already implements the exact APG surface this needs — `role="combobox"`
 * input with `aria-expanded`/`aria-controls`/`aria-activedescendant` (caret
 * focus stays in the field), arrow/Home/End navigation with optional wrap,
 * Enter accepting the highlighted option, Escape closing — all per its own
 * test suite. The value-oriented selection is defused for actions: every
 * selection (Enter or click) resolves to one command run, non-command clear
 * events report `null` and are dropped, and the palette unmounts on run, so
 * the text-echo of a selection is never seen.
 *
 * Montage notes (why the pieces look as they do):
 * - Mount-driven like the dialog it sits in: the caller renders it only while
 *   open; the combobox boots open (`defaultOpen`) and the whole surface is
 *   gone at close.
 * - The list is NOT rendered through `Combobox.Content` — that piece exists
 *   to popper-position a popup above the page, which a dialog-inside layout
 *   fights. Rendering the bare `Listbox` (same state wiring, minus the
 *   positioning layer) keeps the input+list as one flow inside the dialog,
 *   where the dialog itself supplies focus trapping and dismissals.
 * - Matching/ranking is injected ({@link CommandPaletteProps.filter}); the
 *   wrapper only feeds the ordered result to the collection (its own filter
 *   is therefore a pass-through).
 * - Enter works without a preceding arrow key because the highlight starts
 *   on the top-ranked row and re-arms on every query change (Kobalte clears
 *   the focus key when the input value changes — the highlight guard child
 *   restores it against the fresh list).
 */
import type { JSX } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, on } from 'solid-js';
import { Combobox as KobalteCombobox } from '@kobalte/core/combobox';
import { useComboboxContext } from '@kobalte/core/combobox';
import type { CollectionNode } from '@kobalte/core';
import type { LucideIcon } from 'lucide-solid';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../utils/cn';
import { FOCUS_RING } from './classes';
import { ModalDialog } from './dialog';

/** One runnable entry of the palette: a page or an action. */
export interface PaletteCommand {
  /** Stable identity — the combobox item key and the consumer's dispatch key. */
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
  /** Called with the dismissed palette's close request (Escape / outside click). */
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
}

/**
 * The field: full-width inside the dialog, at the shell's field height, with
 * the shared keyboard-focus ring (the list never receives real focus).
 */
const FIELD_CLASSES =
  'h-8 w-full shrink-0 rounded border border-line-3 bg-surface-2 px-2 text-xs text-fg-primary placeholder:text-fg-muted hover:border-line-2';

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
 * Render one option row out of a ranked command: icon, label, hint — the
 * disabled row's hint slot carries its explanation instead.
 *
 * @param props.item The collection node (its `rawValue` is the command).
 */
function CommandRow(props: { item: CollectionNode<PaletteCommand> }): JSX.Element {
  const command = (): PaletteCommand => props.item.rawValue;
  return (
    <KobalteCombobox.Item
      item={props.item}
      class={cn(ROW_CLASSES, FOCUS_RING)}
      data-fdt="palette-command"
    >
      <Show when={command().icon}>
        <Dynamic
          component={command().icon}
          size={14}
          class="shrink-0 text-fg-muted"
          aria-hidden="true"
        />
      </Show>
      <span class="min-w-0 flex-1 truncate">{command().label}</span>
      <span data-fdt="palette-command-hint" class="shrink-0 text-2xs">
        {command().disabled ? command().disabledNote : command().hint}
      </span>
    </KobalteCombobox.Item>
  );
}

/**
 * Keep the combobox highlight on the top-ranked row whenever it is unset —
 * at open, after every query change (the library clears the focus key while
 * the input value changes), and after caret moves (its input keydown clears
 * it for left/right, too). This is what makes Enter run something without a
 * preceding arrow key, and what walks the highlight down as the user filters.
 *
 * @param props.options The current ranked list (each change re-arms the guard).
 * @param props.registerArm Receives the arm action so the input's keydown
 *   can arm the highlight after the library's own key handling (caret moves
 *   clear it without changing the ranked list).
 */
function HighlightGuard(props: {
  options: readonly PaletteCommand[];
  registerArm?: (armTopEnabled: () => void) => void;
}): JSX.Element {
  const context = useComboboxContext();
  let disposed = false;
  /** The one coalesced re-arm tick (declared first: cleanup references it). */
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    disposed = true;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
  });

  /**
   * Arm the highlight onto the first enabled row (never merely the first row:
   * a future registry order putting a disabled row on top must not arm a
   * dead key), only when the highlight is unset — an armed guard never
   * clobbers a user-moved position.
   */
  const armTopEnabled = (): void => {
    if (disposed) return;
    const listState = context.listState();
    if (listState.selectionManager().focusedKey() != null) return;
    for (const key of listState.collection().getKeys()) {
      const item = listState.collection().getItem(key);
      if (item !== undefined && !item.disabled) {
        listState.selectionManager().setFocusedKey(key);
        break;
      }
    }
  };
  // The registration is a once-per-mount wiring read (the component body
  // runs once; the callback is fixed at build time), so the rule's concern
  // does not apply.
  // eslint-disable-next-line solid/reactivity
  props.registerArm?.(armTopEnabled);

  // One coalesced tick: every arm trigger schedules the same re-arm, so the
  // field's writes have settled first and no burst double-arms.
  const schedule = (): void => {
    if (disposed) return;
    if (pendingTimer !== null) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      armTopEnabled();
    }, 0);
  };
  // Ranked-list changes (every query write clears the key)…
  createEffect(
    on(
      () => props.options,
      () => {
        schedule();
      }
    )
  );
  // …and the collection's own availability: the library builds its option
  // nodes asynchronously, so the mount's first tick can land before the
  // rows exist — the collection's first real build is the arm's authority.
  createEffect(() => {
    void context.listState().collection();
    schedule();
  });
  return <></>;
}

/**
 * Render the command palette surface: the combobox field over its ranked
 * list, inside the shared modal dialog. Mount-driven — render inside a
 * `<Show>` while it should be open; the input takes focus on mount, arrows
 * move the highlight (with wrap), Home/End jump to the ends, Enter runs the
 * highlighted command, Escape and an outside click dismiss.
 *
 * @param props.onClose The dismissal callback.
 * @param props.commands The ranked source rows, in registry order.
 * @param props.filter The caller's matcher (raw query → ordered rows).
 * @param props.onRun The chosen command's execution callback.
 * @param props.class Extra panel classes.
 * @param props.mount The injected UI's render node (the dialog's mounted mode).
 * @param props.description The accessible description override.
 */
export function CommandPalette<T extends PaletteCommand = PaletteCommand>(
  props: CommandPaletteProps<T>
): JSX.Element {
  return (
    <ModalDialog
      onClose={props.onClose}
      title="Command palette"
      description={props.description ?? 'Filter the pages and actions, run the highlighted one'}
      class={cn('pt-1.5', props.class)}
      mount={props.mount}
      onKeyDownCapture={(event) => {
        // Tab = dismiss: the combobox's own Tab completion (close + reset
        // input) cannot finish inside this modal — its focus trap returns to
        // this field, so the library's close leaves a wiped query and a
        // rendered list under a closed `aria-expanded`. Dismissing the whole
        // palette is the same decision in one step (and the cursor's focus
        // returns to the trigger).
        if (event.key !== 'Tab') return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
    >
      <PaletteCombobox
        commands={props.commands}
        filter={props.filter}
        onRun={props.onRun}
        onDismiss={props.onClose}
      />
    </ModalDialog>
  );
}

export interface PaletteComboboxProps<T extends PaletteCommand = PaletteCommand> {
  /** The commands, in registry order (before matching). */
  commands: readonly T[];
  /** The caller's matcher (raw query → ordered rows). */
  filter: (commands: readonly T[], query: string) => readonly T[];
  /** The chosen command's execution callback. */
  onRun: (command: T) => void;
  /**
   * The dismissal callback — the input's Tab intercepts here: the library's
   * own Tab semantics (close + reset input) cannot complete inside a modal
   * whose field is the only focus stop (its close leaves the dialog open and
   * wipes the query), so Tab dismisses the palette, exactly how the key
   * would end a single-focusable combobox activation.
   */
  onDismiss: () => void;
}

/**
 * The library's announcement vocabulary, retitled for the palette ("Commands"
 * — the default names the list "Suggestions"). The count announcement keeps
 * the library's own literal contract, replicated structurally: inform only a
 * single-result open, stay silent on larger counts (each row carries its own
 * accessible text).
 */
interface PaletteTranslations {
  /** The list's accessible name. */
  listboxLabel: string;
  /** The trigger's label (no trigger renders in the palette). */
  triggerLabel: string;
  /** Announced when the highlight moves on Apple screen readers. */
  focusAnnouncement(optionText: string, isSelected: boolean): string;
  /** Announced when an option is selected on Apple screen readers. */
  selectedAnnouncement(optionText: string): string;
  /** Announced on open/option-count change — single-result Opens only. */
  countAnnouncement(optionCount: number): 'one option available' | undefined;
}

/** The palette's translation table (the label stay the one retitled pair). */
const PALETTE_TRANSLATIONS: PaletteTranslations = {
  listboxLabel: 'Commands',
  triggerLabel: 'Search commands',
  focusAnnouncement: (text, isSelected) => `${text}${isSelected ? ', selected' : ''}`,
  selectedAnnouncement: (text) => `${text}, selected`,
  countAnnouncement: (count) => (count === 1 ? 'one option available' : undefined)
};

/**
 * The palette's combobox (split from the dialog shell so the query state and
 * the highlight guard stay one component deep).
 *
 * @param props.commands Registry-ordered commands.
 * @param props.filter The caller's matcher.
 * @param props.onRun The execution callback.
 */
function PaletteCombobox<T extends PaletteCommand = PaletteCommand>(
  props: PaletteComboboxProps<T>
): JSX.Element {
  const [query, setQuery] = createSignal('');
  const ranked = createMemo(() => props.filter(props.commands, query()));
  const rankedOptions = createMemo(() => [...ranked()]);

  /** The guard's arm action, registered by the child on mount. */
  let arm: (() => void) | null = null;
  /** The coalesced post-library tick (caret moves clear the highlight key
      without changing the ranked list, so the guard's own effect never
      fires for them; this tick arms once the key handling has settled). */
  let pendingArm: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (pendingArm !== null) clearTimeout(pendingArm);
  });
  const scheduleArm = (): void => {
    if (pendingArm !== null) clearTimeout(pendingArm);
    pendingArm = setTimeout(() => {
      pendingArm = null;
      arm?.();
    }, 0);
  };

  return (
    <KobalteCombobox
      id="fdt-command-palette"
      class="flex min-h-0 flex-1 flex-col gap-1"
      defaultOpen
      options={rankedOptions()}
      optionValue={(command) => command.id}
      optionTextValue={(command) => command.label}
      optionLabel={(command) => command.label}
      optionDisabled={(command) => command.disabled ?? false}
      // Ranking/filtering is the caller's: everything ranked renders.
      defaultFilter={() => true}
      itemComponent={CommandRow}
      shouldFocusWrap
      allowsEmptyCollection
      onInputChange={(next) => setQuery(next)}
      onChange={(command: T | null) => {
        if (command !== null) props.onRun(command);
      }}
      translations={PALETTE_TRANSLATIONS}
    >
      <KobalteCombobox.Input
        data-fdt="palette-input"
        class={cn(FIELD_CLASSES, FOCUS_RING)}
        placeholder="Type a command…"
        aria-label="Search commands"
        onKeyDown={() => {
          scheduleArm();
        }}
      />
      {/* The listbox stays mounted (hidden while empty): the expanded field's
          `aria-controls` must always name it — unmounting it would drop the
          attribute the APG combobox requires. */}
      <KobalteCombobox.Listbox
        data-fdt="palette-list"
        class={cn(LIST_CLASSES, 'flex-1 min-h-0')}
        hidden={ranked().length === 0}
      />
      <Show when={ranked().length === 0}>
        <p data-fdt="palette-empty" class={EMPTY_CLASSES}>
          No commands match “{query()}”
        </p>
      </Show>
      <HighlightGuard
        options={ranked()}
        registerArm={(registered) => {
          arm = registered;
        }}
      />
    </KobalteCombobox>
  );
}
