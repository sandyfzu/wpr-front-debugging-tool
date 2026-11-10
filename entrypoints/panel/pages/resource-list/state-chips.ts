/**
 * The resource-list rows' state chips, pure: a row's states arrive in
 * importance order (each page owns its state table), and this core keeps
 * several of them compact — at most {@link MAX_VISIBLE_STATE_CHIPS} visible,
 * the rest behind one "+N" chip whose title names them with their sources.
 * Pages build the split once per row view (never in the row renderer).
 */
import { STATE_SOURCE_LOOKS, type StateSource } from './state-sources';

/** One state chip on a row. */
export interface StateChip {
  /** Stable state id (test hook, keyed rendering). */
  readonly id: string;
  /** The one-word visible label. */
  readonly label: string;
  /** Who produced the state — it sets the chip's icon and treatment. */
  readonly source: StateSource;
  /** Hover text naming the source and the feature, when the state has more to say than its words. */
  readonly title?: string;
}

/** The "+N" chip standing for the hidden states. */
export interface OverflowChip {
  /** "+N". */
  readonly label: string;
  /** Names every hidden state with its source, in order. */
  readonly title: string;
  /** A hidden state is WP Rocket's: the chip shows the rocket, so no WP Rocket work hides unseen. */
  readonly hidesWpRocket: boolean;
}

/** A row's chips, split for rendering. */
export interface StateChipSplit {
  readonly visible: readonly StateChip[];
  /** `null` while every chip fits. */
  readonly overflow: OverflowChip | null;
}

/** At most this many state chips show on a row before the "+N" chip. */
export const MAX_VISIBLE_STATE_CHIPS = 3;

/** The split of a row without states (shared: no allocation per plain row). */
export const NO_STATE_CHIPS: StateChipSplit = { visible: [], overflow: null };

/**
 * A chip's words as one phrase: the label, then its source in parentheses
 * ("Minified (WP Rocket)") — the form the "+N" title lists, so a hidden
 * chip keeps its attribution.
 *
 * @param chip The chip.
 */
export function chipPhrase(chip: StateChip): string {
  return `${chip.label} (${STATE_SOURCE_LOOKS[chip.source].phrase})`;
}

/**
 * Split a row's chips: the first `max` show, the rest collapse into "+N".
 *
 * @param chips The row's chips, most important first.
 * @param max The visible cap (default {@link MAX_VISIBLE_STATE_CHIPS}).
 * @returns The visible chips and the overflow chip (`null` when none is hidden).
 * @throws {@link Error} When `max` is not a positive integer — a wiring bug.
 */
export function splitStateChips(
  chips: readonly StateChip[],
  max: number = MAX_VISIBLE_STATE_CHIPS
): StateChipSplit {
  if (!Number.isInteger(max) || max < 1) {
    throw new Error(`State chip cap must be a positive integer, got ${String(max)}.`);
  }
  if (chips.length === 0) return NO_STATE_CHIPS;
  if (chips.length <= max) return { visible: chips, overflow: null };
  const hidden = chips.slice(max);
  return {
    visible: chips.slice(0, max),
    overflow: {
      label: `+${String(hidden.length)}`,
      title: `Also: ${hidden.map(chipPhrase).join(', ')}`,
      hidesWpRocket: hidden.some((chip) => chip.source === 'wp-rocket')
    }
  };
}
