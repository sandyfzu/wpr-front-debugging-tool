/**
 * The options page's option registry: one immutable table describing every
 * option the page offers — its storage id, the section card it renders in,
 * and its user-facing copy — projected over the storage contracts in
 * `../storage/options` (which own the shape, the keys and the defaults).
 * This table owns presentation and display order only; it is data, never
 * mutable state, and never a second source of truth for defaults.
 *
 * Adding an option is one row here (plus its storage slot when the shape
 * grows), never consumer branching: the page maps over these rows.
 *
 * Two row families: **drafted** rows (boolean switches, the appearance
 * choice) live in the `sync:options` shape and ride the page model's
 * draft/Save cycle; **instant** rows (the on-page UI gate, the palette
 * shortcut, the What's new switch) own their storage items and apply the moment they change — they
 * never enter the draft, so a pending edit elsewhere on the page survives
 * them untouched. Any row may carry the `onPage` marker: it belongs to UI
 * injected into inspected pages, so it disables while the gate is off
 * ({@link onPageDisabledNote}).
 */

import { capitalize } from '../../utils/text';
import { isAppearance, type Appearance } from '../../utils/theme';
import { DBUGGER_ENTRY_LABEL } from './dbugger-entry';
import {
  PAGE_SURFACE_NAMES,
  PAGE_UI_GATE_OPTION_LABEL,
  pageCommandLabel,
  PAGE_UI_MENU_RESCUE,
  PAGE_UI_SURFACES_PROSE
} from '../page-commands/commands';
import {
  DETECTION_WIDGET,
  storedOptionsOrFallback,
  TOOLBAR_BADGE,
  WP_DASHBOARD_DBUGGER_ENTRY,
  type StoredOptions
} from '../storage/options';
import { WHATS_NEW_NAME, WHATS_NEW_ON_UPDATE_LABEL } from '../release-notes/words';

/** The section cards the options page renders, identified for row grouping. */
export type OptionSectionId = 'improvements' | 'appearance' | 'features';

/** One section card's static copy (rendered as its header). */
export interface OptionSection {
  /** Stable card identity (and the rows' grouping key). */
  readonly id: OptionSectionId;
  /** The card's title. */
  readonly title: string;
  /** The card's one-line description. */
  readonly description: string;
}

/** The fields every row kind shares. */
interface OptionRowBase {
  /** Stable row identity — the storage key for drafted rows; unique across the registry. */
  readonly id: string;
  /** The card the row renders in. */
  readonly section: OptionSectionId;
  /** The control's label. */
  readonly label: string;
  /** The control's description. */
  readonly description: string;
  /**
   * The cascade marker: the row configures UI this tool injects into
   * inspected pages, so the page disables it while the on-page UI gate is
   * off. Absent = unaffected by the gate.
   */
  readonly onPage?: true;
}

/** A boolean option stored as `options[section][id]`. */
export interface BooleanOptionRow extends OptionRowBase {
  /** Row discriminator: a two-state switch. */
  readonly kind: 'boolean';
  /** The storage key inside the section's group — stable across releases. */
  readonly id: string;
  /** The group the key lives in (the storage shape's boolean maps). */
  readonly section: Exclude<OptionSectionId, 'appearance'>;
}

/**
 * The appearance choice, stored as the shape's top-level `appearance` slot —
 * a three-way choice (`system`/`dark`/`light`), not a boolean switch, so it
 * is its own row kind rendered as a tri-state control.
 */
export interface AppearanceOptionRow extends OptionRowBase {
  /** Row discriminator: the three-way appearance choice. */
  readonly kind: 'appearance';
  /** The storage slot the choice lives in. */
  readonly id: 'appearance';
  /** The card the control renders in. */
  readonly section: 'appearance';
}

/**
 * The on-page UI master gate (`sync:page-ui-gate`): an instant switch — the
 * master the `onPage` rows cascade from, so never marked itself.
 */
export interface PageUiGateOptionRow extends OptionRowBase {
  /** Row discriminator: the instant master switch. */
  readonly kind: 'page-ui-gate';
  /** Row identity (the item owns its own key). */
  readonly id: 'page-ui-gate';
  /** The card the switch renders in. */
  readonly section: 'features';
}

/** The on-page command palette's shortcut (`sync:palette-chord`): an instant capture field. */
export interface ChordOptionRow extends OptionRowBase {
  /** Row discriminator: the press-a-combination field. */
  readonly kind: 'chord';
  /** Row identity (the item owns its own key). */
  readonly id: 'palette-chord';
  /** The card the field renders in. */
  readonly section: 'features';
}

/**
 * "Show what's new after updates" (`sync:whats-new-on-update`): an instant
 * switch, shared with the What's new page's footer — plus the link that
 * reopens that page.
 */
export interface WhatsNewOptionRow extends OptionRowBase {
  /** Row discriminator: the instant switch + the page link. */
  readonly kind: 'whats-new';
  /** Row identity (the item owns its own key). */
  readonly id: 'whats-new-on-update';
  /** The card the switch renders in. */
  readonly section: 'features';
}

/** The rows the page model drafts (stored in the `sync:options` shape). */
export type DraftedOptionRow = BooleanOptionRow | AppearanceOptionRow;

/** The rows that own their storage item and apply instantly. */
export type InstantOptionRow = PageUiGateOptionRow | ChordOptionRow | WhatsNewOptionRow;

/** Any registry row — the union the page's controls render from. */
export type OptionRow = DraftedOptionRow | InstantOptionRow;

/**
 * Freeze a table and each of its rows — the registry is immutable data, never
 * mutable state, so no consumer can drift its copy or its copy's members.
 *
 * @param rows The table's rows, in display order.
 */
function freezeRows<T extends object>(rows: readonly T[]): readonly T[] {
  return Object.freeze(rows.map((row) => Object.freeze(row)));
}

/** The section cards, in display order. */
export const OPTION_SECTIONS: readonly OptionSection[] = freezeRows<OptionSection>([
  {
    id: 'improvements',
    title: 'Improvements',
    description: 'Small additions to the WordPress admin that speed up everyday support work.'
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'How the tool looks — follow your system or pin one palette for every surface.'
  },
  {
    id: 'features',
    title: 'Features',
    description: 'Tool-wide behaviors you can switch on or off.'
  }
]);

/** The option rows, in display order within their sections. */
export const OPTION_ROWS: readonly OptionRow[] = freezeRows<OptionRow>([
  {
    kind: 'boolean',
    id: WP_DASHBOARD_DBUGGER_ENTRY,
    section: 'improvements',
    label: "Add a D-bugger link to WP Rocket's admin bar menu",
    description: `Adds a “${DBUGGER_ENTRY_LABEL}” entry to WP Rocket's admin bar menu for one-click access to the D-bugger tool.`
  },
  {
    kind: 'appearance',
    id: 'appearance',
    section: 'appearance',
    label: 'Color theme',
    description:
      "Follows your system's dark or light preference, or pins one palette — every open surface updates immediately."
  },
  {
    kind: 'page-ui-gate',
    id: 'page-ui-gate',
    section: 'features',
    label: PAGE_UI_GATE_OPTION_LABEL,
    description: `${capitalize(PAGE_UI_SURFACES_PROSE)} on inspected pages — off closes them on every open page at once; turn them back on here or from ${PAGE_UI_MENU_RESCUE}.`
  },
  {
    kind: 'chord',
    id: 'palette-chord',
    section: 'features',
    onPage: true,
    label: `${capitalize(PAGE_SURFACE_NAMES.commandPalette)} shortcut`,
    description: `Opens the ${PAGE_SURFACE_NAMES.commandPalette} on inspected pages. Select the field, then press the new combination — it applies immediately. Browser-owned shortcuts (Ctrl/⌘ + W, T, N, Q…) can't be recorded: the browser acts on them before the page sees them.`
  },
  {
    kind: 'boolean',
    id: DETECTION_WIDGET,
    section: 'features',
    onPage: true,
    label: `Show the ${PAGE_SURFACE_NAMES.detectionWidget} on pages by default`,
    description: `Shows the WP Rocket ${PAGE_SURFACE_NAMES.detectionWidget} on every inspected page. A site you switched with “${pageCommandLabel('toggle-detection-widget')}” (right-click menu or ${PAGE_SURFACE_NAMES.commandPalette}) keeps its own choice — applies to open pages as soon as it is saved.`
  },
  {
    kind: 'boolean',
    id: TOOLBAR_BADGE,
    section: 'features',
    label: 'Show the toolbar badge',
    description:
      "Shows a colored dot on the toolbar icon for the page's WP Rocket state, named in the icon's tooltip — applies as soon as it is saved."
  },
  {
    kind: 'whats-new',
    id: 'whats-new-on-update',
    section: 'features',
    label: WHATS_NEW_ON_UPDATE_LABEL,
    description: `Opens the ${WHATS_NEW_NAME} page once after an update that brings something new — applies immediately.`
  }
]);

/** The documented defaults' boolean groups, read through the storage contract (no retyped literals). */
const DOCUMENTED_DEFAULTS = storedOptionsOrFallback(undefined);
const DEFAULT_IMPROVEMENTS: StoredOptions['improvements'] = DOCUMENTED_DEFAULTS.improvements;
const DEFAULT_FEATURES: StoredOptions['features'] = DOCUMENTED_DEFAULTS.features;

/**
 * Read a row's current value from validated options.
 *
 * @param row The registry row to read.
 * @param options Validated options (as `getOptions` returns them — known
 *   keys are always boolean there, so the fallback leg is belt only).
 * @returns The row's value; the storage contract's documented default when
 *   the slot is somehow absent.
 */
export function readOption(row: DraftedOptionRow, options: StoredOptions): boolean | Appearance {
  if (row.kind === 'appearance') return options.appearance;
  // Reads go through the group's own alias, indexed by the row's storage key.
  if (row.section === 'improvements') {
    const group: StoredOptions['improvements'] = options.improvements;
    return group[row.id] ?? DEFAULT_IMPROVEMENTS[row.id] ?? false;
  }
  const group: StoredOptions['features'] = options.features;
  return group[row.id] ?? DEFAULT_FEATURES[row.id] ?? false;
}

/**
 * The registry's rows for one section, in display order — the page renders
 * a card per section with exactly these rows inside.
 *
 * @param sectionId The section card to collect rows for.
 */
export function optionRowsIn(sectionId: OptionSectionId): readonly OptionRow[] {
  return OPTION_ROWS.filter((row) => row.section === sectionId);
}

/**
 * Whether a draft value is a legal choice for a row — the machine's input
 * guard: boolean rows demand a boolean, the appearance row a legal choice.
 *
 * @param row The row the value targets.
 * @param value The value offered for it.
 */
export function isValidOptionValue(row: DraftedOptionRow, value: boolean | Appearance): boolean {
  if (row.kind === 'appearance') return isAppearance(value);
  return typeof value === 'boolean';
}

/**
 * Whether a row rides the page model's draft (stored in `sync:options`).
 *
 * @param row Any registry row.
 */
export function isDraftedOptionRow(row: OptionRow): row is DraftedOptionRow {
  return row.kind === 'boolean' || row.kind === 'appearance';
}

/** The drafted rows, in display order — the page model's whole row set. */
export const DRAFTED_OPTION_ROWS: readonly DraftedOptionRow[] = Object.freeze(
  OPTION_ROWS.filter(isDraftedOptionRow)
);

/** Shown under every `onPage` row while the gate is off — names the way back. */
export const ON_PAGE_UI_OFF_NOTE = `On-page UI is off — turn on “${PAGE_UI_GATE_OPTION_LABEL}” to change this`;

/**
 * The cascade: why a row is disabled by the on-page UI gate, if it is.
 * Data-driven — any row carrying `onPage` inherits it, whatever its kind.
 *
 * @param row Any registry row.
 * @param pageUiEnabled The watched gate; `null` while it is unknown (still
 *   loading or unreadable) — an unknown gate disables nothing, so a slow
 *   read never flashes rows disabled.
 * @returns The note to render under the disabled row, or null when the row
 *   stays editable.
 */
export function onPageDisabledNote(row: OptionRow, pageUiEnabled: boolean | null): string | null {
  if (row.onPage !== true || pageUiEnabled !== false) return null;
  return ON_PAGE_UI_OFF_NOTE;
}
