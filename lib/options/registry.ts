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
 */

import { APPEARANCES, type Appearance } from '../../utils/theme';
import {
  storedOptionsOrFallback,
  TOOLBAR_BADGE,
  WP_DASHBOARD_DBUGGER_ENTRY,
  type StoredOptions
} from '../storage/options';

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

/** A boolean option stored as `options[section][id]`. */
export interface BooleanOptionRow {
  /** Row discriminator: a two-state switch. */
  readonly kind: 'boolean';
  /** The storage key inside the section's group — stable across releases. */
  readonly id: string;
  /** The group the key lives in (the storage shape's boolean maps). */
  readonly section: Exclude<OptionSectionId, 'appearance'>;
  /** The switch's label. */
  readonly label: string;
  /** The switch's description. */
  readonly description: string;
}

/**
 * The appearance choice, stored as the shape's top-level `appearance` slot —
 * a three-way choice (`system`/`dark`/`light`), not a boolean switch, so it
 * is its own row kind rendered as a tri-state control.
 */
export interface AppearanceOptionRow {
  /** Row discriminator: the three-way appearance choice. */
  readonly kind: 'appearance';
  /** The storage slot the choice lives in. */
  readonly id: 'appearance';
  /** The card the control renders in. */
  readonly section: 'appearance';
  /** The control's label. */
  readonly label: string;
  /** The control's description. */
  readonly description: string;
}

/** Any registry row — the union the page's controls render from. */
export type OptionRow = BooleanOptionRow | AppearanceOptionRow;

/**
 * Whether a draft value is one of the three documented appearance choices —
 * the vocabulary's guard for values typed wider than `Appearance` (the
 * draft's `boolean | Appearance`). Derived from the `APPEARANCES` order in
 * `utils/theme` — never a second spelling of the vocabulary.
 *
 * @param value Any value to test.
 */
export function isAppearanceChoice(value: unknown): value is Appearance {
  return typeof value === 'string' && (APPEARANCES as readonly string[]).includes(value);
}

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
    description: 'Injects little scripts or styles to improve tools we use daily'
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'How the tool looks — follow your system or pin one palette for every surface'
  },
  {
    id: 'features',
    title: 'Features',
    description: 'Tool-wide behaviors you can switch on or off'
  }
]);

/** The option rows, in display order within their sections. */
export const OPTION_ROWS: readonly OptionRow[] = freezeRows<OptionRow>([
  {
    kind: 'boolean',
    id: WP_DASHBOARD_DBUGGER_ENTRY,
    section: 'improvements',
    label: "Add an entry to access the D-bugger to WP Rocket's menu",
    description:
      'Adds a convenient entry in the WP Rocket menu for quick access to the D-bugger tool'
  },
  {
    kind: 'appearance',
    id: 'appearance',
    section: 'appearance',
    label: 'Color theme',
    description:
      "Follows your system's dark or light preference, or pins one palette — every open surface updates immediately"
  },
  {
    kind: 'boolean',
    id: TOOLBAR_BADGE,
    section: 'features',
    label: 'Show the toolbar badge',
    description:
      'Colors the toolbar icon while WP Rocket is detected on the inspected page — applies live, no restart'
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
export function readOption(row: OptionRow, options: StoredOptions): boolean | Appearance {
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
export function isValidOptionValue(row: OptionRow, value: boolean | Appearance): boolean {
  if (row.kind === 'appearance') return isAppearanceChoice(value);
  return typeof value === 'boolean';
}
