/**
 * The on-page command vocabulary — the single declaring site of every
 * action this extension offers on an inspected page: its id, user-facing
 * label and where it is offered (the on-page command palette, the
 * browser's context menu, or both).
 *
 * Consumers map over this table and never re-type a label: the context
 * menu titles its rows from it, the on-page palette lists its palette rows
 * from it and titles its failure notices with the labels. The on-page
 * surfaces' names and the on-page UI gate's wording (its options row, both
 * ways back on) are declared here too, so page copy, menu titles and the
 * options page never drift apart. The palette's
 * view-only row details (matcher keywords, availability, confirm copy) live
 * in `./palette-rows`, so the always-loaded content script carries only
 * this table. Adding a command = one row here (+ its executor and palette
 * details when the palette runs it) and its tests.
 *
 * Binding notes:
 * - menu-native details (menu ids, contexts, document URL patterns, click
 *   routing) stay with the menu module; this table only says *that* a row
 *   is a menu row;
 * - `menu`-only rows (`open-command-palette`, `open-nowprocket`) are
 *   triggers that make no sense from inside the palette (the palette is
 *   already open; the cache-bypassed tab is a browser-chrome action);
 * - `page-ui-gate` is the master switch: the palette offers only the
 *   off direction (the palette dies with the gate), the menu carries both
 *   titles (it is the rescue path back on).
 */

/** One vocabulary row. */
export interface PageCommandRow {
  /** Stable kebab-case id (the palette's dispatch key; ids are unique — test-pinned). */
  readonly id: string;
  /** User-facing label — the menu title and the palette row text alike. */
  readonly label: string;
  /** Offered by the on-page command palette. */
  readonly palette: boolean;
  /** Offered by the browser's context menu. */
  readonly menu: boolean;
}

/**
 * The on-page surfaces' names as copy writes them mid-sentence (sentence
 * starts capitalize them).
 */
export const PAGE_SURFACE_NAMES = {
  detectionWidget: 'detection widget',
  knownConflictsCard: 'Known Conflicts card',
  sideBySide: 'Side By Side',
  exclusionBuilder: 'Exclusion Builder',
  commandPalette: 'command palette'
} as const;

/** Every surface the on-page UI gate switches, as one mid-sentence list. */
export const PAGE_UI_SURFACES_PROSE = `the ${PAGE_SURFACE_NAMES.detectionWidget}, the ${PAGE_SURFACE_NAMES.knownConflictsCard}, ${PAGE_SURFACE_NAMES.sideBySide}, the ${PAGE_SURFACE_NAMES.exclusionBuilder} and the ${PAGE_SURFACE_NAMES.commandPalette}`;

/** The gate row's label when on-page UI is off (the menu's rescue title). */
export const PAGE_UI_GATE_RESCUE_LABEL = 'Turn on all on-page UI';

/** The options page's gate switch label (page copy quotes it as the second way back). */
export const PAGE_UI_GATE_OPTION_LABEL = 'Show on-page UI';

/** The menu way back on, as copy names it mid-sentence. */
export const PAGE_UI_MENU_RESCUE = `the page’s right-click menu (“${PAGE_UI_GATE_RESCUE_LABEL}”)`;

/** The options way back on, as page copy names it mid-sentence. */
export const PAGE_UI_OPTIONS_RESCUE = `the extension’s options (“${PAGE_UI_GATE_OPTION_LABEL}”)`;

/**
 * The vocabulary, in display order. `as const satisfies` keeps each row's
 * literal `id` and `palette` flag, so {@link PageCommandId} and
 * {@link PaletteCommandId} derive from the table itself.
 */
export const PAGE_COMMANDS = [
  {
    id: 'side-by-side',
    label: `Open ${PAGE_SURFACE_NAMES.sideBySide}`,
    palette: true,
    menu: true
  },
  {
    id: 'psi-side-by-side',
    label: `Open ${PAGE_SURFACE_NAMES.sideBySide} Performance`,
    palette: true,
    menu: true
  },
  {
    id: 'toggle-detection-widget',
    label: `Toggle the ${PAGE_SURFACE_NAMES.detectionWidget} on this site`,
    palette: true,
    menu: true
  },
  {
    id: 'exclusion-builder',
    label: PAGE_SURFACE_NAMES.exclusionBuilder,
    palette: true,
    // The menu offers it from the toolbar button's own menu only.
    menu: true
  },
  {
    id: 'page-ui-gate',
    label: 'Turn off all on-page UI',
    palette: true,
    menu: true
  },
  {
    id: 'open-command-palette',
    label: `Open ${PAGE_SURFACE_NAMES.commandPalette}`,
    palette: false,
    menu: true
  },
  {
    id: 'open-nowprocket',
    label: 'Open ?nowprocket',
    palette: false,
    menu: true
  }
] as const satisfies readonly PageCommandRow[];

/** One on-page command id (derived from the table: one declaring site). */
export type PageCommandId = (typeof PAGE_COMMANDS)[number]['id'];

/** The ids the on-page palette runs (rows with `palette: true`). */
export type PaletteCommandId = Extract<(typeof PAGE_COMMANDS)[number], { palette: true }>['id'];

/**
 * One command's row.
 *
 * @param id The command.
 * @returns Its row (every id has exactly one — test-pinned).
 * @throws {@link Error} for an id outside the table (a broken invariant).
 */
export function pageCommand(id: PageCommandId): PageCommandRow {
  const row = (PAGE_COMMANDS as readonly PageCommandRow[]).find((entry) => entry.id === id);
  if (row === undefined) throw new Error(`Unknown on-page command: ${id}`);
  return row;
}

/**
 * One command's user-facing label (the menu titles its rows through this).
 *
 * @param id The command.
 */
export function pageCommandLabel(id: PageCommandId): string {
  return pageCommand(id).label;
}

/** The palette's rows, in display order. */
export function paletteCommands(): readonly PageCommandRow[] {
  return (PAGE_COMMANDS as readonly PageCommandRow[]).filter((row) => row.palette);
}

/**
 * Whether an untrusted id names a palette command.
 *
 * @param input Any value (an id coming back from the palette view).
 */
export function isPaletteCommandId(input: unknown): input is PaletteCommandId {
  return paletteCommands().some((row) => row.id === input);
}
