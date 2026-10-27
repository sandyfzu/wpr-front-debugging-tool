/**
 * The on-page command vocabulary — the single declaring site of every
 * action this extension offers on an inspected page: its id, user-facing
 * label, matcher keywords, where it is offered (the on-page command
 * palette, the browser's context menu, or both) and when it cannot run.
 *
 * Consumers map over this table and never re-type a label: the context
 * menu titles its rows from it, the on-page palette lists its palette rows,
 * the options page names the gate from it. Adding a command = one row here
 * (+ its executor when the palette runs it, see `./executors`) and its tests.
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

/** The page facts a command's availability reads (gathered by the surface). */
export interface PageCommandFacts {
  /** The page is the PageSpeed Insights analysis host itself. */
  readonly analysisHost: boolean;
}

/** The confirmation a command asks for before it runs from the palette. */
export interface PageCommandConfirm {
  /** The confirm's title line. */
  readonly title: string;
  /** One sentence naming the consequence and the way back. */
  readonly body: string;
  /** The confirming button's label. */
  readonly action: string;
}

/** One vocabulary row. */
export interface PageCommandRow {
  /** Stable kebab-case id (the palette's dispatch key; ids are unique — test-pinned). */
  readonly id: string;
  /** User-facing label — the menu title and the palette row text alike. */
  readonly label: string;
  /** Extra lowercase words the palette matcher scores (never rendered). */
  readonly keywords: readonly string[];
  /** Offered by the on-page command palette. */
  readonly palette: boolean;
  /** Offered by the browser's context menu. */
  readonly menu: boolean;
  /**
   * Why the command cannot run on this page, or null when it can. Absent =
   * always runnable.
   */
  readonly disabledNote?: (facts: PageCommandFacts) => string | null;
  /** Asked before the palette runs the command (absent: runs at once). */
  readonly confirm?: PageCommandConfirm;
}

/** The gate row's label when on-page UI is off (the menu's rescue title). */
export const PAGE_UI_GATE_RESCUE_LABEL = 'Turn on all on-page UI';

/**
 * The vocabulary, in display order. `as const satisfies` keeps each row's
 * literal `id` and `palette` flag, so {@link PageCommandId} and
 * {@link PaletteCommandId} derive from the table itself.
 */
export const PAGE_COMMANDS = [
  {
    id: 'side-by-side',
    label: 'Open Side By Side',
    keywords: ['compare', 'cache', 'bypass', 'nowprocket', 'split', 'sbs'],
    palette: true,
    menu: true
  },
  {
    id: 'psi-side-by-side',
    label: 'Open Side By Side Performance',
    keywords: ['pagespeed', 'insights', 'psi', 'lighthouse', 'performance', 'compare'],
    palette: true,
    menu: true,
    // On the analysis host the entry does nothing: an analysis starts from
    // a site, never from PageSpeed Insights itself.
    disabledNote: (facts) =>
      facts.analysisHost ? 'Starts from a site, not from PageSpeed Insights' : null
  },
  {
    id: 'toggle-detection-widget',
    label: 'Toggle the detection widget on this site',
    keywords: ['chip', 'strip', 'inspector', 'widget', 'detections', 'show', 'hide'],
    palette: true,
    menu: true
  },
  {
    id: 'exclusion-builder',
    label: 'Exclusion Builder',
    keywords: ['open', 'exclusions', 'exclude', 'delay', 'defer', 'rucss', 'test'],
    palette: true,
    // The menu offers it from the toolbar button's own menu only.
    menu: true
  },
  {
    id: 'page-ui-gate',
    label: 'Turn off all on-page UI',
    keywords: ['disable', 'hide', 'gate', 'master', 'off', 'everything'],
    palette: true,
    menu: true,
    confirm: {
      title: 'Turn off all on-page UI?',
      body: 'This also turns off this command palette — the context menu turns on-page UI back on.',
      action: 'Turn off'
    }
  },
  {
    id: 'open-command-palette',
    label: 'Open command palette',
    keywords: ['commands', 'palette'],
    palette: false,
    menu: true
  },
  {
    id: 'open-nowprocket',
    label: 'Open ?nowprocket',
    keywords: ['nowprocket', 'bypass', 'cache'],
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

/**
 * A row's disabled note for this page.
 *
 * @param row The row.
 * @param facts The page facts.
 * @returns The note, or null when the command can run.
 */
export function commandDisabledNote(row: PageCommandRow, facts: PageCommandFacts): string | null {
  return row.disabledNote?.(facts) ?? null;
}
